import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mapLoginFailure, parseRetryAfterSeconds, retryAfterMinutes } from '../lib/session.ts'

// data.ts usa el alias @/ y no se puede importar con node --test: el mapeo de status vive en
// lib/session.ts (función pura) y se prueba por comportamiento; aquí solo se verifica que login() la usa.
const data = readFileSync(new URL('./data.ts', import.meta.url), 'utf8')
const constants = readFileSync(new URL('../lib/constants.ts', import.meta.url), 'utf8')
const form = readFileSync(new URL('../components/domain/auth/LoginForm.tsx', import.meta.url), 'utf8')

test('mapLoginFailure: 429 es rate-limited con retryAfter validado', () => {
  assert.deepEqual(mapLoginFailure(429, '900'), { status: 'rate-limited', retryAfter: 900 })
  assert.deepEqual(mapLoginFailure(429, null), { status: 'rate-limited', retryAfter: null })
  assert.deepEqual(mapLoginFailure(429, 'abc'), { status: 'rate-limited', retryAfter: null })
  assert.deepEqual(mapLoginFailure(429, undefined), { status: 'rate-limited', retryAfter: null })
})

test('mapLoginFailure: el resto de los status', () => {
  assert.deepEqual(mapLoginFailure(401, '900'), { status: 'invalid' })
  assert.deepEqual(mapLoginFailure(400, null), { status: 'bad-request' })
  assert.deepEqual(mapLoginFailure(500, null), { status: 'server' })
  assert.deepEqual(mapLoginFailure(503, null), { status: 'server' })
  assert.deepEqual(mapLoginFailure(403, null), { status: 'other' })
  assert.deepEqual(mapLoginFailure(404, null), { status: 'other' })
  assert.deepEqual(mapLoginFailure(302, null), { status: 'other' })
})

test('mapLoginFailure: 2xx devuelve null (se lee el token del cuerpo)', () => {
  assert.equal(mapLoginFailure(200, null), null)
  assert.equal(mapLoginFailure(201, null), null)
})

test('login() usa mapLoginFailure con el header Retry-After', () => {
  assert.ok(data.includes("mapLoginFailure(res.status, res.headers.get('Retry-After'))"))
  assert.match(data, /status: 'rate-limited'; retryAfter: number \| null/)
})

test('el texto del 429 vive en SESSION_MESSAGES y LoginForm no lo duplica como literal', () => {
  assert.ok(constants.includes('Demasiados intentos. Esperá unos minutos antes de volver a intentar.'))
  assert.ok(constants.includes('Probá de nuevo en 1 minuto.'))
  assert.ok(constants.includes('Probá de nuevo en {n} minutos.'))
  assert.equal(form.includes('Demasiados intentos'), false)
  assert.ok(form.includes('SESSION_MESSAGES.rateLimited'))
})

test('parseRetryAfterSeconds acepta segundos enteros y descarta lo demás', () => {
  assert.equal(parseRetryAfterSeconds('900'), 900)
  assert.equal(parseRetryAfterSeconds(' 45 '), 45)
  for (const bad of [null, undefined, '', '0', '-5', '1.5', 'abc', '10s', '86401', '9999999', 'Wed, 21 Oct 2026 07:28:00 GMT']) {
    assert.equal(parseRetryAfterSeconds(bad), null, String(bad))
  }
})

test('retryAfterMinutes redondea hacia arriba con mínimo 1', () => {
  assert.equal(retryAfterMinutes(1), 1)
  assert.equal(retryAfterMinutes(60), 1)
  assert.equal(retryAfterMinutes(61), 2)
  assert.equal(retryAfterMinutes(900), 15)
})
