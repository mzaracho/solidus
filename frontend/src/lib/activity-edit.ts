// Edicion de monto y pagador de una atencion (feature 017, #45). Modulo puro (solo presentacion): el backend es la
// autoridad. Se prueba con `node --test`.
import { ACTIVITY_EDIT_TEXTS, PAYER_SPLIT_LABELS, PAYMENT_METHOD, PAYMENT_STATUS } from './constants.ts'

export type EditableFinancials = {
  grossAmount?: number | null
  payerId?: string | null
}

/** Monto en centavos enteros: compara 12500 con 12500.00 sin errores de coma flotante (solo presentacion). */
const toCents = (n: number) => Math.round(n * 100)

export function sameAmount(a: number | null | undefined, b: number | null | undefined): boolean {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return false
  return toCents(a) === toCents(b)
}

/**
 * Solo lo que cambio respecto de lo guardado (UX 2): `grossAmount` si es un numero finito distinto al centavo, y
 * `payerId` si el formulario lo definio y es distinto. `null` significa "pagador particular" y '' / undefined
 * significan "no se toco" (nunca se manda un valor falso).
 */
export function financialChanges(
  original: EditableFinancials,
  edited: { grossAmount?: number | string | null; payerId?: string | null },
): { grossAmount?: number; payerId?: string | null } {
  const out: { grossAmount?: number; payerId?: string | null } = {}
  const gross = edited.grossAmount
  if (typeof gross === 'number' && Number.isFinite(gross) && !sameAmount(gross, original.grossAmount ?? null)) {
    out.grossAmount = gross
  }
  const payer = edited.payerId
  if (payer !== undefined && payer !== '' && payer !== (original.payerId ?? null)) {
    out.payerId = payer
  }
  return out
}

export type AmountValidation = { ok: true; value: number } | { ok: false; message: string }

/** Validacion local del monto (UX 2.1); el limite del backend sigue siendo la autoridad. */
export function validateAmountInput(text: string): AmountValidation {
  const raw = text.trim().replace(',', '.')
  if (raw === '' || !/^-?\d+(\.\d*)?$/.test(raw)) return { ok: false, message: ACTIVITY_EDIT_TEXTS.invalidAmount }
  if (raw.startsWith('-')) return { ok: false, message: ACTIVITY_EDIT_TEXTS.negativeAmount }
  const decimals = raw.includes('.') ? raw.split('.')[1].length : 0
  if (decimals > 2) return { ok: false, message: ACTIVITY_EDIT_TEXTS.tooManyDecimals }
  const value = Number(raw)
  if (!Number.isFinite(value)) return { ok: false, message: ACTIVITY_EDIT_TEXTS.invalidAmount }
  return { ok: true, value }
}

type SplitLike = Record<string, unknown>

/**
 * Porcentaje del profesional de una regla de honorarios, leyendo las DOS formas de `splits`: la del motor
 * `{ beneficiary: 'PROFESSIONAL', type: 'PERCENTAGE', value }` y la vieja de la UI
 * `{ beneficiaryType: 'PROFESSIONAL', percentage }`. null si no hay.
 */
export function professionalPercentOf(splits: unknown): number | null {
  if (!Array.isArray(splits)) return null
  for (const raw of splits) {
    if (raw === null || typeof raw !== 'object') continue
    const s = raw as SplitLike
    if (s.beneficiary === 'PROFESSIONAL' && s.type === 'PERCENTAGE' && typeof s.value === 'number') return s.value
    if (s.beneficiaryType === 'PROFESSIONAL' && typeof s.percentage === 'number') return s.percentage
  }
  return null
}

/** `splits` de una regla de pagador en la forma unica del motor (#40): profesional y resto para la organizacion. */
export function buildPayerFeeRuleSplits(professionalPercent: number) {
  const pro = Math.round(professionalPercent * 100) / 100
  const org = Math.round((100 - pro) * 100) / 100
  return [
    { beneficiary: 'PROFESSIONAL', type: 'PERCENTAGE', value: pro, roleLabel: PAYER_SPLIT_LABELS.professional },
    { beneficiary: 'ORG', type: 'PERCENTAGE', value: org, roleLabel: PAYER_SPLIT_LABELS.organization },
  ]
}

/** Lo que el formulario sabe del cobro guardado (el listado usa `status`; el detalle y las filas mapeadas, `paymentStatus`). */
export type SavedPayment = {
  paymentStatus?: string | null
  status?: string | null
  paid?: boolean | null
  paymentMethod?: string | null
  paymentDate?: unknown
}

/** La atencion guardada ya esta pagada. */
export function isSavedPaid(saved: SavedPayment | null | undefined): boolean {
  return !!saved && ((saved.paymentStatus ?? saved.status) === PAYMENT_STATUS.PAID || saved.paid === true)
}

/** Estado de pago guardado normalizado a PAID / PARTIAL / UNPAID. */
export function savedPaymentStatusOf(saved: SavedPayment | null | undefined): string {
  if (isSavedPaid(saved)) return PAYMENT_STATUS.PAID
  return (saved?.paymentStatus ?? saved?.status) === PAYMENT_STATUS.PARTIAL ? PAYMENT_STATUS.PARTIAL : PAYMENT_STATUS.UNPAID
}

export type EditActivityBody = {
  date: Date
  attendance: string
  paymentStatus?: string
  paymentMethod?: string
  paymentDate?: string
  grossAmount?: number
  payerId?: string | null
}

/**
 * Body del PUT de edicion de una atencion (017, MAYOR-1). `paymentStatus` y `paymentMethod` solo viajan si
 * cambiaron respecto de lo guardado: asi editar otro campo de una PAID antigua sin fecha no re-manda PAID. La fecha
 * de pago solo viaja si hay una (ya validada por quien llama). `changes` son monto/pagador (vacio si cobrada).
 */
export function buildEditActivityBody(input: {
  date: Date
  attendance: string
  saved: SavedPayment | null | undefined
  formPaymentStatus: string
  formPaymentMethod: string
  paymentDate: string | undefined
  changes: { grossAmount?: number; payerId?: string | null }
}): EditActivityBody {
  const statusChanged = input.formPaymentStatus !== savedPaymentStatusOf(input.saved)
  const savedMethod = input.saved?.paymentMethod || PAYMENT_METHOD.CASH
  const body: EditActivityBody = { date: input.date, attendance: input.attendance }
  if (statusChanged) body.paymentStatus = input.formPaymentStatus
  if (statusChanged || input.formPaymentMethod !== savedMethod) body.paymentMethod = input.formPaymentMethod
  if (input.paymentDate) body.paymentDate = input.paymentDate
  return { ...body, ...input.changes }
}
