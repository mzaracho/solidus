import { test } from 'node:test'
import assert from 'node:assert/strict'
import { payEach, pruneSelection, removeFromSelection, selectedById } from './bulk-payment.ts'

const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

test('selectedById selecciona por id y no por posicion', () => {
  assert.deepEqual(selectedById(rows, { b: true }), [{ id: 'b' }])
  // Tras cobrar "a", las filas se corren: la seleccion de "c" sigue apuntando a "c"
  assert.deepEqual(selectedById(rows.slice(1), { c: true }), [{ id: 'c' }])
  assert.deepEqual(selectedById(rows, { x: true, a: false }), [])
})

test('pruneSelection descarta ids que ya no estan y conserva el objeto si no hay cambios', () => {
  const sel = { a: true, c: true }
  assert.equal(pruneSelection(sel, rows), sel)
  assert.deepEqual(pruneSelection({ a: true, z: true }, rows), { a: true })
  // borrado de "a": no queda seleccion apuntando a otras filas
  assert.deepEqual(pruneSelection({ a: true }, rows.slice(1)), {})
})

test('removeFromSelection saca las ya cobradas', () => {
  assert.deepEqual(removeFromSelection({ a: true, b: true, c: true }, ['a', 'c']), { b: true })
})

test('payEach: fallo parcial devuelve cobradas y fallidas; reintentar solo manda las fallidas', async () => {
  const sent: string[] = []
  let failB = true
  const pay = async (item: { id: string }) => {
    sent.push(item.id)
    if (item.id === 'b' && failB) throw new Error('boom')
  }
  const first = await payEach(rows, pay)
  assert.deepEqual(first.paid.map((r) => r.id), ['a', 'c'])
  assert.deepEqual(first.failed.map((r) => r.id), ['b'])
  assert.ok(first.lastError instanceof Error)
  failB = false
  const second = await payEach(first.failed, pay)
  assert.deepEqual(second.failed, [])
  // "a" y "c" se mandaron una sola vez en total
  assert.deepEqual(sent, ['a', 'b', 'c', 'b'])
})
