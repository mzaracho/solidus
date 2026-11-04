import { INestApplication, Logger } from '@nestjs/common';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import { isString } from '../core/type-guards';
import { isProduction } from './runtime-env';

// Origen = esquema + host (o IPv6 entre corchetes) + puerto opcional. Sin path, sin barra final, sin '*'.
const ORIGIN_REGEX =
  /^https?:\/\/(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?$/;

export const CORS_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];
export const CORS_ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'x-org-id',
  'x-mode',
];
/** Headers de respuesta legibles desde el navegador (el 429 del login informa Retry-After; feature 012). */
export const CORS_EXPOSED_HEADERS = ['Retry-After'];
export const CORS_MAX_AGE_SECONDS = 600;

/**
 * Convierte CORS_ORIGIN (orígenes separados por comas) en una lista.
 * Ignora entradas vacías (coma final). Una entrada inválida lanza: el backend no arranca.
 */
export function parseCorsOrigins(raw: unknown): string[] {
  if (!isString(raw)) return [];
  const origins: string[] = [];
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (entry.length === 0) continue;
    if (!ORIGIN_REGEX.test(entry)) {
      throw new Error(
        `CORS_ORIGIN contiene un origen inválido: "${entry}". Use orígenes completos separados por comas (por ejemplo http://localhost:3000), sin path, sin barra final y sin "*".`,
      );
    }
    if (!origins.includes(entry)) origins.push(entry);
  }
  return origins;
}

export function buildCorsOptions(config: ConfigService): CorsOptions {
  const origins = parseCorsOrigins(config.get('CORS_ORIGIN'));
  if (origins.length === 0) {
    if (isProduction(config)) {
      throw new Error(
        'CORS_ORIGIN es obligatorio en producción (lista de orígenes separada por comas).',
      );
    }
    new Logger('Cors').warn(
      'CORS_ORIGIN está vacío: se rechazan todos los orígenes del navegador.',
    );
  }
  return {
    origin: origins,
    methods: CORS_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: CORS_EXPOSED_HEADERS,
    credentials: false,
    maxAge: CORS_MAX_AGE_SECONDS,
  };
}

export const configureCors = (app: INestApplication, config: ConfigService) => {
  app.enableCors(buildCorsOptions(config));
};
