import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canDeleteActivity, isActivityCollected } from './activity-permissions.ts'

const me = { userId: 'u1', professionalId: 'p1' }

test('ADMIN puede borrar cualquier atención', () => {
  assert.equal(canDeleteActivity('ADMIN', { createdByUserId: 'otro' }, me), true)
  assert.equal(canDeleteActivity('ADMIN', { createdByUserId: null, professionalId: 'p9' }, me), true)
})

test('MEMBER borra lo propio y no lo ajeno', () => {
  assert.equal(canDeleteActivity('MEMBER', { createdByUserId: 'u1' }, me), true)
  assert.equal(canDeleteActivity('MEMBER', { createdByUserId: 'u2', professionalId: 'p1' }, me), false)
})

test('MEMBER sin autor registrado: solo si es dueño del Professional', () => {
  assert.equal(canDeleteActivity('MEMBER', { createdByUserId: null, professionalId: 'p1' }, me), true)
  assert.equal(canDeleteActivity('MEMBER', { createdByUserId: null, professionalId: 'p2' }, me), false)
  assert.equal(canDeleteActivity('MEMBER', { createdByUserId: null, professionalId: null }, me), false)
  assert.equal(
    canDeleteActivity('MEMBER', { createdByUserId: null, professionalId: 'p1' }, { userId: null, professionalId: null }),
    false,
  )
})

test('MEMBER sin identidad legible no borra nada con autor', () => {
  assert.equal(canDeleteActivity('MEMBER', { createdByUserId: 'u1' }, { userId: null, professionalId: null }), false)
})

test('017: isActivityCollected solo lee el isCollected que calcula el backend', () => {
  assert.equal(isActivityCollected({ isCollected: true }), true)
  assert.equal(isActivityCollected({ isCollected: false }), false)
  assert.equal(isActivityCollected({}), false)
  assert.equal(isActivityCollected(null), false)
  assert.equal(isActivityCollected(undefined), false)
  // no deriva "cobrada" de otros campos
  assert.equal(isActivityCollected({ paymentDate: '2026-01-01', status: 'PAID' } as never), false)
})
