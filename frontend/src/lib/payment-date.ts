// Fecha de pago (feature 017, criterio 16). Todo se hace con fechas "solo dia" (yyyy-MM-dd) en la zona horaria
// LOCAL, sin pasar por toISOString() (que usa UTC y corre el dia: a las 22 h de Argentina ya es "manana" en UTC).
// Modulo puro para probarlo con `node --test`.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** yyyy-MM-dd con los componentes LOCALES de la fecha. */
export function toLocalISODate(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** La fecha de hoy (local) como yyyy-MM-dd. */
export function todayLocalISO(now: Date = new Date()): string {
  return toLocalISODate(now)
}

/** true si es yyyy-MM-dd y existe en el calendario (rechaza 2026-02-30, '', fechas con hora, etc.). */
export function isValidPaymentDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = DATE_ONLY.exec(value)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (y < 1900 || y > 2200) return false
  const probe = new Date(y, mo - 1, d, 12, 0, 0, 0)
  return probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === d
}

/**
 * Parte "dia" de una fecha que viene de la API ('2026-03-05' o '2026-03-05T00:00:00.000Z'). El backend guarda la
 * fecha de pago como medianoche UTC del dia elegido, asi que los primeros 10 caracteres son el dia correcto (no hay
 * que convertir a la zona local). null si no hay fecha o no tiene ese formato.
 */
export function paymentDateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const head = value.substring(0, 10)
  return isValidPaymentDate(head) ? head : null
}

/** dd/MM/yyyy de una fecha de pago (sin Date: no hay corrimiento de zona). '' si no hay fecha valida. */
export function formatPaymentDate(value: unknown): string {
  const day = paymentDateOnly(value)
  if (!day) return ''
  const [y, m, d] = day.split('-')
  return `${d}/${m}/${y}`
}

/** Date local a mediodia (para componentes de calendario) o undefined. */
export function parseLocalDate(value: unknown): Date | undefined {
  const day = paymentDateOnly(value)
  if (!day) return undefined
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

/**
 * Texto de la tabla para la fecha de pago: la fecha formateada; o, si la atencion esta PAGADA sin fecha (las
 * antiguas), `missingLabel`; o null si no corresponde mostrar nada.
 */
export function paymentDateCell(isPaid: boolean, paymentDate: unknown, missingLabel: string): string | null {
  const formatted = formatPaymentDate(paymentDate)
  if (formatted) return formatted
  return isPaid ? missingLabel : null
}

/**
 * Fecha de pago con la que arranca el formulario de EDICION (017, decision del PO): la guardada; si la atencion ya
 * esta PAGADA pero nunca tuvo fecha (las antiguas), VACIA (no se inventa una fecha: se conserva la real, que no se
 * conoce); en cualquier otro caso hoy, para cuando la accion pase la atencion a pagada.
 */
export function initialEditPaymentDate(savedPaid: boolean, savedPaymentDate: unknown, now: Date = new Date()): string {
  const saved = paymentDateOnly(savedPaymentDate)
  if (saved) return saved
  return savedPaid ? '' : todayLocalISO(now)
}

export type EditPaymentDateResult = { ok: true; paymentDate: string | undefined } | { ok: false }

/**
 * Que fecha de pago viaja en el PUT de edicion. Solo se manda con el estado final Pagado:
 * - la accion CAMBIA a pagado (antes no lo estaba): la fecha es obligatoria y valida;
 * - ya estaba pagada: si se deja vacia NO viaja (se guardan otros cambios sin tocar la fecha); si se completa, viaja.
 */
export function editPaymentDateForBody(
  savedPaid: boolean,
  willBePaid: boolean,
  value: string,
): EditPaymentDateResult {
  if (!willBePaid) return { ok: true, paymentDate: undefined }
  if (isValidPaymentDate(value)) return { ok: true, paymentDate: value }
  if (savedPaid && value === '') return { ok: true, paymentDate: undefined }
  return { ok: false }
}
