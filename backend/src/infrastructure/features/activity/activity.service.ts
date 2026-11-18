import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../Prisma/prisma.service';
import { Prisma, PaymentStatus, BeneficiaryType, AttendanceStatus } from '@prisma/client';
import { FEE_STRATEGY, FeeStrategy } from '@src/domain/constants/app.constants';
import { FeeResolutionService, SplitResult } from '../fee-engine/fee-resolution.service';
import { CreateActivityDto } from '@src/application/features/activity/Dtos/create-activity.dto';
import { WorkItem } from '@src/domain/features/activity/WorkItem.entity';
import { parseOrgSettings } from '@src/domain/features/organization/org-settings';
import {
  Money,
  money,
  percentOf,
  roundMoney,
  sameMoney,
  toJsonNumber,
} from '@src/domain/seed-work/money';
import { isCollected, NOT_COLLECTED_WHERE } from '@src/domain/features/activity/activity-collected';
import {
  activityAlreadyCollected,
  amountBelowCardSurcharge,
  paymentDateRequired,
} from '@src/application/features/activity/activity-errors';
import { canModifyActivity } from '@src/application/features/activity/activity-ownership';
import { OrgScope, roleIn } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import {
  AUTH_ERROR_CODE,
  ViewModeValue,
} from '@src/infrastructure.bootstrap/config/core/authentication/auth-context';
import {
  forbiddenAction,
  foundOr404,
  inOrg,
  inScope,
  optionalId,
  requireId,
  resourceNotFound,
} from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

/**
 * Rol del evento que usa el alta cuando el pedido no manda `role` (el front nunca lo manda). La edición lo
 * reutiliza al recalcular.
 */
const DEFAULT_EVENT_ROLE = 'TITULAR';

export interface UpdateActivityInput {
  id: string;
  date?: string;
  paymentStatus?: PaymentStatus;
  paymentMethod?: string;
  /** null o vacía = intento de borrar la fecha: 400 si la atención queda PAID. */
  paymentDate?: string | null;
  attendance?: AttendanceStatus;
  /** Ausente = sin cambio. */
  grossAmount?: number;
  /** Ausente = sin cambio; null = pagador particular de la organización; UUID = ese pagador. */
  payerId?: string | null;
}

type WorkItemRow = Prisma.WorkItemGetPayload<object>;

