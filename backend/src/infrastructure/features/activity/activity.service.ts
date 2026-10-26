import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../Prisma/prisma.service';
import { Prisma, PaymentStatus, BeneficiaryType } from '@prisma/client';
import { isProfessionalMode, FEE_STRATEGY, FeeStrategy } from '@src/domain/constants/app.constants';
import { FeeResolutionService } from '../fee-engine/fee-resolution.service';
import { CreateActivityDto } from '@src/application/features/activity/Dtos/create-activity.dto';
import { WorkItem } from '@src/domain/features/activity/WorkItem.entity';
import { parseOrgSettings } from '@src/domain/features/organization/org-settings';

interface ActivityTypeRoleConfig {
  roleLabel: string;
  isRequired: boolean;
  feeStrategy: FeeStrategy;
  fixedPercentage?: number;
}

@Injectable()
export class ActivityService {
  constructor(
    private prisma: PrismaService,
    private feeEngine: FeeResolutionService,
  ) { }

  async createActivity(
    data: CreateActivityDto,
    mode: string,
  ): Promise<WorkItem> {
    const date = new Date(data.date);

    // Load org settings to drive configurable business rules
    const org = await this.prisma.organization.findUnique({ where: { id: data.organizationId } });
    const orgSettings = parseOrgSettings(org?.settings);

    // ── Resolve ActivityType ──────────────────────────────────────────────────
    let activityType: { id: string; baseValue: any; cardValue: any; roles: any } | null = null;
    if (data.activityTypeId) {
      activityType = await this.prisma.activityType.findUnique({
        where: { id: data.activityTypeId },
      }) as any;
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
      } else if (data.presetId) {
        const preset = await this.prisma.feePreset.findUnique({ where: { id: data.presetId } });
        if (preset) {
          amountBase = new Prisma.Decimal(preset.value);
          amountCard = preset.cardValue ? new Prisma.Decimal(preset.cardValue) : null;
        }
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

    // ── Resolve Payer ─────────────────────────────────────────────────────────
    const privatePayerName = orgSettings.privatePayerName;
    let payerId = data.payerId;

    if (!payerId) {
      const defaultPayer = await this.prisma.payer.findFirst({
        where: { organizationId: data.organizationId, name: privatePayerName },
      });
      payerId = defaultPayer?.id;

      if (!payerId) {
        console.log(`[CreateActivity] Auto-creating "${privatePayerName}" payer for Org:`, data.organizationId);
        const createdPayer = await this.prisma.payer.create({
          data: {
            organizationId: data.organizationId,
            name: privatePayerName,
            isManagedBySystem: true,
          },
        });
        payerId = createdPayer.id;
      }
    }

    if (!payerId) {
      throw new Error('Payer is required and could not be resolved.');
    }

    // ── Resolve Primary Professional ──────────────────────────────────────────
    let professionalId = data.professionalId;

    console.log('[CreateActivity] Attempting auto-resolution', {
      userId: data.userId,
      mode,
      professionalId,
      orgId: data.organizationId,
    });

    if (!professionalId && isProfessionalMode(mode) && data.userId) {
      let pro = await this.prisma.professional.findFirst({
        where: { userId: data.userId, organizationId: data.organizationId },
      });

      // Auto-create Professional record if missing in a Virtual Org (SOLO_PRACTICE)
      if (!pro) {
        const org = await this.prisma.organization.findUnique({ where: { id: data.organizationId } });
        if (org && org.type === 'SOLO_PRACTICE') {
          const user = await this.prisma.user.findUnique({ where: { id: data.userId } });
          if (user) {
            pro = await this.prisma.professional.create({
              data: {
                organizationId: org.id,
                userId: user.id,
                displayName: user.name,
                email: user.email,
                status: 'ACTIVE',
                canLoadActivities: true
              }
            });
            console.log(`[CreateActivity] Auto-created Professional record for Virtual Org: ${org.id}`);
          }
        }
      }

      console.log('[CreateActivity] Resolution Result:', pro);
      if (pro) professionalId = pro.id;
    }

    if (!professionalId) {
      throw new Error('Professional ID is required');
    }

    if (isProfessionalMode(mode) && data.patientId) {
      const patientRecord = await this.prisma.patient.findUnique({ where: { id: data.patientId } });
      
      // Only enforce the rule if the patient belongs to the current organization (Org Patient)
      // Private patients (belonging to another org context) are exempt.
      if (patientRecord?.organizationId === data.organizationId) {
        // Bypass this rule for Virtual Orgs (SOLO_PRACTICE) since the professional is the only admin
        const orgForPatient = await this.prisma.organization.findUnique({ where: { id: data.organizationId } });
        if (orgForPatient?.type !== 'SOLO_PRACTICE') {
          // Check if professional is an active member of this org with canLoadActivities=true
          // If so, they can load activities for any patient in the org (no first-load restriction)
          const isActiveMember = await this.prisma.professional.findFirst({
            where: {
              id: professionalId,
              organizationId: data.organizationId,
              canLoadActivities: true,
              deletedAt: null,
            }
          });

          // Only enforce the "first load must be done by org" rule for external professionals
          if (!isActiveMember) {
            const previousActivitiesCount = await this.prisma.workItem.count({
              where: {
                patientId: data.patientId,
                professionalId: professionalId,
              }
            });
            if (previousActivitiesCount === 0) {
              throw new Error('No puedes cargar una actividad para un paciente que no has atendido previamente. La primera carga debe realizarla la organización.');
            }
          }
        }
      }
    }

    // ── Persist WorkItem ──────────────────────────────────────────────────────
    const prismaData: Prisma.WorkItemCreateInput = {
      organization: { connect: { id: data.organizationId } },
      professional: { connect: { id: professionalId } },
      payer: { connect: { id: payerId } },
      occurredAt: date,
      serviceType: data.serviceType ?? orgSettings.defaultServiceType,
      grossAmount,
      amountBase,
      amountCard: amountCard ?? new Prisma.Decimal(0),
      paymentStatus: (data.paymentStatus as PaymentStatus) ?? PaymentStatus.UNPAID,
      paymentMethod: data.paymentStatus && data.paymentStatus !== PaymentStatus.UNPAID ? data.paymentMethod : null,
      paymentDate: data.paymentStatus && data.paymentStatus !== PaymentStatus.UNPAID && data.paymentDate ? new Date(data.paymentDate) : null,
      attendance: data.attendance as any,
      createdByUserId: data.userId ?? null,
      ...(activityType && { activityType: { connect: { id: activityType.id } } }),
      ...(data.patientId && { patient: { connect: { id: data.patientId } } }),
      ...(data.presetId && { preset: { connect: { id: data.presetId } } }),
    };

    console.log('[CreateActivity] Persisting WorkItem:', JSON.stringify(prismaData));

    const workItem = await this.prisma.workItem.create({ data: prismaData });

    // ── Create WorkItemParticipants ────────────────────────────────────────────
    const roleConfigs: ActivityTypeRoleConfig[] = Array.isArray(activityType?.roles)
      ? (activityType!.roles as ActivityTypeRoleConfig[])
      : [];

    const participants = data.participants && data.participants.length > 0
      ? data.participants
      : [{ professionalId, roleLabel: roleConfigs[0]?.roleLabel ?? 'Profesional' }];

    if (participants.length > 0) {
      const participantRows = await Promise.all(
        participants.map(async (p) => {
          const roleConfig = roleConfigs.find(r => r.roleLabel === p.roleLabel);
          const feeAmount = await this.calculateParticipantFee(
            p.professionalId,
            roleConfig,
            Number(amountBase),
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

      await this.prisma.workItemParticipant.createMany({ data: participantRows });
    }

    // ── Calculate & Persist Splits (WorkItemSplit) ────────────────────────────
    const professional = await this.prisma.professional.findUnique({
      where: { id: professionalId },
      include: { category: true },
    });

    const payerRecord = await this.prisma.payer.findUnique({ where: { id: payerId } });
    // "Private" means patient paying directly with no org commission structure.
    // This ONLY applies to SOLO_PRACTICE (virtual) orgs — the professional's own private practice.
    // In a CLINIC org (like Psico LSA), even "Particular" payer goes through the fee engine
    // so that the professional's category percentage is correctly applied.
    const isPrivate = payerRecord?.name === orgSettings.privatePayerName && org?.type === 'SOLO_PRACTICE';

    let splits: any[];

    if (isProfessionalMode(mode) && isPrivate) {
      const proPct = orgSettings.proModePrivatePatientPct / 100;
      console.log(`[CreateActivity] Private Patient in Pro Mode (SOLO_PRACTICE): ${orgSettings.proModePrivatePatientPct}% to Professional`);
      splits = [{
        beneficiaryType: BeneficiaryType.PROFESSIONAL,
        beneficiaryId: professionalId,
        amount: Number(grossAmount) * proPct,
        roleLabel: 'Honorario (Particular/Privado)',
      }];
    } else {
      const context: any = {
        organizationId: data.organizationId,
        payerId,
        professionalId,
        professionalCategory: professional?.category?.name ?? null,
        eventRole: data.role ?? 'TITULAR',
        serviceType: workItem.serviceType,
        grossAmount: Number(grossAmount),
      };
      splits = await this.feeEngine.calculateSplits(context);
    }

    if (splits.length > 0) {
      await this.prisma.workItemSplit.createMany({
        data: splits.map((s) => ({
          workItemId: workItem.id,
          beneficiaryType: s.beneficiaryType,
          beneficiaryId: s.beneficiaryId,
          amount: new Prisma.Decimal(s.amount),
          roleLabel: s.roleLabel,
        } as any)),
      });
    }

    // ── Map to Domain Entity ──────────────────────────────────────────────────
    return new WorkItem({
      ...workItem,
      paymentStatus: workItem.paymentStatus,
      attendance: workItem.attendance,
      grossAmount: Number(workItem.grossAmount),
      amountBase: Number(workItem.amountBase),
      amountCard: workItem.amountCard != null ? Number(workItem.amountCard) : null,
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
  ): Promise<number> {
    if (!roleConfig || amountBase === 0) return 0;

    if (roleConfig.feeStrategy === FEE_STRATEGY.FIXED && roleConfig.fixedPercentage != null) {
      return Number(((amountBase * roleConfig.fixedPercentage) / 100).toFixed(2));
    }

    if (roleConfig.feeStrategy === FEE_STRATEGY.CATEGORY) {
      const pro = await this.prisma.professional.findUnique({
        where: { id: professionalId },
        include: { category: true },
      });
      const categoryPct = pro?.category?.percentage ?? 100;
      return Number(((amountBase * categoryPct) / 100).toFixed(2));
    }

    return 0;
  }
}
