import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Prueba estática sobre el texto de data.ts: el ConfigController del backend se eliminó (feature 007)
// y toda la configuración pasa por /org/*.
const source = readFileSync(new URL('./data.ts', import.meta.url), 'utf8')

const functionBody = (name: string) => {
  const start = source.indexOf(`export async function ${name}(`)
  assert.ok(start >= 0, `no se encontró ${name}`)
  const next = source.indexOf('\nexport ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

test('data.ts no llama a rutas /config/ del backend', () => {
  assert.equal(source.includes('${API_BASE_URL}/config/'), false)
  assert.equal(/\/config\/(categories|activity-types)/.test(source), false)
})

test('categorías y tipos de actividad usan /org/*', () => {
  assert.ok(source.includes('${API_BASE_URL}/org/categories'))
  assert.ok(source.includes('${API_BASE_URL}/org/activity-types'))
  for (const name of ['createCategory', 'updateCategory', 'deleteCategory']) {
    assert.ok(functionBody(name).includes('/org/categories'), name)
  }
  for (const name of ['getActivityTypes', 'createActivityType', 'updateActivityType', 'deleteActivityType']) {
    assert.ok(functionBody(name).includes('/org/activity-types'), name)
  }
})

test('getActivityTypes no manda ?orgId= (la organización va en el header)', () => {
  assert.equal(functionBody('getActivityTypes').includes('orgId='), false)
})

test('las escrituras no tragan el error (un 403/404 no debe verse como exito)', () => {
  const writes = [
    'updateWorkItem', 'deleteWorkItem', 'createPatient', 'updatePatient', 'mergePatient',
    'createStaff', 'updateStaff', 'deleteStaff', 'assignStaffCategory', 'createPayer', 'createFeeRule',
    'createCategory', 'updateCategory', 'deleteCategory',
    'createOrgPreset', 'updateOrgPreset', 'deleteOrgPreset',
  ]
  for (const name of writes) {
    const body = functionBody(name)
    const catchPart = body.slice(body.indexOf('catch ('))
    assert.ok(catchPart.includes('throw error'), `${name} debe relanzar el error`)
    assert.equal(/return (null|false|\{ success: false)/.test(catchPart), false, `${name} devuelve un valor de fallo en el catch`)
  }
})

// Feature 009: el modo es una preferencia; la vista efectiva la decide el backend.
test('x-mode solo se manda en createWorkItem', () => {
  const assignments = source.match(/\['x-mode'\]/g) ?? []
  assert.equal(assignments.length, 1)
  assert.ok(functionBody('createWorkItem').includes("['x-mode']"))
})

test('getFeeRules no manda ?mode=', () => {
  assert.equal(functionBody('getFeeRules').includes('mode='), false)
})

test('calculateSettlements no manda organizationId en la query', () => {
  assert.equal(functionBody('calculateSettlements').includes('organizationId='), false)
})

test('createWorkItem no manda mode en el body', () => {
  const body = functionBody('createWorkItem')
  assert.equal(body.includes('JSON.stringify(data)'), false)
  assert.ok(body.includes('const { mode, ...body }'))
})
