import { BadRequestException } from '@nestjs/common';
import { MAX_MONEY_AMOUNT } from '@src/domain/constants/app.constants';

/**
 * Validación del JSON `FeeRule.splits` (feature 007, MEDIA-1).
 *
 * Hay dos formas en uso, y las dos se aceptan por elemento:
 *  - Forma de la UI (PayerRulesManager): { role, percentage, beneficiaryType }.
 *    `percentage` es el porcentaje (0-100) del monto bruto que recibe ese beneficiario.
 *    `beneficiaryType` es PROFESSIONAL u ORGANIZATION (también se acepta ORG).
 *  - Forma del motor (FeeResolutionService.SplitDefinition): { beneficiary, type, value, roleLabel? }.
 *    `beneficiary` es ORG o PROFESSIONAL; `type` PERCENTAGE (value 0-100) o FIXED (value = monto).
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

const UI_KEYS = new Set(['role', 'percentage', 'beneficiaryType']);
const ENGINE_KEYS = new Set(['beneficiary', 'type', 'value', 'roleLabel']);
const UI_BENEFICIARIES = new Set(['PROFESSIONAL', 'ORGANIZATION', 'ORG']);
const ENGINE_BENEFICIARIES = new Set(['PROFESSIONAL', 'ORG']);

const invalid = () => new BadRequestException({
    code: 'bad-request',
    message: 'La distribución de honorarios no es válida.',
  });

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isOptionalLabel = (v: unknown) =>
  v === undefined || (typeof v === 'string' && v.length <= MAX_LABEL);

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
    if ('percentage' in e) {
      // forma de la UI
      if (
        !hasOnly(e, UI_KEYS) ||
        !isFiniteNumber(e.percentage) ||
        e.percentage < 0 ||
        e.percentage > 100 ||
        typeof e.beneficiaryType !== 'string' ||
        !UI_BENEFICIARIES.has(e.beneficiaryType) ||
        !isOptionalLabel(e.role)
      ) {
        throw invalid();
      }
      percentTotal += e.percentage;
    } else {
      // forma del motor
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
        if (e.value > MAX_FIXED) throw invalid();
      } else {
        throw invalid();
      }
    }
  }
  if (percentTotal > 100 + SUM_TOLERANCE) throw invalid();
}
