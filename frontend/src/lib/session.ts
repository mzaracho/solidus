// Helpers de sesión SIN imports: se usan en servidor, cliente y middleware (Edge), y se prueban con
// `node --test` sin dependencias (ver session.test.mts). Solo sintaxis que Node puede "strip" (sin enums).

export const AUTH_COOKIE_NAME = 'auth_token'
export const SESSION_EXPIRED_REASON = 'session_expired'
/** Duración máxima de la sesión (igual al `expiresIn` del backend): 8 h. */
export const MAX_SESSION_SECONDS = 28800

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
 * Segundos de vida de la cookie: lo que falta para `exp`, con tope de 8 h.
 * `null` si el token no se puede decodificar, no trae `exp` o ya venció.
 */
export function getCookieMaxAgeSeconds(token: string, nowMs: number): number | null {
  const payload = decodeJwtPayload(token)
  const exp = payload?.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null
  const remaining = Math.floor(exp - nowMs / 1000)
  if (remaining <= 0) return null
  return Math.min(remaining, MAX_SESSION_SECONDS)
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

/** Borra la cookie de sesión. Solo en el navegador. */
export function clearSessionCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${AUTH_COOKIE_NAME}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax`
}

/** Lee el token de la cookie en el navegador. */
export function readSessionToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; ?)${AUTH_COOKIE_NAME}=([^;]+)`))
  return match ? match[1] : null
}
