import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapActivityToWorkItem } from './data-schema.ts'

const api = {
  id: 'a1',
  date: '2026-03-05',
  serviceType: 'consulta',
  patientName: 'Paciente Ficticio',
  professionalId: 'p1',
  professionalName: 'Prof Ficticio',
  payerName: 'Pagador X',
  status: 'PAID',
  paymentDate: '2026-03-06T00:00:00.000Z',
  createdByUserId: 'u1',
  grossAmount: 1500,
  netAmount: 900,
}

test('mapea los campos de GET /activity a la fila', () => {
  const r = mapActivityToWorkItem(api)
  assert.equal(r.id, 'a1')
  assert.equal(r.date.getFullYear(), 2026)
  assert.equal(r.date.getDate(), 5)
  assert.equal(r.professionalName, 'Prof Ficticio')
  assert.equal(r.payerName, 'Pagador X')
  assert.equal(r.status, 'PAID')
  assert.equal(r.grossAmount, 1500)
  assert.equal(r.netAmount, 900)
  assert.equal(r.createdByUserId, 'u1')
})

test('datos faltantes: "—" y null, sin romper', () => {
  const r = mapActivityToWorkItem({ id: 7, date: '2026-03-05', payerName: 'Unknown', netAmount: null })
  assert.equal(r.id, '7')
  // 017: el faltante ya no se convierte en '—' (ese texto se reenviaba como valor, M2 del 008)
  assert.equal(r.payerName, null)
  assert.equal(r.payerId, null)
  assert.equal(r.isCollected, false)
  assert.equal(r.patientName, '—')
  assert.equal(r.grossAmount, null)
  assert.equal(r.netAmount, null)
  assert.equal(r.createdByUserId, null)
})

test('grossAmount/netAmount como string numérico (Decimal serializado) se convierten a número', () => {
  const r = mapActivityToWorkItem({ ...api, grossAmount: '1500.50', netAmount: '900.25' })
  assert.equal(r.grossAmount, 1500.5)
  assert.equal(r.netAmount, 900.25)
})

test('montos inválidos o vacíos dan null; el cero se conserva', () => {
  assert.equal(mapActivityToWorkItem({ ...api, grossAmount: 'abc' }).grossAmount, null)
  assert.equal(mapActivityToWorkItem({ ...api, grossAmount: '' }).grossAmount, null)
  assert.equal(mapActivityToWorkItem({ ...api, grossAmount: 0 }).grossAmount, 0)
  assert.equal(mapActivityToWorkItem({ ...api, netAmount: '0.00' }).netAmount, 0)
})

test('date con hora ISO conserva el día (sin retroceder por zona horaria)', () => {
  const r = mapActivityToWorkItem({ ...api, date: '2026-03-05T00:00:00.000Z' })
  assert.equal(r.date.getFullYear(), 2026)
  assert.equal(r.date.getMonth(), 2)
  assert.equal(r.date.getDate(), 5)
})

test('status vacío o faltante da cadena vacía; PARTIAL y UNPAID pasan tal cual', () => {
  assert.equal(mapActivityToWorkItem({ id: 1, date: '2026-03-05' }).status, '')
  assert.equal(mapActivityToWorkItem({ ...api, status: 'PARTIAL' }).status, 'PARTIAL')
  assert.equal(mapActivityToWorkItem({ ...api, status: 'UNPAID' }).status, 'UNPAID')
})

test('017: payerName vacío o Unknown da null y nunca el guion; payerId e isCollected pasan tal cual', () => {
  for (const payerName of [undefined, null, '', 'Unknown']) {
    const r = mapActivityToWorkItem({ ...api, payerName })
    assert.equal(r.payerName, null)
    assert.notEqual(r.payerName, '—')
  }
  const r = mapActivityToWorkItem({ ...api, payerId: 'pay-1', isCollected: true })
  assert.equal(r.payerId, 'pay-1')
  assert.equal(r.isCollected, true)
  assert.equal(mapActivityToWorkItem({ ...api, isCollected: false }).isCollected, false)
  // un valor que no es exactamente true no cuenta como cobrada
  assert.equal(mapActivityToWorkItem({ ...api, isCollected: 'true' as unknown as boolean }).isCollected, false)
})
