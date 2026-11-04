import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowedViewModes, pickViewMode, canSeeRestrictedLinks } from './view-mode.ts'

const ORG = 'ORGANIZATION'
const PRO = 'PROFESSIONAL'

test('ADMIN con los dos codigos: las dos vistas', () => {
  assert.deepEqual(allowedViewModes({ orgRole: 'ADMIN', roles: [{ code: ORG }, { code: PRO }] }), [ORG, PRO])
})

test('MEMBER sin PROFESSIONAL: solo organizacion', () => {
  assert.deepEqual(allowedViewModes({ orgRole: 'MEMBER', roles: [{ code: ORG }] }), [ORG])
})

test('sin membresia y con PROFESSIONAL: solo profesional', () => {
  assert.deepEqual(allowedViewModes({ orgRole: null, roles: [{ code: PRO }] }), [PRO])
})

test('sin membresia y con professionalId: solo profesional', () => {
  assert.deepEqual(allowedViewModes({ orgRole: null, roles: [], professionalId: 'p1' }), [PRO])
})

test('sin datos: ninguna', () => {
  assert.deepEqual(allowedViewModes({}), [])
  assert.deepEqual(allowedViewModes({ orgRole: null, roles: null }), [])
})

test('pickViewMode mantiene la actual si esta permitida y si no elige la primera', () => {
  assert.equal(pickViewMode(PRO, [ORG, PRO]), PRO)
  assert.equal(pickViewMode(ORG, [PRO]), PRO)
  assert.equal(pickViewMode(ORG, []), ORG)
})

test('enlaces restringidos: solo ADMIN', () => {
  assert.equal(canSeeRestrictedLinks('ADMIN'), true)
  assert.equal(canSeeRestrictedLinks('MEMBER'), false)
  assert.equal(canSeeRestrictedLinks(null), false)
  assert.equal(canSeeRestrictedLinks(undefined), false)
})
