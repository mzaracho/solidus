import { InternalServerErrorException } from '@nestjs/common';
import { BeneficiaryType } from '@prisma/client';

export enum SplitType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED = 'FIXED',
}

/**
 * Forma única de `FeeRule.splits` (feature 017, #40): la del motor.
 * `value` es un porcentaje (0-100 sobre el bruto) en PERCENTAGE, o el monto EN PESOS (hasta 2 decimales) en FIXED.
 */
export interface SplitDefinition {
  beneficiary: BeneficiaryType;
  type: SplitType;
  value: number;
  roleLabel?: string;
}

const invalidStored = () =>
  // JSON guardado que no es ninguna de las dos formas: estado que no debería ocurrir (500 controlado, sin datos).
  new InternalServerErrorException(
    'Distribución de honorarios guardada con una forma no válida',
  );

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Lee el JSON guardado y lo lleva a la forma del motor. Acepta la forma vieja de la UI
 * `{ role, percentage, beneficiaryType }` (compatibilidad de lectura, sin migrar datos) y deja igual la del motor.
 */
export function normalizeSplitDefinitions(json: unknown): SplitDefinition[] {
  if (!Array.isArray(json)) throw invalidStored();
  return json.map((raw: unknown): SplitDefinition => {
    if (!isObject(raw)) throw invalidStored();
    if ('percentage' in raw) {
      if (
        typeof raw.percentage !== 'number' ||
        !Number.isFinite(raw.percentage)
      )
        throw invalidStored();
      return {
        beneficiary:
          raw.beneficiaryType === 'PROFESSIONAL'
            ? BeneficiaryType.PROFESSIONAL
            : BeneficiaryType.ORG,
        type: SplitType.PERCENTAGE,
        value: raw.percentage,
        roleLabel: typeof raw.role === 'string' ? raw.role : undefined,
      };
    }
    if (
      (raw.beneficiary !== 'ORG' && raw.beneficiary !== 'PROFESSIONAL') ||
      (raw.type !== 'PERCENTAGE' && raw.type !== 'FIXED') ||
      typeof raw.value !== 'number' ||
      !Number.isFinite(raw.value)
    ) {
      throw invalidStored();
    }
    return {
      beneficiary: raw.beneficiary as BeneficiaryType,
      type: raw.type as SplitType,
      value: raw.value,
      roleLabel: typeof raw.roleLabel === 'string' ? raw.roleLabel : undefined,
    };
  });
}