interface ActivityTypeRoleConfig {
  roleLabel: string;
  isRequired: boolean;
  feeStrategy: FeeStrategy;
  fixedPercentage?: number;
}

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private prisma: PrismaService,
    private feeEngine: FeeResolutionService,
  ) { }

  /**
   * Crea una atención. `scope` sale de los guards (no del body): la organización destino T tiene que estar
   * en el scope y todo id referenciado tiene que ser de T. Las lecturas y verificaciones van antes de
   * cualquier escritura; las escrituras corren juntas en una transacción.
   */
  async createActivity(
    data: CreateActivityDto,
    mode: ViewModeValue,
    scope: OrgScope,
  ): Promise<WorkItem> {
    // Criterio 16: una atención que se da de alta como pagada exige la fecha de pago (sin escribir nada).
    if (data.paymentStatus === PaymentStatus.PAID && !data.paymentDate) {
      throw paymentDateRequired();
    }
    const date = new Date(data.date);
    const userId = scope.userId;

    // ── 1. Organización destino ───────────────────────────────────────────────
    const orgId = optionalId(data.organizationId) ?? scope.primaryOrgId;
    if (!scope.orgIds.includes(orgId)) {
      throw new ForbiddenException({
        code: AUTH_ERROR_CODE.ORG_ACCESS_DENIED,
        message: 'Forbidden',
      });
    }
    const orgFilter = inOrg(orgId);

    // ── 2. Modo y permiso de carga (no dependen de ningún id) ─────────────────
    // `mode` lo resolvió ViewModeGuard contra la organización de la URL. La rama org (valores del tipo de
    // actividad, sin la regla de primera carga) exige membresía en la organización DESTINO.
    if (mode === 'org' && roleIn(scope, orgId) === null) {
      throw forbiddenAction();
    }
    // Solo vínculo de Professional (sin membresía): necesita canLoadActivities y carga solo a su nombre.
    let ownProfessionalId: string | null = null;
    if (roleIn(scope, orgId) === null) {
      const own = await this.prisma.professional.findFirst({
        where: { userId, ...orgFilter, status: 'ACTIVE', deletedAt: null },
        select: { id: true, canLoadActivities: true },
      });
      if (!own || !own.canLoadActivities) throw forbiddenAction();
      ownProfessionalId = own.id;
    }

    // ── 3. Lecturas: organización e ids referenciados (404 si no son de la organización) ──
    const org = await foundOr404(this.prisma.organization.findUnique({ where: { id: orgId } }));
    const orgSettings = parseOrgSettings(org.settings);

    const activityTypeId = optionalId(data.activityTypeId);
    const activityType = activityTypeId
      ? ((await foundOr404(
          this.prisma.activityType.findFirst({ where: { id: activityTypeId, ...orgFilter } }),
        )) as { id: string; baseValue: any; cardValue: any; roles: any })
      : null;

    const presetId = optionalId(data.presetId);
    const preset = presetId
      ? await foundOr404(this.prisma.feePreset.findFirst({ where: { id: presetId, ...orgFilter } }))
      : null;

    const requestedPayerId = optionalId(data.payerId);
    if (requestedPayerId) {
      await foundOr404(
        this.prisma.payer.findFirst({ where: { id: requestedPayerId, ...orgFilter }, select: { id: true } }),
      );
    }

    const patientId = optionalId(data.patientId);
    const patientRecord = patientId
      ? await foundOr404(
          this.prisma.patient.findFirst({ where: { id: patientId, ...orgFilter }, select: { id: true } }),
        )
      : null;

    let professionalId: string | undefined = undefined;
    const requestedProfessionalId = optionalId(data.professionalId);
    if (ownProfessionalId) {
      // Un profesional sin membresía solo carga a su propio Professional.
      if (requestedProfessionalId && requestedProfessionalId !== ownProfessionalId) {
        throw forbiddenAction();
      }
      professionalId = ownProfessionalId;
    } else if (requestedProfessionalId) {
      await foundOr404(
        this.prisma.professional.findFirst({
          where: { id: requestedProfessionalId, ...orgFilter, deletedAt: null },
          select: { id: true },
        }),
      );
      professionalId = requestedProfessionalId;
    }

    const verifiedParticipants: { professionalId: string; roleLabel: string }[] = [];
    const seenParticipants = new Set<string>();
    for (const p of data.participants ?? []) {
      const participantId = requireId(p.professionalId);
      if (!seenParticipants.has(participantId)) {
        await foundOr404(
          this.prisma.professional.findFirst({
            where: { id: participantId, ...orgFilter, deletedAt: null },
            select: { id: true },
          }),
        );
        seenParticipants.add(participantId);
      }
      verifiedParticipants.push({ professionalId: participantId, roleLabel: p.roleLabel });
    }

    // Profesional propio del usuario en modo pro (si no vino uno explícito).
    if (!professionalId && mode === 'pro') {
      const existingOwnPro = await this.prisma.professional.findFirst({
        where: { userId, organizationId: orgId, deletedAt: null },
        select: { id: true },
      });
      if (existingOwnPro) professionalId = existingOwnPro.id;
    }

    // Regla de primera carga (solo modo pro, solo si el profesional ya se conoce)
    if (mode === 'pro' && patientRecord && professionalId) {
      // Bypass this rule for Virtual Orgs (SOLO_PRACTICE) since the professional is the only admin
      if (org.type !== 'SOLO_PRACTICE') {
        // Check if professional is an active member of this org with canLoadActivities=true
        // If so, they can load activities for any patient in the org (no first-load restriction)
        const isActiveMember = await this.prisma.professional.findFirst({
          where: {
            id: professionalId,
            organizationId: orgId,
            canLoadActivities: true,
            deletedAt: null,
          },
        });

        // Only enforce the "first load must be done by org" rule for external professionals
        if (!isActiveMember) {
          const previousActivitiesCount = await this.prisma.workItem.count({
            where: {
              patientId: patientRecord.id,
              professionalId,
            },
          });
          if (previousActivitiesCount === 0) {
            throw new BadRequestException({
              code: 'first-load-required',
              message: 'No podés cargar una actividad para un paciente que no atendiste antes. La primera carga debe realizarla la organización.',
            });
          }
        }
      }
    }

    // Pagador por defecto de la organización (solo lectura; se crea dentro de la transacción)
    const privatePayerName = orgSettings.privatePayerName;
    let payerId: string | undefined = requestedPayerId ?? undefined;
    if (!payerId) {
      const defaultPayer = await this.findDefaultPayer(this.prisma, orgId, privatePayerName);
      payerId = defaultPayer?.id;
    }

    // ── Resolve Amounts ───────────────────────────────────────────────────────
    let amountBase: Money = money(0);
    let amountCard: Money | null = null;

    if (mode === 'pro') {
      amountBase = money(data.amountBase ?? data.amount ?? 0);
      amountCard = data.amountCard != null ? money(data.amountCard) : null;
    } else {
      // Org mode: ActivityType values take precedence, then preset, then manual
      if (activityType?.baseValue) {
        amountBase = money(activityType.baseValue);
        amountCard = activityType.cardValue ? money(activityType.cardValue) : null;
      } else if (preset) {
        amountBase = money(preset.value);
        amountCard = preset.cardValue ? money(preset.cardValue) : null;
      }

      // Manual overrides always win when provided explicitly
      if (data.amountBase != null) amountBase = money(data.amountBase);
      if (data.amountCard != null) amountCard = money(data.amountCard);

      // Legacy fallback: plain 'amount' field
      if (amountBase.isZero() && data.amount) {
        amountBase = money(data.amount);
      }
    }

    const grossAmount: Money = amountCard ? amountBase.add(amountCard) : amountBase;

    // ── 4. Escrituras: todo en una transacción ────────────────────────────────
    return this.prisma.$transaction(async (tx) => {
      // Default payer
      if (!payerId) {
        this.logger.debug(`[CreateActivity] Auto-creating default payer for org ${orgId}`);
        const createdPayer = await this.createDefaultPayer(tx, orgId, privatePayerName);
        payerId = createdPayer.id;
      }

      // Auto-create Professional record if missing in a Virtual Org (SOLO_PRACTICE)
      if (!professionalId && mode === 'pro' && org.type === 'SOLO_PRACTICE') {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (user) {
          const pro = await tx.professional.create({
            data: {
              organizationId: org.id,
              userId: user.id,
              displayName: user.name,
              email: user.email,
              status: 'ACTIVE',
              canLoadActivities: true,
            },
          });
          professionalId = pro.id;
          this.logger.debug(`[CreateActivity] Auto-created Professional record for virtual org ${org.id}`);
        }
      }

      if (!professionalId) {
        throw new BadRequestException({
          code: 'bad-request',
          message: 'Falta el profesional de la atención.',
        });
      }
      const resolvedProfessionalId: string = professionalId;
      const resolvedPayerId: string = payerId;

      // ── Persist WorkItem ────────────────────────────────────────────────────
      const prismaData: Prisma.WorkItemCreateInput = {
        organization: { connect: { id: orgId } },
        professional: { connect: { id: resolvedProfessionalId } },
        payer: { connect: { id: resolvedPayerId } },
        occurredAt: date,
        serviceType: data.serviceType ?? orgSettings.defaultServiceType,
        grossAmount,
        amountBase,
        amountCard: amountCard ?? money(0),
        paymentStatus: (data.paymentStatus as PaymentStatus) ?? PaymentStatus.UNPAID,
        paymentMethod: data.paymentStatus && data.paymentStatus !== PaymentStatus.UNPAID ? data.paymentMethod : null,
        paymentDate: data.paymentStatus && data.paymentStatus !== PaymentStatus.UNPAID && data.paymentDate ? new Date(data.paymentDate) : null,
        attendance: data.attendance as any,
        createdByUserId: userId,
        ...(activityType && { activityType: { connect: { id: activityType.id } } }),
        ...(patientRecord && { patient: { connect: { id: patientRecord.id } } }),
        ...(preset && { preset: { connect: { id: preset.id } } }),
      };

      const workItem = await tx.workItem.create({ data: prismaData });

      // ── Create WorkItemParticipants ──────────────────────────────────────────
      const roleConfigs = this.roleConfigsOf(activityType?.roles);

      const participants = verifiedParticipants.length > 0
        ? verifiedParticipants
        : [{ professionalId: resolvedProfessionalId, roleLabel: roleConfigs[0]?.roleLabel ?? 'Profesional' }];

      const fees = await this.computeParticipantFees(tx, participants, roleConfigs, amountBase);
      const participantRows = participants.map((p, i) => ({
        workItemId: workItem.id,
        professionalId: p.professionalId,
        roleLabel: p.roleLabel,
        feeAmount: fees[i],
        isRequired: roleConfigs.find((r) => r.roleLabel === p.roleLabel)?.isRequired ?? true,
      }));

      await tx.workItemParticipant.createMany({ data: participantRows });

      // ── Calculate & Persist Splits (WorkItemSplit) ───────────────────────────
      const splits = await this.computeDistribution(tx, {
        orgId,
        orgType: org.type,
        settings: orgSettings,
        payerId: resolvedPayerId,
        mainProfessionalId: resolvedProfessionalId,
        serviceType: workItem.serviceType,
        eventRole: data.role ?? DEFAULT_EVENT_ROLE,
        grossAmount,
        allowPrivateSplit: mode === 'pro',
      });

      if (splits.length > 0) {
        await tx.workItemSplit.createMany({ data: this.splitRows(workItem.id, splits) });
      }

      // ── Map to Domain Entity ────────────────────────────────────────────────
      return new WorkItem({
        ...workItem,
        paymentStatus: workItem.paymentStatus,
        attendance: workItem.attendance,
        grossAmount: toJsonNumber(workItem.grossAmount),
        amountBase: toJsonNumber(workItem.amountBase),
        amountCard: workItem.amountCard != null ? toJsonNumber(workItem.amountCard) : null,
      });
    });
  }

  /**
   * Edición de una atención (017, #45). Sin cambio de monto ni de pagador es una sola escritura, igual que
   * siempre. Con cambio financiero: transacción con escritura condicional "no cobrada" en el `where` (cierra la
   * carrera con un cobro simultáneo), recálculo de honorarios de participantes y reemplazo de los splits con las
   * reglas vigentes (mismo código que el alta).
   */
  async updateActivity(input: UpdateActivityInput, scope: OrgScope): Promise<WorkItemRow> {
    const id = requireId(input.id);

    const existing = await foundOr404(
      this.prisma.workItem.findFirst({
        where: { id, ...inScope(scope) },
        select: {
          organizationId: true,
          createdByUserId: true,
          paymentStatus: true,
          paymentDate: true,
          grossAmount: true,
          amountBase: true,
          amountCard: true,
          payerId: true,
          professionalId: true,
          serviceType: true,
          professional: { select: { userId: true } },
          activityType: { select: { roles: true } },
          organization: { select: { type: true, settings: true } },
        },
      }),
    );
    if (!canModifyActivity(existing, scope, 'edit')) throw forbiddenAction();

    // Criterio 16: la fecha se exige solo cuando el pedido hace que la atención PASE a PAID (lo guardado no era PAID
    // y el resultado sí) sin fecha en el pedido ni guardada, o cuando intenta borrar la fecha (null o vacía) de una
    // atención que queda PAID. Mandar paymentStatus PAID igual a lo guardado no es un cambio: una PAID antigua sin
    // fecha se puede seguir editando.
    const finalStatus = input.paymentStatus ?? existing.paymentStatus;
    const becomesPaid = existing.paymentStatus !== PaymentStatus.PAID && finalStatus === PaymentStatus.PAID;
    const clearsDate = input.paymentDate === null || input.paymentDate === '';
    if (becomesPaid && !input.paymentDate && !existing.paymentDate) {
      throw paymentDateRequired();
    }
    if (clearsDate && finalStatus === PaymentStatus.PAID) {
      throw paymentDateRequired();
    }

    const data: Prisma.WorkItemUncheckedUpdateManyInput = {};
    if (input.date) data.occurredAt = new Date(input.date);
    if (input.paymentMethod) data.paymentMethod = input.paymentMethod;
    if (input.paymentDate) data.paymentDate = new Date(input.paymentDate);
    if (input.attendance) data.attendance = input.attendance;
    if (input.paymentStatus) data.paymentStatus = input.paymentStatus;

    // ── Cambios financieros (se calculan antes de escribir) ────────────────────
    const grossChanged =
      input.grossAmount !== undefined && !sameMoney(roundMoney(input.grossAmount), existing.grossAmount);

    const orgSettings = parseOrgSettings(existing.organization.settings);
    let targetPayerId: string | null = existing.payerId;
    if (input.payerId === null) {
      const defaultPayer = await this.findDefaultPayer(
        this.prisma,
        existing.organizationId,
        orgSettings.privatePayerName,
      );
      targetPayerId = defaultPayer?.id ?? null;
    } else if (input.payerId !== undefined) {
      // Tiene que ser de la organización de la atención: ajeno e inexistente dan el mismo 404.
      const payer = await foundOr404(
        this.prisma.payer.findFirst({
          where: { id: requireId(input.payerId), ...inOrg(existing.organizationId) },
          select: { id: true },
        }),
      );
      targetPayerId = payer.id;
    }
    const payerChanged = targetPayerId !== existing.payerId;

    // ── Sin cambio financiero: una sola escritura, como antes ──────────────────
    if (!grossChanged && !payerChanged) {
      return this.prisma.workItem.update({ where: { id }, data });
    }

    // ── Con cambio financiero ──────────────────────────────────────────────────
    if (isCollected(existing)) throw activityAlreadyCollected();

    const newGross: Money = grossChanged ? roundMoney(input.grossAmount) : money(existing.grossAmount);
    const amountCard: Money = money(existing.amountCard);
    let amountBase: Money = money(existing.amountBase);
    if (grossChanged) {
      amountBase = newGross.sub(amountCard);
      if (amountBase.isNegative()) throw amountBelowCardSurcharge();
    }
    const roleConfigs = this.roleConfigsOf(existing.activityType?.roles);
    const orgId = existing.organizationId;

    return this.prisma.$transaction(async (tx) => {
      let payerId = targetPayerId;
      if (!payerId) {
        const created = await this.createDefaultPayer(tx, orgId, orgSettings.privatePayerName);
        payerId = created.id;
      }

      // Escritura condicional: si otra sesión la cobró entre la lectura y acá, count = 0.
      const { count } = await tx.workItem.updateMany({
        where: { id, organizationId: orgId, ...NOT_COLLECTED_WHERE },
        data: { ...data, grossAmount: newGross, amountBase, payerId },
      });
      if (count === 0) {
        const current = await tx.workItem.findFirst({
          where: { id, ...inScope(scope) },
          select: { id: true },
        });
        if (!current) throw resourceNotFound();
        throw activityAlreadyCollected();
      }

      // Honorarios de los participantes: los mismos que conserva la atención, recalculados.
      const participants = await tx.workItemParticipant.findMany({ where: { workItemId: id } });
      const fees = await this.computeParticipantFees(tx, participants, roleConfigs, amountBase);
      for (let i = 0; i < participants.length; i++) {
        await tx.workItemParticipant.update({
          where: { id: participants[i].id },
          data: { feeAmount: fees[i] },
        });
      }

      // Distribución: se reemplaza por completo (también cualquier ajuste manual previo).
      const splits = await this.computeDistribution(tx, {
        orgId,
        orgType: existing.organization.type,
        settings: orgSettings,
        payerId,
        mainProfessionalId: existing.professionalId,
        serviceType: existing.serviceType,
        eventRole: DEFAULT_EVENT_ROLE,
        grossAmount: newGross,
        allowPrivateSplit: true,
      });
      await tx.workItemSplit.deleteMany({ where: { workItemId: id } });
      if (splits.length > 0) {
        await tx.workItemSplit.createMany({ data: this.splitRows(id, splits) });
      }

      return foundOr404(tx.workItem.findUnique({ where: { id } }));
    });
  }

  // ── Piezas compartidas por el alta y la edición ─────────────────────────────

  /** Pagador por defecto de la organización (el "Particular"), si existe. */
  private findDefaultPayer(db: Prisma.TransactionClient, orgId: string, name: string) {
    return db.payer.findFirst({ where: { organizationId: orgId, name } });
  }

  private createDefaultPayer(tx: Prisma.TransactionClient, orgId: string, name: string) {
    return tx.payer.create({
      data: { organizationId: orgId, name, isManagedBySystem: true },
    });
  }

  private roleConfigsOf(roles: unknown): ActivityTypeRoleConfig[] {
    return Array.isArray(roles) ? (roles as ActivityTypeRoleConfig[]) : [];
  }

  private computeParticipantFees(
    db: Prisma.TransactionClient,
    participants: { professionalId: string; roleLabel: string }[],
    roleConfigs: ActivityTypeRoleConfig[],
    amountBase: Money,
  ): Promise<Money[]> {
    return Promise.all(
      participants.map((p) =>
        this.calculateParticipantFee(
          p.professionalId,
          roleConfigs.find((r) => r.roleLabel === p.roleLabel),
          amountBase,
          db,
        ),
      ),
    );
  }

  /**
   * Reparto del bruto: el particular de SOLO_PRACTICE (solo si `allowPrivateSplit`) o el motor de honorarios.
   * "Private" aplica ÚNICAMENTE a SOLO_PRACTICE (la práctica propia del profesional): en una CLINIC hasta el
   * pagador "Particular" pasa por el motor, para aplicar el porcentaje de la categoría.
   */
  private async computeDistribution(
    tx: Prisma.TransactionClient,
    p: {
      orgId: string;
      orgType: string;
      settings: ReturnType<typeof parseOrgSettings>;
      payerId: string;
      mainProfessionalId: string;
      serviceType: string;
      eventRole: string;
      grossAmount: Money;
      allowPrivateSplit: boolean;
    },
  ): Promise<SplitResult[]> {
    const professional = await tx.professional.findUnique({
      where: { id: p.mainProfessionalId },
      include: { category: true },
    });
    const payerRecord = await tx.payer.findUnique({ where: { id: p.payerId } });
    const isPrivate = payerRecord?.name === p.settings.privatePayerName && p.orgType === 'SOLO_PRACTICE';

    if (p.allowPrivateSplit && isPrivate) {
      this.logger.debug(`[Distribution] Private patient (SOLO_PRACTICE): ${p.settings.proModePrivatePatientPct}% to professional`);
      return [
        {
          beneficiaryType: BeneficiaryType.PROFESSIONAL,
          beneficiaryId: p.mainProfessionalId,
          amount: percentOf(p.grossAmount, p.settings.proModePrivatePatientPct),
          roleLabel: 'Honorario (Particular/Privado)',
        },
      ];
    }
    return this.feeEngine.calculateSplits(
      {
        organizationId: p.orgId,
        payerId: p.payerId,
        professionalId: p.mainProfessionalId,
        professionalCategory: professional?.category?.name ?? null,
        eventRole: p.eventRole,
        serviceType: p.serviceType,
        grossAmount: p.grossAmount,
      },
      tx,
    );
  }

  private splitRows(workItemId: string, splits: SplitResult[]): Prisma.WorkItemSplitCreateManyInput[] {
    return splits.map((s) => ({
      workItemId,
      beneficiaryType: s.beneficiaryType,
      beneficiaryId: s.beneficiaryId,
      amount: s.amount,
      roleLabel: s.roleLabel,
    }));
  }

  /**
   * Calculates the fee for a participant in an activity based on the role
   * configuration defined in the ActivityType.
   *
   * - feeStrategy 'FIXED': fixedPercentage % of amountBase
   * - feeStrategy 'CATEGORY': professional's category percentage % of amountBase
   * - No role config found: 0 (org decides via FeeRule engine)
   */
  private async calculateParticipantFee(
    professionalId: string,
    roleConfig: ActivityTypeRoleConfig | undefined,
    amountBase: Money,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Money> {
    if (!roleConfig || amountBase.isZero()) return money(0);

    if (roleConfig.feeStrategy === FEE_STRATEGY.FIXED && roleConfig.fixedPercentage != null) {
      return percentOf(amountBase, roleConfig.fixedPercentage);
    }

    if (roleConfig.feeStrategy === FEE_STRATEGY.CATEGORY) {
      const pro = await db.professional.findUnique({
        where: { id: professionalId },
        include: { category: true },
      });
      const categoryPct = pro?.category?.percentage ?? 100;
      return percentOf(amountBase, categoryPct);
    }

    return money(0);
  }
}
