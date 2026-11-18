import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { BeneficiaryType, OrgType, Prisma } from '@prisma/client';
import { PrismaService } from '../../Prisma/prisma.service';
import {
  normalizeSplitDefinitions,
  SplitDefinition,
  SplitType,
} from '@src/domain/features/fee-engine/split-definition';
import {
  distributeByPercentages,
  minMoney,
  Money,
  MoneyInput,
  money,
  nonNegative,
  percentOf,
  roundMoney,
  sumMoney,
} from '@src/domain/seed-work/money';

export interface WorkContext {
  organizationId: string;
  payerId: string;
  professionalId: string;
  professionalCategory: string | null; // e.g., "SENIOR"
  eventRole: string; // [NEW] e.g., "ADMISOR", "COADMISOR", "TITULAR"
  serviceType: string;
  grossAmount: MoneyInput;
}

export interface SplitResult {
  beneficiaryType: BeneficiaryType;
  beneficiaryId: string | null; // null for Org
  amount: Money;
  roleLabel?: string;
}

@Injectable()
export class FeeResolutionService {
  private readonly logger = new Logger(FeeResolutionService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * `db` permite leer dentro de una transacción abierta (ve los registros recién creados).
   * Los ids del contexto ya vienen verificados por quien llama.
   */
  async calculateSplits(
    context: WorkContext,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<SplitResult[]> {
    const now = new Date();
    const gross = roundMoney(context.grossAmount);

    // Fetch Organization Type to determine strategy
    const org = await db.organization.findUnique({
      where: { id: context.organizationId },
      select: { type: true },
    });

    if (!org) {
      // Estado que no debería ocurrir (quien llama ya verificó la organización): 500 genérico, sin el id.
      throw new InternalServerErrorException(
        'Organización no encontrada al calcular la distribución',
      );
    }

    // Fetch potential rules
    const rules = await db.feeRule.findMany({
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
        const payer = await db.payer.findUnique({
          where: { id: context.payerId },
        });
        if (
          payer &&
          payer.retentionPercentage &&
          payer.retentionPercentage > 0
        ) {
          const retentionAmount = percentOf(gross, payer.retentionPercentage);
          const proAmount = gross.sub(retentionAmount);

          this.logger.log(
            `No rule found. Using Payer Retention: ${payer.retentionPercentage}% for Payer ${payer.name}`,
          );

          return [
            {
              beneficiaryType: BeneficiaryType.ORG, // Represents the Payer retention (Cost)
              beneficiaryId: null,
              amount: retentionAmount,
              roleLabel: `Retención ${payer.name} (${payer.retentionPercentage}%)`,
            },
            {
              beneficiaryType: BeneficiaryType.PROFESSIONAL,
              beneficiaryId: context.professionalId,
              amount: proAmount,
              roleLabel: 'Honorario Profesional',
            },
          ];
        } else if (org.type === OrgType.SOLO_PRACTICE) {
          // If Solo Practice and no retention, 100% to Pro (Self-managed)
          this.logger.log(
            `No rule found. Solo Practice Default: 100% to Professional.`,
          );
          return [
            {
              beneficiaryType: BeneficiaryType.PROFESSIONAL,
              beneficiaryId: context.professionalId,
              amount: gross,
              roleLabel: 'Honorario (Solo Practice)',
            },
          ];
        }
      }

      // [FALLBACK for CLINIC] Use the professional's category percentage
      // This handles the case where no fee rule is configured for the specific payer
      // (e.g., "Particular" payer in Psico LSA) but the professional has a category with a percentage.
      if (org.type === OrgType.CLINIC && context.professionalId) {
        const professional = await db.professional.findUnique({
          where: { id: context.professionalId },
          include: { category: true },
        });
        const categoryPct = professional?.category?.percentage;
        if (categoryPct != null && categoryPct > 0) {
          const proAmount = percentOf(gross, categoryPct);
          const orgAmount = gross.sub(proAmount);
          this.logger.log(
            `No rule found. CLINIC fallback: using category "${professional?.category?.name}" (${categoryPct}%) for professional.`,
          );
          const results: SplitResult[] = [
            {
              beneficiaryType: BeneficiaryType.PROFESSIONAL,
              beneficiaryId: context.professionalId,
              amount: proAmount,
              roleLabel: `Honorario (${professional?.category?.name ?? 'Categoría'} - ${categoryPct}%)`,
            },
          ];
          if (orgAmount.greaterThan(0)) {
            results.push({
              beneficiaryType: BeneficiaryType.ORG,
              beneficiaryId: null,
              amount: orgAmount,
              roleLabel: `Comisión Organización (${money(100).sub(categoryPct).toString()}%)`,
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
          amount: gross,
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
    // Forma única del motor; las reglas guardadas en la forma vieja de la UI se normalizan al leer.
    const splitsDefinition = normalizeSplitDefinitions(bestRule.splits);

    return this.computeAmounts(gross, context.professionalId, splitsDefinition);
  }

  /**
   * Reparto al centavo (criterios 3 y 7). Los porcentajes se reparten juntos por el método del mayor resto
   * (desempate: orden de la definición); después se recorren todas las definiciones en orden y cada monto se
   * limita a lo que queda del bruto. Lo que sobra va a una fila ORG `Remainder`.
   */
  private computeAmounts(
    gross: Money,
    professionalId: string,
    definitions: SplitDefinition[],
  ): SplitResult[] {
    const percentIndexes = definitions
      .map((d, i) => (d.type === SplitType.FIXED ? -1 : i))
      .filter((i) => i >= 0);
    const shares = distributeByPercentages(
      gross,
      percentIndexes.map((i) => definitions[i].value),
    );
    const percentAmount = new Map<number, Money>(
      percentIndexes.map((idx, k) => [idx, shares[k]]),
    );

    const results: SplitResult[] = [];
    let allocated: Money = money(0);

    definitions.forEach((split, index) => {
      const wanted =
        split.type === SplitType.FIXED
          ? roundMoney(split.value)
          : (percentAmount.get(index) as Money);
      const amount = nonNegative(minMoney(wanted, gross.sub(allocated)));

      results.push({
        beneficiaryType: split.beneficiary,
        beneficiaryId:
          split.beneficiary === BeneficiaryType.PROFESSIONAL
            ? professionalId
            : null,
        amount,
        roleLabel: split.roleLabel,
      });
      allocated = sumMoney([allocated, amount]);
    });

    // Remainder handling
    if (allocated.lessThan(gross)) {
      results.push({
        beneficiaryType: BeneficiaryType.ORG,
        beneficiaryId: null,
        amount: gross.sub(allocated),
        roleLabel: 'Remainder',
      });
    }

    return results;
  }
}
