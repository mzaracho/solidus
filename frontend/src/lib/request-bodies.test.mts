import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as bodies from './request-bodies.ts'

// Contrato con el backend (feature 014): lo que arma cada builder tiene que ser igual al `body` del fixture
// compartido, que el backend reenvia a sus rutas reales (backend/test/org-isolation.spec.ts, seccion (p)).
const fixture = JSON.parse(
  readFileSync(new URL('../../../backend/test/fixtures/frontend-request-bodies.json', import.meta.url), 'utf8'),
) as { cases: Array<{ name: string; builder?: string; input?: unknown; body: unknown }> }

const run = (builder: string, input: unknown): unknown => {
  const [name, kind] = builder.split(':')
  const fn = (bodies as unknown as Record<string, (data: unknown, kind?: string) => unknown>)[name]
  assert.equal(typeof fn, 'function', `no existe el builder ${name}`)
  // se simula el viaje por JSON: los undefined y los NaN desaparecen o pasan a null, como en la red
  return JSON.parse(JSON.stringify(fn(input, kind)))
}

const withBuilder = fixture.cases.filter((c) => c.builder)

test('el fixture tiene casos con builder y casos literales', () => {
  assert.ok(withBuilder.length >= 20)
  assert.ok(fixture.cases.some((c) => !c.builder))
})

for (const c of withBuilder) {
  test(`builder == body del fixture: ${c.name}`, () => {
    assert.deepEqual(run(c.builder as string, c.input), c.body)
  })
}

test('ningún body del fixture lleva mode, organization, userId, paid, gross ni claves de más', () => {
  for (const c of fixture.cases) {
    const body = c.body as Record<string, unknown>
    for (const forbidden of ['mode', 'organization', 'userId', 'paid', 'gross', 'orgId']) {
      assert.equal(forbidden in body, false, `${c.name}: ${forbidden}`)
    }
  }
})

test('el update de tipos de actividad no manda code', () => {
  const body = bodies.buildActivityTypeBody({ code: 'x', name: 'N' }, 'update')
  assert.equal('code' in body, false)
  assert.equal('code' in bodies.buildActivityTypeBody({ code: 'x', name: 'N' }, 'create'), true)
})

test('las claves de cada body son un subconjunto de su lista de campos', () => {
  const noise = { mode: 'org', organization: { connect: { id: 'x' } }, userId: 'u', paid: true, gross: 5, extra: 1 }
  const subset = (body: Record<string, unknown>, fields: readonly string[]) =>
    Object.keys(body).every((k) => fields.includes(k))
  assert.ok(subset(bodies.buildCreateActivityBody({ ...noise, patientId: 'p', date: 'd' }), bodies.ACTIVITY_CREATE_FIELDS))
  assert.ok(subset(bodies.buildUpdateActivityBody({ ...noise, attendance: 'PRESENT' }), bodies.ACTIVITY_UPDATE_FIELDS))
  assert.ok(subset(bodies.buildStaffCreateBody({ ...noise, name: 'n' }), bodies.STAFF_CREATE_FIELDS))
  assert.ok(subset(bodies.buildStaffUpdateBody({ ...noise, name: 'n' }), bodies.STAFF_UPDATE_FIELDS))
  assert.ok(subset(bodies.buildPatientBody({ ...noise, firstName: 'n' }), bodies.PATIENT_FIELDS))
  assert.ok(subset(bodies.buildOrgUpdateBody({ ...noise, name: 'n' }), bodies.ORG_UPDATE_FIELDS))
  assert.ok(subset(bodies.buildProProfileBody({ ...noise, phone: '1' }), bodies.PRO_PROFILE_FIELDS))
  assert.ok(subset(bodies.buildFeeRuleBody({ ...noise, name: 'n' }), bodies.FEE_RULE_FIELDS))
  assert.ok(subset(bodies.buildPresetBody({ ...noise, name: 'n' }), bodies.PRESET_FIELDS))
  assert.ok(subset(bodies.buildActivityTypeBody({ ...noise, name: 'n' }, 'update'), bodies.ACTIVITY_TYPE_UPDATE_FIELDS))
})

test('settings de la organización: solo las claves declaradas', () => {
  const body = bodies.buildOrgUpdateBody({ name: 'n', settings: { alertsDays: 30, emailNotifs: true, foo: 1 } })
  assert.deepEqual(body.settings, { alertsDays: 30, emailNotifs: true })
})

test('createWorkItem usa gross como alias de amount solo si falta amount', () => {
  assert.equal(bodies.buildCreateActivityBody({ gross: 10 }).amount, 10)
  assert.equal(bodies.buildCreateActivityBody({ gross: 10, amount: 20 }).amount, 20)
  assert.equal('amount' in bodies.buildCreateActivityBody({ gross: Number.NaN }), false)
  assert.equal('amount' in bodies.buildCreateActivityBody({ amount: '100' }), false)
})

test('buildWorkItemsQuery: mode, page, limit y solo los filtros que declara el DTO', () => {
  assert.deepEqual(bodies.buildWorkItemsQuery('ORGANIZATION', undefined, 1, 20), {
    mode: 'ORGANIZATION',
    page: '1',
    limit: '20',
  })
  const query = bodies.buildWorkItemsQuery(
    'PROFESSIONAL',
    { patient: 'Ana', status: 'PAID', startDate: '2026-01-01', endDate: '2026-01-31', payer: 'pid', method: 'Efectivo', foo: 'x', type: '' },
    2,
    12,
  )
  assert.deepEqual(query, {
    mode: 'PROFESSIONAL',
    page: '2',
    limit: '12',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    status: 'PAID',
    payerId: 'pid',
    search: 'Ana',
  })
  assert.equal('patient' in query, false)
  assert.equal('payer' in query, false)
  assert.deepEqual(bodies.buildWorkItemsQuery('ORGANIZATION', { patientId: 'p1' }, 1, 12).patientId, 'p1')
})
