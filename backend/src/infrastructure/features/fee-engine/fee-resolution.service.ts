import { Injectable, Logger } from '@nestjs/common';
import { BeneficiaryType, OrgType } from '@prisma/client';
import { PrismaService } from '../../Prisma/prisma.service';

export enum SplitType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED = 'FIXED',
}

export interface WorkContext {
  organizationId: string;
  payerId: string;
  professionalId: string;
  professionalCategory: string | null; // e.g., "SENIOR"
  eventRole: string; // [NEW] e.g., "ADMISOR", "COADMISOR", "TITULAR"
  serviceType: string;
  grossAmount: number;
}

export interface SplitDefinition {
  beneficiary: BeneficiaryType;
  type: SplitType;
  value: number; // Percentage (0-100) or Fixed cents
  roleLabel?: string;
}

export interface SplitResult {
  beneficiaryType: BeneficiaryType;
  beneficiaryId: string | null; // null for Org
  amount: number;
  roleLabel?: string;
}

@Injectable()
export class FeeResolutionService {
  private readonly logger = new Logger(FeeResolutionService.name);

  constructor(private prisma: PrismaService) { }

  async calculateSplits(context: WorkContext): Promise<SplitResult[]> {
    const now = new Date();

    // Fetch Organization Type to determine strategy
    const org = await this.prisma.organization.findUnique({
      where: { id: context.organizationId },
      select: { type: true },
    });

    if (!org) {
      throw new Error(`Organization ${context.organizationId} not found`);
    }

    // Fetch potential rules
    const rules = await this.prisma.feeRule.findMany({
      where: {
        organizationId: context.organizationId,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
        AND: [
          {
            OR: [{ payerId: null }, { payerId: context.payerId }],
          },
          {
            OR: [
              { professionalCategory: null },
              { professionalCategory: context.professionalCategory },
            ],
          },
          {
            OR: [{ serviceType: null }, { serviceType: context.serviceType }],
          },
          {
            OR: [
              { conditionProfessionalRole: null },
              { conditionProfessionalRole: context.eventRole },
            ],
          },
        ],
      },
    });

    if (rules.length === 0) {
      // [FALLBACK] Check for Payer Retention (Common in Solo Practice)
      if (context.payerId) {
        const payer = await this.prisma.payer.findUnique({ where: { id: context.payerId } });
        if (payer && payer.retentionPercentage && payer.retentionPercentage > 0) {
          const retentionAmount = Number((context.grossAmount * (payer.retentionPercentage / 100)).toFixed(2));
          const proAmount = context.grossAmount - retentionAmount;

          this.logger.log(`No rule found. Using Payer Retention: ${payer.retentionPercentage}% for Payer ${payer.name}`);

          return [
            {
              beneficiaryType: BeneficiaryType.ORG, // Represents the Payer retention (Cost)
              beneficiaryId: null,
              amount: retentionAmount,
              roleLabel: `Retención ${payer.name} (${payer.retentionPercentage}%)`
            },
            {
              beneficiaryType: BeneficiaryType.PROFESSIONAL,
              beneficiaryId: context.professionalId,
              amount: proAmount,
              roleLabel: 'Honorario Profesional'
            }
          ];
        } else if (org.type === OrgType.SOLO_PRACTICE) {
          // If Solo Practice and no retention, 100% to Pro (Self-managed)
          this.logger.log(`No rule found. Solo Practice Default: 100% to Professional.`);
          return [
            {
              beneficiaryType: BeneficiaryType.PROFESSIONAL,
              beneficiaryId: context.professionalId,
              amount: context.grossAmount,
              roleLabel: 'Honorario (Solo Practice)'
            }
          ];
        }
      }

      // [FALLBACK for CLINIC] Use the professional's category percentage
      // This handles the case where no fee rule is configured for the specific payer
      // (e.g., "Particular" payer in Psico LSA) but the professional has a category with a percentage.
      if (org.type === OrgType.CLINIC && context.professionalId) {
        const professional = await this.prisma.professional.findUnique({
          where: { id: context.professionalId },
          include: { category: true },
        });
        const categoryPct = professional?.category?.percentage;
        if (categoryPct != null && categoryPct > 0) {
          const proAmount = Number((context.grossAmount * (categoryPct / 100)).toFixed(2));
          const orgAmount = Number((context.grossAmount - proAmount).toFixed(2));
          this.logger.log(`No rule found. CLINIC fallback: using category "${professional?.category?.name}" (${categoryPct}%) for professional.`);
          const results: SplitResult[] = [
            {
              beneficiaryType: BeneficiaryType.PROFESSIONAL,
              beneficiaryId: context.professionalId,
              amount: proAmount,
              roleLabel: `Honorario (${professional?.category?.name ?? 'Categoría'} - ${categoryPct}%)`,
            },
          ];
          if (orgAmount > 0) {
            results.push({
              beneficiaryType: BeneficiaryType.ORG,
              beneficiaryId: null,
              amount: orgAmount,
              roleLabel: `Comisión Organización (${100 - categoryPct}%)`,
            });
          }
          return results;
        }
      }

      this.logger.warn(
        `No fee rule found for context: ${JSON.stringify(context)}. Defaulting to 100% Org.`,
      );
      return [
        {
          beneficiaryType: BeneficiaryType.ORG,
          beneficiaryId: null,
          amount: context.grossAmount,
          roleLabel: 'Default (No Rule)',
        },
      ];
    }

    // Dynamic Weighting Strategy
    let weightPayer = 0;
    let weightCategory = 0;
    const weightService = 1;
    let weightRole = 0;

    // "ADMISION" logic: Role is King.
    if (
      context.serviceType &&
      context.serviceType.toUpperCase().includes('ADMISION')
    ) {
      weightRole = 8; // Super high priority
      weightCategory = 0; // Category irrelevant for admissions
      weightPayer = 2;
    } else {
      // Standard Session Logic
      if (org.type === OrgType.CLINIC) {
        weightCategory = 4;
        weightPayer = 2;
      } else {
        // SOLO_PRACTICE
        weightPayer = 4;
        weightCategory = 0; // Explicitly ignore category in Solo mode
      }
    }

    const sortedRules = rules.sort((a, b) => {
      const specA =
        (a.payerId ? weightPayer : 0) +
        (a.professionalCategory ? weightCategory : 0) +
        (a.serviceType ? weightService : 0) +
        (a.conditionProfessionalRole ? weightRole : 0);
      const specB =
        (b.payerId ? weightPayer : 0) +
        (b.professionalCategory ? weightCategory : 0) +
        (b.serviceType ? weightService : 0) +
        (b.conditionProfessionalRole ? weightRole : 0);

      if (specA !== specB) return specB - specA;
      return b.validFrom.getTime() - a.validFrom.getTime();
    });

    const bestRule = sortedRules[0];
    // Cast Json to typed array
    const splitsDefinition = bestRule.splits as unknown as SplitDefinition[];

    return this.computeAmounts(context, splitsDefinition);
  }

  private computeAmounts(
    context: WorkContext,
    definitions: SplitDefinition[],
  ): SplitResult[] {
    const results: SplitResult[] = [];
    let totalAllocated = 0;

    for (const split of definitions) {
      let amount = 0;
      if (split.type === SplitType.FIXED) {
        amount = split.value;
      } else {
        // PERCENTAGE (value is 0-100)
        amount = Number((context.grossAmount * (split.value / 100)).toFixed(2));
      }

      const beneficiaryId =
        split.beneficiary === BeneficiaryType.PROFESSIONAL ? context.professionalId : null;

      results.push({
        beneficiaryType: split.beneficiary,
        beneficiaryId,
        amount: amount,
        roleLabel: split.roleLabel,
      });

      totalAllocated += amount;
    }

    // Remainder handling
    if (totalAllocated < context.grossAmount) {
      results.push({
        beneficiaryType: BeneficiaryType.ORG,
        beneficiaryId: null,
        amount: context.grossAmount - totalAllocated,
        roleLabel: 'Remainder',
      });
    }

    return results;
  }
}
