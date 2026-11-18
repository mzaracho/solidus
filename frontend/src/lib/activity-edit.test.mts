import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEditActivityBody,
  buildPayerFeeRuleSplits,
  isSavedPaid,
  savedPaymentStatusOf,
  financialChanges,
  professionalPercentOf,
  sameAmount,
  validateAmountInput,
} from './activity-edit.ts'
import { ACTIVITY_EDIT_TEXTS, PAYMENT_METHOD } from './constants.ts'

test('sameAmount compara al centavo: 12500 es igual a 12500.00 y 0.1+0.2 es igual a 0.3', () => {
  assert.equal(sameAmount(12500, 12500.0), true)
  assert.equal(sameAmount(0.1 + 0.2, 0.3), true)
  assert.equal(sameAmount(12500, 12500.01), false)
  assert.equal(sameAmount(null, 5), false)
  assert.equal(sameAmount(Number.NaN, 5), false)
})

test('financialChanges: igual al centavo y mismo pagador no manda nada', () => {
  assert.deepEqual(financialChanges({ grossAmount: 12500, payerId: 'p1' }, { grossAmount: 12500.0, payerId: 'p1' }), {})
})

test('financialChanges: monto distinto y pagador distinto', () => {
  assert.deepEqual(financialChanges({ grossAmount: 100, payerId: 'p1' }, { grossAmount: 150.5, payerId: 'p2' }), {
    grossAmount: 150.5,
    payerId: 'p2',
  })
  assert.deepEqual(financialChanges({ grossAmount: 100, payerId: 'p1' }, { grossAmount: 150.5, payerId: 'p1' }), {
    grossAmount: 150.5,
  })
})

test('financialChanges: null es "pagador particular" y cuenta como cambio; vacío o undefined nunca viajan', () => {
  assert.deepEqual(financialChanges({ grossAmount: 100, payerId: 'p1' }, { payerId: null }), { payerId: null })
  assert.deepEqual(financialChanges({ grossAmount: 100, payerId: 'p1' }, { payerId: '' }), {})
  assert.deepEqual(financialChanges({ grossAmount: 100, payerId: 'p1' }, {}), {})
  // original sin pagador y formulario sin tocar: nada
  assert.deepEqual(financialChanges({ grossAmount: 100, payerId: null }, { payerId: null }), {})
})

test('financialChanges: un monto que no es número finito (campo vacío en edición) no viaja', () => {
  assert.deepEqual(financialChanges({ grossAmount: 100 }, { grossAmount: '' }), {})
  assert.deepEqual(financialChanges({ grossAmount: 100 }, { grossAmount: Number.NaN }), {})
  assert.deepEqual(financialChanges({ grossAmount: 100 }, { grossAmount: null }), {})
})

test('validateAmountInput: los tres mensajes de UX y los valores válidos', () => {
  assert.deepEqual(validateAmountInput(''), { ok: false, message: ACTIVITY_EDIT_TEXTS.invalidAmount })
  assert.deepEqual(validateAmountInput('abc'), { ok: false, message: ACTIVITY_EDIT_TEXTS.invalidAmount })
  assert.deepEqual(validateAmountInput('-5'), { ok: false, message: ACTIVITY_EDIT_TEXTS.negativeAmount })
  assert.deepEqual(validateAmountInput('10.123'), { ok: false, message: ACTIVITY_EDIT_TEXTS.tooManyDecimals })
  assert.deepEqual(validateAmountInput('10'), { ok: true, value: 10 })
  assert.deepEqual(validateAmountInput('10.5'), { ok: true, value: 10.5 })
  assert.deepEqual(validateAmountInput(' 10,25 '), { ok: true, value: 10.25 })
  assert.deepEqual(validateAmountInput('0'), { ok: true, value: 0 })
})

test('professionalPercentOf lee la forma nueva y la vieja de splits', () => {
  assert.equal(
    professionalPercentOf([
      { beneficiary: 'PROFESSIONAL', type: 'PERCENTAGE', value: 65 },
      { beneficiary: 'ORG', type: 'PERCENTAGE', value: 35 },
    ]),
    65,
  )
  assert.equal(
    professionalPercentOf([
      { role: 'PROFESSIONAL', percentage: 70, beneficiaryType: 'PROFESSIONAL' },
      { role: 'ORGANIZATION', percentage: 30, beneficiaryType: 'ORGANIZATION' },
    ]),
    70,
  )
  assert.equal(professionalPercentOf([{ beneficiary: 'ORG', type: 'FIXED', value: 5 }]), null)
  assert.equal(professionalPercentOf(null), null)
  assert.equal(professionalPercentOf('x'), null)
  assert.equal(professionalPercentOf([null, 5]), null)
})

