import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../Prisma/prisma.service';
import { Prisma, PaymentStatus, BeneficiaryType } from '@prisma/client';
import { isProfessionalMode, FEE_STRATEGY, FeeStrategy } from '@src/domain/constants/app.constants';
import { FeeResolutionService } from '../fee-engine/fee-resolution.service';
import { CreateActivityDto } from '@src/application/features/activity/Dtos/create-activity.dto';
import { WorkItem } from '@src/domain/features/activity/WorkItem.entity';
import { parseOrgSettings } from '@src/domain/features/organization/org-settings';
import { OrgScope, roleIn } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { AUTH_ERROR_CODE } from '@src/infrastructure.bootstrap/config/core/authentication/auth-context';
import {
  forbiddenAction,
  foundOr404,
  inOrg,
  optionalId,
  requireId,
} from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

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
    mode: string,
    scope: OrgScope,
  ): Promise<WorkItem> {
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

    // ── 2. Permiso de carga (no depende de ningún id) ─────────────────────────
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
    if (!professionalId && isProfessionalMode(mode)) {
      const existingOwnPro = await this.prisma.professional.findFirst({
        where: { userId, organizationId: orgId, deletedAt: null },
        select: { id: true },
      });
      if (existingOwnPro) professionalId = existingOwnPro.id;
    }

    // Regla de primera carga (solo modo pro, solo si el profesional ya se conoce)
    if (isProfessionalMode(mode) && patientRecord && professionalId) {
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
            throw new Error('No puedes cargar una actividad para un paciente que no has atendido previamente. La primera carga debe realizarla la organización.');
          }
        }
      }
    }

    // Pagador por defecto de la organización (solo lectura; se crea dentro de la transacción)
    const privatePayerName = orgSettings.privatePayerName;
    let payerId: string | undefined = requestedPayerId ?? undefined;
    if (!payerId) {
      const defaultPayer = await this.prisma.payer.findFirst({
        where: { organizationId: orgId, name: privatePayerName },
      });
      payerId = defaultPayer?.id;
    }

    // ── Resolve Amounts ───────────────────────────────────────────────────────
    let amountBase = new Prisma.Decimal(0);
    let amountCard: Prisma.Decimal | null = null;

    if (isProfessionalMode(mode)) {
      amountBase = new Prisma.Decimal(data.amountBase ?? data.amount ?? 0);
      amountCard = data.amountCard != null ? new Prisma.Decimal(data.amountCard) : null;
    } else {
      // Org mode: ActivityType values take precedence, then preset, then manual
      if (activityType?.baseValue) {
        amountBase = new Prisma.Decimal(activityType.baseValue);
        amountCard = activityType.cardValue ? new Prisma.Decimal(activityType.cardValue) : null;
      } else if (preset) {
        amountBase = new Prisma.Decimal(preset.value);
        amountCard = preset.cardValue ? new Prisma.Decimal(preset.cardValue) : null;
      }

      // Manual overrides always win when provided explicitly
      if (data.amountBase != null) amountBase = new Prisma.Decimal(data.amountBase);
      if (data.amountCard != null) amountCard = new Prisma.Decimal(data.amountCard);

      // Legacy fallback: plain 'amount' field
      if (Number(amountBase) === 0 && data.amount) {
        amountBase = new Prisma.Decimal(data.amount);
      }
    }

    const grossAmount = amountCard
      ? amountBase.add(amountCard)
      : amountBase;

    // ── 4. Escrituras: todo en una transacción ────────────────────────────────
    return this.prisma.$transaction(async (tx) => {
      // Default payer
      if (!payerId) {
        this.logger.debug(`[CreateActivity] Auto-creating default payer for org ${orgId}`);
        const createdPayer = await tx.payer.create({
          data: {
            organizationId: orgId,
            name: privatePayerName,
            isManagedBySystem: true,
          },
        });
        payerId = createdPayer.id;
      }

      // Auto-create Professional record if missing in a Virtual Org (SOLO_PRACTICE)
      if (!professionalId && isProfessionalMode(mode) && org.type === 'SOLO_PRACTICE') {
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
        throw new Error('Professional ID is required');
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
        amountCard: amountCard ?? new Prisma.Decimal(0),
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
      const roleConfigs: ActivityTypeRoleConfig[] = Array.isArray(activityType?.roles)
        ? (activityType!.roles as ActivityTypeRoleConfig[])
        : [];

      const participants = verifiedParticipants.length > 0
        ? verifiedParticipants
        : [{ professionalId: resolvedProfessionalId, roleLabel: roleConfigs[0]?.roleLabel ?? 'Profesional' }];

      const participantRows = await Promise.all(
        participants.map(async (p) => {
          const roleConfig = roleConfigs.find(r => r.roleLabel === p.roleLabel);
          const feeAmount = await this.calculateParticipantFee(
            p.professionalId,
            roleConfig,
            Number(amountBase),
            tx,
          );
          return {
            workItemId: workItem.id,
            professionalId: p.professionalId,
            roleLabel: p.roleLabel,
            feeAmount: new Prisma.Decimal(feeAmount),
            isRequired: roleConfig?.isRequired ?? true,
          };
        }),
      );

      await tx.workItemParticipant.createMany({ data: participantRows });

      // ── Calculate & Persist Splits (WorkItemSplit) ───────────────────────────
      const professional = await tx.professional.findUnique({
        where: { id: resolvedProfessionalId },
        include: { category: true },
      });

      const payerRecord = await tx.payer.findUnique({ where: { id: resolvedPayerId } });
      // "Private" means patient paying directly with no org commission structure.
      // This ONLY applies to SOLO_PRACTICE (virtual) orgs — the professional's own private practice.
      // In a CLINIC org (like Psico LSA), even "Particular" payer goes through the fee engine
      // so that the professional's category percentage is correctly applied.
      const isPrivate = payerRecord?.name === orgSettings.privatePayerName && org.type === 'SOLO_PRACTICE';

      let splits: any[];

      if (isProfessionalMode(mode) && isPrivate) {
        const proPct = orgSettings.proModePrivatePatientPct / 100;
        this.logger.debug(`[CreateActivity] Private patient in pro mode (SOLO_PRACTICE): ${orgSettings.proModePrivatePatientPct}% to professional`);
        splits = [{
          beneficiaryType: BeneficiaryType.PROFESSIONAL,
          beneficiaryId: resolvedProfessionalId,
          amount: Number(grossAmount) * proPct,
          roleLabel: 'Honorario (Particular/Privado)',
        }];
      } else {
        const context: any = {
          organizationId: orgId,
          payerId: resolvedPayerId,
          professionalId: resolvedProfessionalId,
          professionalCategory: professional?.category?.name ?? null,
          eventRole: data.role ?? 'TITULAR',
          serviceType: workItem.serviceType,
          grossAmount: Number(grossAmount),
        };
        splits = await this.feeEngine.calculateSplits(context, tx);
      }

      if (splits.length > 0) {
        await tx.workItemSplit.createMany({
          data: splits.map((s) => ({
            workItemId: workItem.id,
            beneficiaryType: s.beneficiaryType,
            beneficiaryId: s.beneficiaryId,
            amount: new Prisma.Decimal(s.amount),
            roleLabel: s.roleLabel,
          } as any)),
        });
      }

      // ── Map to Domain Entity ────────────────────────────────────────────────
      return new WorkItem({
        ...workItem,
        paymentStatus: workItem.paymentStatus,
        attendance: workItem.attendance,
        grossAmount: Number(workItem.grossAmount),
        amountBase: Number(workItem.amountBase),
        amountCard: workItem.amountCard != null ? Number(workItem.amountCard) : null,
      });
    });
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
    amountBase: number,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    if (!roleConfig || amountBase === 0) return 0;

    if (roleConfig.feeStrategy === FEE_STRATEGY.FIXED && roleConfig.fixedPercentage != null) {
      return Number(((amountBase * roleConfig.fixedPercentage) / 100).toFixed(2));
    }

    if (roleConfig.feeStrategy === FEE_STRATEGY.CATEGORY) {
      const pro = await db.professional.findUnique({
        where: { id: professionalId },
        include: { category: true },
      });
      const categoryPct = pro?.category?.percentage ?? 100;
      return Number(((amountBase * categoryPct) / 100).toFixed(2));
    }

    return 0;
  }
}
