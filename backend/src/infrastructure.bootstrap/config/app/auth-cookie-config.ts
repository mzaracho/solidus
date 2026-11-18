import { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';
import { isString } from '../core/type-guards';
import { parseCorsOrigins } from './cors-config';
import { JWT_EXPIRES_IN_SECONDS } from './jwt-config';
import { isProduction } from './runtime-env';

/**
 * Cookie de sesión HttpOnly (018). El nombre debe coincidir con `AUTH_COOKIE_NAME` de
 * `frontend/src/lib/session.ts` (lo vigila `auth-cookie-sync.spec.ts`).
 */
export const AUTH_COOKIE_NAME = 'solidus_session';
/** Header propio que exigen las escrituras autenticadas con la cookie (CSRF). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'solidus';

const MAX_COOKIE_VALUE_LENGTH = 4096;
const JWT_VALUE_REGEX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * AUTH_COOKIE_SECURE: `true` o `false` (sin distinguir mayúsculas). Ausente o vacío = null (se usa el
 * default según el entorno). Cualquier otro valor lanza, sin imprimirlo.
 */
export function parseAuthCookieSecure(raw: unknown): boolean | null {
  if (raw === undefined || raw === null) return null;
  if (!isString(raw)) {
    throw new Error('AUTH_COOKIE_SECURE must be true or false.');
  }
  const value = raw.trim().toLowerCase();
  if (value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('AUTH_COOKIE_SECURE must be true or false.');
}

/** Valor explícito o, si no hay, `Secure` en producción (falla cerrado: NODE_ENV ausente = producción). */
export function getAuthCookieSecure(config: ConfigService): boolean {
  const explicit = parseAuthCookieSecure(config.get('AUTH_COOKIE_SECURE'));
  return explicit ?? isProduction(config);
}

/** Cookie host-only (sin `domain`), HttpOnly, SameSite=Lax y Path=/. `maxAge` en ms para Express. */
export function buildSessionCookieOptions(params: {
  secure: boolean;
  maxAgeSeconds: number;
}): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: params.secure,
    maxAge: params.maxAgeSeconds * 1000,
  };
}

/** `Secure` efectivo: la variable o que el origen (ya validado contra la lista blanca) sea https. */
export function resolveCookieSecure(
  config: ConfigService,
  validatedOrigin: string | null,
): boolean {
  return (
    getAuthCookieSecure(config) ||
    (validatedOrigin !== null && validatedOrigin.startsWith('https://'))
  );
}

export const SESSION_COOKIE_MAX_AGE_SECONDS = JWT_EXPIRES_IN_SECONDS;

/**
 * Lee la cookie de sesión del header `Cookie`. Falla cerrado: si el nombre aparece más de una vez
 * (cookie tossing desde otro puerto o path) o el valor no tiene forma de JWT, devuelve null.
 */
export function readSessionCookie(cookieHeader: unknown): string | null {
  if (!isString(cookieHeader)) return null;
  let found: string | null = null;
  let count = 0;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== AUTH_COOKIE_NAME) continue;
    count += 1;
    found = part.slice(index + 1).trim();
  }
  if (count !== 1 || found === null) return null;
  if (found.length > MAX_COOKIE_VALUE_LENGTH || !JWT_VALUE_REGEX.test(found)) {
    return null;
  }
  return found;
}

export function isAllowedOrigin(origin: unknown, allowlist: string[]): boolean {
  return isString(origin) && allowlist.includes(origin);
}

/** Misma lista y mismo parseo que CORS: una sola fuente (CORS_ORIGIN). */
export function getAllowedOrigins(config: ConfigService): string[] {
  return parseCorsOrigins(config.get('CORS_ORIGIN'));
}
