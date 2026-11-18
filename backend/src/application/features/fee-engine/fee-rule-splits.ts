import { BadRequestException } from '@nestjs/common';
import { MAX_MONEY_AMOUNT } from '@src/domain/constants/app.constants';

/**
 * Validación del JSON `FeeRule.splits` (feature 007, MEDIA-1; forma única desde el 017, #40).
 *
 * Al escribir solo se acepta la forma del motor (FeeResolutionService / SplitDefinition):
 * { beneficiary, type, value, roleLabel? }. `beneficiary` es ORG o PROFESSIONAL; `type` PERCENTAGE
 * (value 0-100 sobre el bruto) o FIXED (value = monto EN PESOS, hasta 2 decimales). La forma vieja de la UI
 * { role, percentage, beneficiaryType } se rechaza al escribir; al LEER se sigue normalizando
 * (`normalizeSplitDefinitions`).
 *
 * El beneficiario nunca lleva id: el motor asigna PROFESSIONAL al profesional de la atención y el resto
 * a la organización, así que no se acepta ninguna otra clave (beneficiaryId, professionalId, etc.).
 * Los porcentajes de todos los elementos suman como máximo 100.
 */
const MAX_ENTRIES = 20;
const MAX_LABEL = 100;
/** Decimal(10,2): el mayor monto representable. */
const MAX_FIXED = MAX_MONEY_AMOUNT;
const SUM_TOLERANCE = 0.01;

const ENGINE_KEYS = new Set(['beneficiary', 'type', 'value', 'roleLabel']);
const ENGINE_BENEFICIARIES = new Set(['PROFESSIONAL', 'ORG']);

const invalid = () =>
  new BadRequestException({
    code: 'bad-request',
    message: 'La distribución de honorarios no es válida.',
  });

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isOptionalLabel = (v: unknown) =>
  v === undefined || (typeof v === 'string' && v.length <= MAX_LABEL);

/** Monto en pesos con hasta 2 decimales (por su representación decimal más corta). */
const hasAtMostTwoDecimals = (v: number) => /^\d+(\.\d{1,2})?$/.test(String(v));

const hasOnly = (obj: Record<string, unknown>, allowed: Set<string>) =>
  Object.keys(obj).every((k) => allowed.has(k));

/** Lanza 400 genérico si `splits` no cumple el esquema. */
export function validateFeeRuleSplits(splits: unknown): void {
  if (
    !Array.isArray(splits) ||
    splits.length === 0 ||
    splits.length > MAX_ENTRIES
  ) {
    throw invalid();
  }
  let percentTotal = 0;
  for (const entry of splits as unknown[]) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw invalid();
    }
    const e = entry as Record<string, unknown>;
    if (
      !hasOnly(e, ENGINE_KEYS) ||
      typeof e.beneficiary !== 'string' ||
      !ENGINE_BENEFICIARIES.has(e.beneficiary) ||
      !isFiniteNumber(e.value) ||
      e.value < 0 ||
      !isOptionalLabel(e.roleLabel)
    ) {
      throw invalid();
    }
    if (e.type === 'PERCENTAGE') {
      if (e.value > 100) throw invalid();
      percentTotal += e.value;
    } else if (e.type === 'FIXED') {
      if (e.value > MAX_FIXED || !hasAtMostTwoDecimals(e.value))
        throw invalid();
    } else {
      throw invalid();
    }
  }
  if (percentTotal > 100 + SUM_TOLERANCE) throw invalid();
}
