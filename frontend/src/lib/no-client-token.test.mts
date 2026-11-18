import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// Guardia del feature 018 (criterio 1): el token de sesion vive en una cookie HttpOnly que emite el backend y no
// llega nunca al JavaScript del navegador. Estatica: lee los fuentes de src/ (sin tests).

const SRC = fileURLToPath(new URL('..', import.meta.url))

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : []
  })

const sources = walk(SRC).map((file) => ({
  file: relative(SRC, file).replace(/\\/g, '/'),
  text: readFileSync(file, 'utf8'),
}))

const isClient = (text: string) => /^\s*(\/\/[^\n]*\n\s*)*['"]use client['"]/.test(text)
const byFile = (name: string) => {
  const found = sources.find((s) => s.file === name)
  assert.ok(found, `no se encontro ${name}`)
  return found.text
}

// Texto de una funcion de data.ts (hasta la siguiente declaracion de nivel superior).
const dataSource = byFile('services/data.ts')
const functionText = (name: string) => {
  const start = dataSource.search(new RegExp(`(export )?(async )?function ${name}\\(`))
  assert.ok(start >= 0, `no se encontro ${name}`)
  const rest = dataSource.slice(start + 1)
  const next = rest.search(/\n(export |async function |function )/)
  return next === -1 ? rest : rest.slice(0, next)
}

test('hay fuentes para revisar', () => {
  assert.ok(sources.length > 50)
})

test('ningun archivo escribe ni lee el token con document.cookie, localStorage o sessionStorage', () => {
  const offenders = sources
    .filter((s) => /document\s*\.\s*cookie|localStorage|sessionStorage/.test(s.text))
    .map((s) => s.file)
  assert.deepEqual(offenders, [])
})

test('nadie importa jwt-decode ni usa jwtDecode', () => {
  const offenders = sources.filter((s) => /jwt-decode|jwtDecode/.test(s.text)).map((s) => s.file)
  assert.deepEqual(offenders, [])
  const pkg = readFileSync(join(SRC, '..', 'package.json'), 'utf8')
  assert.equal(pkg.includes('jwt-decode'), false)
})

test('decodeJwtPayload y AUTH_COOKIE_NAME no aparecen en archivos de cliente', () => {
  const offenders = sources
    .filter((s) => isClient(s.text) && /decodeJwtPayload|AUTH_COOKIE_NAME/.test(s.text))
    .map((s) => s.file)
  assert.deepEqual(offenders, [])
})

test('decodeJwtPayload y AUTH_COOKIE_NAME solo se usan en middleware, session.server y lib/session', () => {
  const allowed = ['middleware.ts', 'services/session.server.ts', 'lib/session.ts']
  const offenders = sources
    .filter((s) => /decodeJwtPayload|AUTH_COOKIE_NAME/.test(s.text) && !allowed.includes(s.file))
    .map((s) => s.file)
  assert.deepEqual(offenders, [])
})

test('desaparecieron los lectores y borradores de cookie del cliente', () => {
  const offenders = sources
    .filter((s) => /readSessionToken|readSessionIdentity|clearSessionCookie|getCookieMaxAgeSeconds|AuthHydrator/.test(s.text))
    .map((s) => s.file)
  assert.deepEqual(offenders, [])
})

test('data.ts arma Authorization solo con un token explicito (servidor)', () => {
  const lines = dataSource.split('\n').filter((line) => /Authorization/.test(line))
  assert.ok(lines.length >= 1)
  for (const line of lines) {
    assert.match(line, /if \(token\)/, `Authorization sin token explicito: ${line.trim()}`)
  }
  assert.equal(/Authorization/.test(functionText('apiFetch')), false)
})

test('login() no lee el token de la respuesta', () => {
  const login = functionText('login')
  assert.equal(/\.token\b|res\.json\(|\.json\(\)/.test(login), false)
})

test('apiFetch, login y logout mandan credentials: include', () => {
  for (const name of ['apiFetch', 'login', 'logout']) {
    assert.ok(functionText(name).includes("credentials: 'include'"), `${name} sin credentials: 'include'`)
  }
})

test('getHeaders manda x-requested-with (CSRF) y login y logout tambien', () => {
  for (const name of ['getHeaders', 'login', 'logout']) {
    assert.ok(functionText(name).includes('CSRF_HEADER_NAME'), `${name} sin header CSRF`)
  }
})

test('solo data.ts llama a fetch (un solo punto de acceso a la API)', () => {
  const offenders = sources.filter((s) => /\bfetch\(/.test(s.text) && s.file !== 'services/data.ts').map((s) => s.file)
  assert.deepEqual(offenders, [])
})

test('el layout de servidor del dashboard pasa la identidad, no el token', () => {
  const layout = byFile('app/(dashboard)/layout.tsx')
  assert.ok(layout.includes('getServerSessionIdentity'))
  assert.equal(/getServerAuthToken/.test(layout), false)
})

test('el middleware no deja que el cliente cree la cookie: la borra con atributos del servidor', () => {
  const middleware = byFile('middleware.ts')
  assert.ok(middleware.includes('sessionCookieDeletion'))
  assert.ok(middleware.includes('legacyCookieDeletion'))
})

test('next.config.ts ya no define el rewrite /api', () => {
  const config = readFileSync(join(SRC, '..', 'next.config.ts'), 'utf8')
  assert.equal(/rewrites|INTERNAL_API_URL/.test(config), false)
})
