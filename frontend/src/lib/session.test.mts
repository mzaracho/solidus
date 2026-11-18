import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTH_COOKIE_NAME,
  buildLoginPath,
  decodeJwtPayload,
  EMPTY_SESSION_IDENTITY,
  identityFromPayload,
  legacyCookieDeletion,
  resolveBrowserApiBase,
  sanitizeFrom,
  sessionCookieDeletion,
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

test('el nombre de la cookie es solidus_session (la vieja auth_token ya no autentica)', () => {
  assert.equal(AUTH_COOKIE_NAME, 'solidus_session')
})

test('identityFromPayload extrae los claims de presentacion', () => {
  const identity = identityFromPayload({
    sub: 'u1',
    name: 'Ana',
    email: 'ana@example.test',
    organizationId: 'org-1',
    orgRole: 'MEMBER',
    professionalId: 'p1',
    roles: [{ code: 'PROFESSIONAL', name: 'Profesional' }],
  })
  assert.deepEqual(identity, {
    userId: 'u1',
    name: 'Ana',
    email: 'ana@example.test',
    organizationId: 'org-1',
    orgRole: 'MEMBER',
    professionalId: 'p1',
    roles: [{ code: 'PROFESSIONAL', name: 'Profesional' }],
  })
})

test('identityFromPayload con tipos invalidos o sin payload deja null y []', () => {
  assert.deepEqual(identityFromPayload(null), EMPTY_SESSION_IDENTITY)
  assert.deepEqual(identityFromPayload({ sub: 5, professionalId: { a: 1 }, orgRole: 7, roles: 'x' }), EMPTY_SESSION_IDENTITY)
  assert.deepEqual(identityFromPayload({ sub: '', roles: [null, 3, { name: 'sin code' }, { code: 'A' }] }).roles, [
    { code: 'A', name: 'A' },
  ])
  assert.equal(identityFromPayload({ orgRole: null }).orgRole, null)
})

test('identityFromPayload devuelve copias: no comparte el objeto vacio', () => {
  const a = identityFromPayload(null)
  a.roles.push({ code: 'X', name: 'X' })
  assert.deepEqual(identityFromPayload(null).roles, [])
})

test('resolveBrowserApiBase alinea localhost y 127.0.0.1 en los dos sentidos', () => {
  assert.equal(resolveBrowserApiBase('http://localhost:8080/api', '127.0.0.1'), 'http://127.0.0.1:8080/api')
  assert.equal(resolveBrowserApiBase('http://127.0.0.1:8080/api', 'localhost'), 'http://localhost:8080/api')
  assert.equal(resolveBrowserApiBase('http://localhost:8081/api', 'localhost'), 'http://localhost:8081/api')
})

test('resolveBrowserApiBase no toca hosts que no son localhost ni 127.0.0.1, dominios ni URLs invalidas', () => {
  assert.equal(resolveBrowserApiBase('http://localhost:8080/api', '192.0.2.20'), 'http://localhost:8080/api')
  assert.equal(resolveBrowserApiBase('http://192.0.2.20:8080/api', 'localhost'), 'http://192.0.2.20:8080/api')
  assert.equal(resolveBrowserApiBase('https://api.example.test/api', '127.0.0.1'), 'https://api.example.test/api')
  assert.equal(resolveBrowserApiBase('no es una url', '127.0.0.1'), 'no es una url')
  assert.equal(resolveBrowserApiBase('http://localhost:8080', '127.0.0.1'), 'http://127.0.0.1:8080')
})

test('sessionCookieDeletion usa los mismos atributos que la cookie emitida, con Max-Age=0', () => {
  assert.deepEqual(sessionCookieDeletion(false), { httpOnly: true, sameSite: 'lax', path: '/', secure: false, maxAge: 0 })
  assert.equal(sessionCookieDeletion(true).secure, true)
})

test('legacyCookieDeletion borra auth_token en Path=/', () => {
  assert.deepEqual(legacyCookieDeletion(false), { path: '/', sameSite: 'lax', secure: false, maxAge: 0 })
})
