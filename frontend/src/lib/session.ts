// Helpers de sesión SIN imports: se usan en servidor, cliente y middleware (Edge), y se prueban con
// `node --test` sin dependencias (ver session.test.mts). Solo sintaxis que Node puede "strip" (sin enums).

/** Cookie de sesión HttpOnly que emite el backend (018). Debe coincidir con `AUTH_COOKIE_NAME` del backend. */
export const AUTH_COOKIE_NAME = 'solidus_session'
/** Cookie anterior (la escribía el navegador desde JS): ya no autentica; el middleware la borra. */
export const LEGACY_AUTH_COOKIE_NAME = 'auth_token'
export const SESSION_EXPIRED_REASON = 'session_expired'
/** Header propio que el backend exige en las escrituras autenticadas con la cookie (CSRF). */
export const CSRF_HEADER_NAME = 'x-requested-with'
export const CSRF_HEADER_VALUE = 'solidus'

const MAX_FROM_LENGTH = 200
// Caracteres de control, incluido el salto de línea (se valida el valor ya decodificado).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/
const DANGEROUS_SCHEME = /(javascript|data|vbscript):/i
const BLOCKED_PREFIXES = ['/login', '/api', '/sin-acceso']

/** Decodifica el payload de un JWT SIN verificar la firma. Solo sirve para decidir la interfaz, nunca para autorizar. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    let base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    while (base64.length % 4 !== 0) base64 += '='
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Valida una ruta de retorno (`from`) contra open redirect. Recibe el valor YA decodificado.
 * Devuelve el path (sin hash) o `null` si no es seguro.
 */
export function sanitizeFrom(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > MAX_FROM_LENGTH) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  if (raw.includes('\\')) return null
  if (raw.includes('://')) return null
  if (CONTROL_CHARS.test(raw)) return null
  if (DANGEROUS_SCHEME.test(raw)) return null
  const hashAt = raw.indexOf('#')
  const path = hashAt >= 0 ? raw.slice(0, hashAt) : raw
  if (path.length === 0) return null
  if (BLOCKED_PREFIXES.some((prefix) => path.startsWith(prefix))) return null
  return path
}

/** Arma `/login` con `reason` (solo el valor conocido) y `from` (saneado; se omite si es `/`). */
export function buildLoginPath(options: { reason?: string; from?: string | null } = {}): string {
  const params = new URLSearchParams()
  if (options.reason === SESSION_EXPIRED_REASON) params.set('reason', SESSION_EXPIRED_REASON)
  const from = sanitizeFrom(options.from)
  if (from && from !== '/') params.set('from', from)
  const query = params.toString()
  return query ? `/login?${query}` : '/login'
}

/** Identidad para presentar la UI (nunca autoriza: el backend es la autoridad). Sale de los claims del JWT en el servidor. */
export type SessionIdentity = {
  userId: string | null
  name: string | null
  email: string | null
  organizationId: string | null
  orgRole: string | null
  professionalId: string | null
  roles: { code: string; name: string }[]
}

export const EMPTY_SESSION_IDENTITY: SessionIdentity = {
  userId: null,
  name: null,
  email: null,
  organizationId: null,
  orgRole: null,
  professionalId: null,
  roles: [],
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

/** Valida los tipos de los claims decodificados; lo que no corresponde queda en null o []. */
export function identityFromPayload(payload: Record<string, unknown> | null): SessionIdentity {
  if (!payload) return { ...EMPTY_SESSION_IDENTITY, roles: [] }
  const roles: { code: string; name: string }[] = []
  if (Array.isArray(payload.roles)) {
    for (const role of payload.roles) {
      if (role !== null && typeof role === 'object') {
        const { code, name } = role as Record<string, unknown>
        if (typeof code === 'string') roles.push({ code, name: typeof name === 'string' ? name : code })
      }
    }
  }
  return {
    userId: stringOrNull(payload.sub),
    name: stringOrNull(payload.name),
    email: stringOrNull(payload.email),
    organizationId: stringOrNull(payload.organizationId),
    orgRole: stringOrNull(payload.orgRole),
    professionalId: stringOrNull(payload.professionalId),
    roles,
  }
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1']

/**
 * URL base de la API que usa el navegador. La cookie de sesión es host-only: si la página se abre en
 * `127.0.0.1` y la API está configurada en `localhost` (o al revés), el navegador la descartaría y el
 * login entraría en bucle. Solo entre alias de loopback se alinea el host de la API con el de la página;
 * en cualquier otro caso (IP de LAN, URL inválida) queda igual.
 */
export function resolveBrowserApiBase(configured: string, pageHostname: string): string {
  if (!LOOPBACK_HOSTS.includes(pageHostname)) return configured
  try {
    const url = new URL(configured)
    if (!LOOPBACK_HOSTS.includes(url.hostname) || url.hostname === pageHostname) return configured
    url.hostname = pageHostname
    // URL#toString agrega una barra final si el path es vacío: se conserva el formato configurado.
    const result = url.toString()
    return configured.endsWith('/') || url.pathname !== '/' ? result : result.replace(/\/$/, '')
  } catch {
    return configured
  }
}

/** Atributos de borrado de la cookie de sesión (mismos que al emitirla, con Max-Age=0). Lo usa el middleware. */
export function sessionCookieDeletion(secure: boolean) {
  return { httpOnly: true, sameSite: 'lax' as const, path: '/', secure, maxAge: 0 }
}

/** Borrado de la cookie vieja `auth_token` (la escribía el navegador sin HttpOnly). */
export function legacyCookieDeletion(secure: boolean) {
  return { path: '/', sameSite: 'lax' as const, secure, maxAge: 0 }
}

/** Tope razonable para `Retry-After` en el login (24 h); valores fuera de rango se descartan. */
const MAX_RETRY_AFTER_SECONDS = 86400

/** `Retry-After` en segundos enteros (formato de la API); null si falta, no es un entero o está fuera de rango. */
export function parseRetryAfterSeconds(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || !/^\d{1,6}$/.test(raw.trim())) return null
  const seconds = Number(raw.trim())
  return seconds >= 1 && seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : null
}

/** Minutos aproximados (hacia arriba, mínimo 1) para mostrar al usuario. */
export function retryAfterMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60))
}

/** Resultado de un login que NO fue exitoso (según el status HTTP). */
export type LoginFailure =
  | { status: 'invalid' | 'bad-request' | 'server' | 'other' }
  | { status: 'rate-limited'; retryAfter: number | null }

/**
 * Mapea el status HTTP de POST /v1/auth/login a un fallo, o `null` si es un 2xx (hay que leer el cuerpo).
 * 429 lleva `retryAfter` en segundos si `Retry-After` es válido. Función pura: se prueba con `node --test`.
 */
export function mapLoginFailure(status: number, retryAfterHeader: string | null | undefined): LoginFailure | null {
  if (status === 401) return { status: 'invalid' }
  if (status === 400) return { status: 'bad-request' }
  if (status === 429) return { status: 'rate-limited', retryAfter: parseRetryAfterSeconds(retryAfterHeader) }
  if (status >= 500) return { status: 'server' }
  if (status < 200 || status >= 300) return { status: 'other' }
  return null
}
