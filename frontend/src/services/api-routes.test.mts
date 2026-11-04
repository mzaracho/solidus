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

// Feature 014: la organizacion va en x-org-id; el backend no recibe ?orgId= en org/config.
test('getOrgConfig no manda ?orgId= (la organizacion va en el header)', () => {
  assert.equal(functionBody('getOrgConfig').includes('orgId='), false)
})

// Feature 014: las escrituras arman el body con los builders de request-bodies.ts (lista explicita de campos).
test('las escrituras con body de formulario usan su builder y no mandan el objeto crudo', () => {
  const builders: Record<string, string> = {
    createWorkItem: 'buildCreateActivityBody',
    updateWorkItem: 'buildUpdateActivityBody',
    createStaff: 'buildStaffCreateBody',
    updateStaff: 'buildStaffUpdateBody',
    createPatient: 'buildPatientBody',
    updatePatient: 'buildPatientBody',
    updateOrgSettings: 'buildOrgUpdateBody',
    updateProfessionalProfile: 'buildProProfileBody',
    createFeeRule: 'buildFeeRuleBody',
    createOrgPreset: 'buildPresetBody',
    updateOrgPreset: 'buildPresetBody',
    createActivityType: 'buildActivityTypeBody',
    updateActivityType: 'buildActivityTypeBody',
  }
  for (const [name, builder] of Object.entries(builders)) {
    const body = functionBody(name)
    assert.ok(body.includes(builder), `${name} debe usar ${builder}`)
    assert.equal(/JSON\.stringify\((data|body)\)/.test(body), false, `${name} manda el objeto crudo`)
  }
})

test('getWorkItems arma la query con buildWorkItemsQuery', () => {
  assert.ok(functionBody('getWorkItems').includes('buildWorkItemsQuery('))
})
