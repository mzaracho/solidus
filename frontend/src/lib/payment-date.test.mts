import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  editPaymentDateForBody,
  formatPaymentDate,
  initialEditPaymentDate,
  isValidPaymentDate,
  parseLocalDate,
  paymentDateCell,
  paymentDateOnly,
  todayLocalISO,
  toLocalISODate,
} from './payment-date.ts'

test('todayLocalISO usa la fecha LOCAL: a las 22 h el día no pasa al siguiente (toISOString sí lo haría en UTC-3)', () => {
  // 2026-03-05 22:30 hora local (cualquier zona horaria del runner): el día local sigue siendo el 5
  const lateEvening = new Date(2026, 2, 5, 22, 30, 0)
  assert.equal(todayLocalISO(lateEvening), '2026-03-05')
  // 00:10 del día 6 local es el 6, aunque en UTC todavía sea el 5 en zonas al este
  const justAfterMidnight = new Date(2026, 2, 6, 0, 10, 0)
  assert.equal(todayLocalISO(justAfterMidnight), '2026-03-06')
  assert.equal(toLocalISODate(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31')
  assert.equal(toLocalISODate(new Date(2026, 0, 1, 0, 0, 0)), '2026-01-01')
})

test('isValidPaymentDate: yyyy-MM-dd real; rechaza vacío, fechas imposibles, con hora o de otro tipo', () => {
  for (const ok of ['2026-03-05', '2024-02-29', '2026-12-31']) assert.equal(isValidPaymentDate(ok), true, ok)
  for (const bad of ['', '2026-02-30', '2026-13-01', '2025-02-29', '31/12/2026', '2026-03-05T10:00:00Z', 'ayer', null, undefined, 5]) {
    assert.equal(isValidPaymentDate(bad), false, String(bad))
  }
})

test('paymentDateOnly toma el día tal cual viene de la API (medianoche UTC) sin correrlo', () => {
  assert.equal(paymentDateOnly('2026-03-05T00:00:00.000Z'), '2026-03-05')
  assert.equal(paymentDateOnly('2026-03-05'), '2026-03-05')
  assert.equal(paymentDateOnly(null), null)
  assert.equal(paymentDateOnly(''), null)
  assert.equal(paymentDateOnly('basura'), null)
})

test('formatPaymentDate: dd/MM/yyyy sin corrimiento de zona; vacío si no hay fecha', () => {
  assert.equal(formatPaymentDate('2026-03-05T00:00:00.000Z'), '05/03/2026')
  assert.equal(formatPaymentDate('2026-12-31'), '31/12/2026')
  assert.equal(formatPaymentDate(null), '')
  assert.equal(formatPaymentDate(undefined), '')
})

test('parseLocalDate: mediodía local del mismo día', () => {
  const d = parseLocalDate('2026-03-05T00:00:00.000Z')
  assert.ok(d)
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 2)
  assert.equal(d.getDate(), 5)
  assert.equal(d.getHours(), 12)
  assert.equal(parseLocalDate(null), undefined)
})

test('paymentDateCell: fecha, "Sin fecha de pago" para PAID sin fecha, o nada', () => {
  const missing = 'Sin fecha de pago'
  assert.equal(paymentDateCell(true, '2026-03-05T00:00:00.000Z', missing), '05/03/2026')
  assert.equal(paymentDateCell(true, null, missing), missing)
  assert.equal(paymentDateCell(true, '', missing), missing)
  assert.equal(paymentDateCell(false, null, missing), null)
  assert.equal(paymentDateCell(false, '2026-03-05', missing), '05/03/2026')
})

// ─── Edición de una atención ya pagada sin fecha (decisión del PO, 017) ───────

const NOW = new Date(2026, 10, 18, 22, 30, 0)

test('edición de PAGADA sin fecha: el campo arranca VACÍO (no se inventa "hoy")', () => {
  assert.equal(initialEditPaymentDate(true, null, NOW), '')
  assert.equal(initialEditPaymentDate(true, undefined, NOW), '')
  assert.equal(initialEditPaymentDate(true, '', NOW), '')
})

test('edición de PAGADA con fecha: arranca con la guardada, el día tal cual', () => {
  assert.equal(initialEditPaymentDate(true, '2026-03-05T00:00:00.000Z', NOW), '2026-03-05')
})

test('edición de NO pagada: arranca con hoy local (para cuando pase a pagada)', () => {
  assert.equal(initialEditPaymentDate(false, null, NOW), '2026-11-18')
})

test('PAGADA sin fecha, sin tocar la fecha: el body NO lleva paymentDate y no bloquea el guardado', () => {
  const r = editPaymentDateForBody(true, true, initialEditPaymentDate(true, null, NOW))
  assert.deepEqual(r, { ok: true, paymentDate: undefined })
})

test('PAGADA sin fecha, completándola: el body lleva la fecha local elegida', () => {
  const r = editPaymentDateForBody(true, true, '2026-02-27')
  assert.deepEqual(r, { ok: true, paymentDate: '2026-02-27' })
})

test('cambio a Pagado (antes no pagada): precarga hoy y la fecha es obligatoria', () => {
  const pre = initialEditPaymentDate(false, null, NOW)
  assert.deepEqual(editPaymentDateForBody(false, true, pre), { ok: true, paymentDate: '2026-11-18' })
  assert.deepEqual(editPaymentDateForBody(false, true, ''), { ok: false })
  assert.deepEqual(editPaymentDateForBody(false, true, '2026-02-30'), { ok: false })
})

test('estado final no pagado: nunca viaja paymentDate', () => {
  assert.deepEqual(editPaymentDateForBody(true, false, '2026-02-27'), { ok: true, paymentDate: undefined })
  assert.deepEqual(editPaymentDateForBody(false, false, '2026-02-27'), { ok: true, paymentDate: undefined })
})

test('PAGADA con valor inválido (no vacío): se rechaza', () => {
  assert.deepEqual(editPaymentDateForBody(true, true, '2026-13-01'), { ok: false })
})