test('buildPayerFeeRuleSplits arma la forma única del motor con el complemento exacto', () => {
  assert.deepEqual(buildPayerFeeRuleSplits(70), [
    { beneficiary: 'PROFESSIONAL', type: 'PERCENTAGE', value: 70, roleLabel: 'Profesional' },
    { beneficiary: 'ORG', type: 'PERCENTAGE', value: 30, roleLabel: 'Organización' },
  ])
  const odd = buildPayerFeeRuleSplits(33.3)
  assert.equal(odd[0].value, 33.3)
  assert.equal(odd[1].value, 66.7)
  // lo que se escribe se lee igual: el usuario ve y guarda el mismo porcentaje
  assert.equal(professionalPercentOf(buildPayerFeeRuleSplits(42.5)), 42.5)
})

test('buildEditActivityBody: editar una PAID antigua sin fecha sin tocar el cobro no manda paymentStatus, paymentMethod ni paymentDate', () => {
  const date = new Date('2026-03-01T12:00:00Z')
  const body = buildEditActivityBody({
    date,
    attendance: 'PRESENT',
    saved: { paymentStatus: 'PAID', paymentMethod: null, paymentDate: null },
    formPaymentStatus: 'PAID',
    formPaymentMethod: PAYMENT_METHOD.CASH,
    paymentDate: undefined,
    changes: {},
  })
  assert.deepEqual(body, { date, attendance: 'PRESENT' })
})

test('buildEditActivityBody: PAID guardada con metodo, mismo metodo y fecha vacia: solo date y attendance', () => {
  const date = new Date('2026-03-01T12:00:00Z')
  const body = buildEditActivityBody({
    date, attendance: 'ABSENT',
    saved: { status: 'PAID', paymentMethod: PAYMENT_METHOD.CREDIT_CARD },
    formPaymentStatus: 'PAID', formPaymentMethod: PAYMENT_METHOD.CREDIT_CARD, paymentDate: undefined, changes: {},
  })
  assert.deepEqual(body, { date, attendance: 'ABSENT' })
})

test('buildEditActivityBody: manda lo que cambio (estado, metodo, fecha, monto, pagador)', () => {
  const date = new Date('2026-03-01T12:00:00Z')
  const body = buildEditActivityBody({
    date, attendance: 'PRESENT',
    saved: { paymentStatus: 'UNPAID' },
    formPaymentStatus: 'PAID', formPaymentMethod: PAYMENT_METHOD.CREDIT_CARD, paymentDate: '2026-03-02',
    changes: { grossAmount: 500, payerId: null },
  })
  assert.deepEqual(body, {
    date, attendance: 'PRESENT', paymentStatus: 'PAID', paymentMethod: PAYMENT_METHOD.CREDIT_CARD,
    paymentDate: '2026-03-02', grossAmount: 500, payerId: null,
  })
})

test('buildEditActivityBody: PAID a Pendiente manda paymentStatus; PAID con la fecha completada manda la fecha sin estado', () => {
  const date = new Date('2026-03-01T12:00:00Z')
  const a = buildEditActivityBody({
    date, attendance: 'PRESENT', saved: { paymentStatus: 'PAID', paymentMethod: PAYMENT_METHOD.CASH },
    formPaymentStatus: 'UNPAID', formPaymentMethod: PAYMENT_METHOD.CASH, paymentDate: undefined, changes: {},
  })
  assert.equal(a.paymentStatus, 'UNPAID')
  const b = buildEditActivityBody({
    date, attendance: 'PRESENT', saved: { paymentStatus: 'PAID' },
    formPaymentStatus: 'PAID', formPaymentMethod: PAYMENT_METHOD.CASH, paymentDate: '2026-02-03', changes: {},
  })
  assert.equal(b.paymentStatus, undefined)
  assert.equal(b.paymentDate, '2026-02-03')
})

test('isSavedPaid y savedPaymentStatusOf leen status, paymentStatus y paid', () => {
  assert.equal(isSavedPaid({ status: 'PAID' }), true)
  assert.equal(isSavedPaid({ paid: true }), true)
  assert.equal(isSavedPaid(null), false)
  assert.equal(savedPaymentStatusOf({ status: 'PARTIAL' }), 'PARTIAL')
  assert.equal(savedPaymentStatusOf({ paymentStatus: 'PENDING' }), 'UNPAID')
})
