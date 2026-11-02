import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLoginPath,
  decodeJwtPayload,
  getCookieMaxAgeSeconds,
  MAX_SESSION_SECONDS,
  sanitizeFrom,
} from './session.ts'

// Tokens ficticios armados en el test, sin firma válida: solo se decodifica el payload.
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const fakeToken = (payload: unknown) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.firma`

test('sanitizeFrom acepta rutas internas con query', () => {
  assert.equal(sanitizeFrom('/org-1/work-items'), '/org-1/work-items')
  assert.equal(sanitizeFrom('/org-1/work-items?page=2&q=a'), '/org-1/work-items?page=2&q=a')
  assert.equal(sanitizeFrom('/'), '/')
})

test('sanitizeFrom corta el hash', () => {
  assert.equal(sanitizeFrom('/org-1/dashboard#seccion'), '/org-1/dashboard')
})

test('sanitizeFrom rechaza los 8 casos de UX 15', () => {
  const bad: unknown[] = [
    '//ejemplo.com',
    '/\\ejemplo.com',
    'https://ejemplo.com',
    'javascript:alert(1)',
    '/\r\nX', // "/%0d%0aX" ya decodificado
    '/login',
    '',
    '/' + 'a'.repeat(200),
  ]
  for (const value of bad) assert.equal(sanitizeFrom(value), null, JSON.stringify(value))
})

test('sanitizeFrom rechaza esquemas, rutas bloqueadas y tipos que no son string', () => {
  for (const value of [
    '/ruta?u=https://ejemplo.com',
    '/x?a=javascript:alert(1)',
    '/x?a=DATA:text/html',
    '/login?from=/x',
    '/login/otra',
    '/api/x',
    '/sin-acceso',
    '/x\u0000y',
    'org-1/dashboard',
    undefined,
    null,
    42,
    ['/a'],
  ]) {
    assert.equal(sanitizeFrom(value), null, String(value))
  }
})

test('getCookieMaxAgeSeconds respeta exp y el tope de 8 h', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0)
  const nowSec = now / 1000
  assert.equal(getCookieMaxAgeSeconds(fakeToken({ exp: nowSec + 3600 }), now), 3600)
  assert.equal(getCookieMaxAgeSeconds(fakeToken({ exp: nowSec + 10 * 3600 }), now), MAX_SESSION_SECONDS)
  assert.equal(getCookieMaxAgeSeconds(fakeToken({ exp: nowSec - 5 }), now), null)
  assert.equal(getCookieMaxAgeSeconds(fakeToken({ sub: 'x' }), now), null)
  assert.equal(getCookieMaxAgeSeconds('basura', now), null)
  assert.equal(getCookieMaxAgeSeconds('a.b.c', now), null)
})

test('decodeJwtPayload decodifica UTF-8 y devuelve null con basura', () => {
  const payload = decodeJwtPayload(fakeToken({ name: 'María Ñandú', exp: 1 }))
  assert.equal(payload?.name, 'María Ñandú')
  assert.equal(decodeJwtPayload('no-es-un-token'), null)
  assert.equal(decodeJwtPayload('a.%%%.c'), null)
  assert.equal(decodeJwtPayload(`a.${b64url([1, 2])}.c`), null)
})

test('buildLoginPath codifica / como %2F y descarta from inseguro', () => {
  assert.equal(buildLoginPath(), '/login')
  assert.equal(buildLoginPath({ from: '/' }), '/login')
  assert.equal(
    buildLoginPath({ reason: 'session_expired', from: '/org-1/work-items' }),
    '/login?reason=session_expired&from=%2Forg-1%2Fwork-items',
  )
  assert.equal(buildLoginPath({ from: '/org-1/work-items' }), '/login?from=%2Forg-1%2Fwork-items')
  assert.equal(buildLoginPath({ reason: 'otra-cosa', from: '//ejemplo.com' }), '/login')
})

// readSessionIdentity (feature 008): lee la cookie del navegador; se simula `document`.
import { readSessionIdentity } from './session.ts'

const withCookie = (cookie: string | undefined, fn: () => void) => {
  const g = globalThis as unknown as { document?: { cookie: string } }
  const prev = g.document
  if (cookie === undefined) delete g.document
  else g.document = { cookie }
  try {
    fn()
  } finally {
    if (prev === undefined) delete g.document
    else g.document = prev
  }
}

test('readSessionIdentity devuelve sub y professionalId de la cookie', () => {
  const t = fakeToken({ sub: 'u1', professionalId: 'p1' })
  withCookie(`otra=1; auth_token=${t}`, () => {
    assert.deepEqual(readSessionIdentity(), { userId: 'u1', professionalId: 'p1' })
  })
})

test('readSessionIdentity sin professionalId o con tipos inválidos da null', () => {
  withCookie(`auth_token=${fakeToken({ sub: 'u1' })}`, () => {
    assert.deepEqual(readSessionIdentity(), { userId: 'u1', professionalId: null })
  })
  withCookie(`auth_token=${fakeToken({ sub: 5, professionalId: { a: 1 } })}`, () => {
    assert.deepEqual(readSessionIdentity(), { userId: null, professionalId: null })
  })
})

test('readSessionIdentity sin cookie, token basura o sin document da null', () => {
  withCookie('', () => assert.deepEqual(readSessionIdentity(), { userId: null, professionalId: null }))
  withCookie('auth_token=basura', () => assert.deepEqual(readSessionIdentity(), { userId: null, professionalId: null }))
  withCookie(undefined, () => assert.deepEqual(readSessionIdentity(), { userId: null, professionalId: null }))
})
