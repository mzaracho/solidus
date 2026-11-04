import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import {
  ErrorResponse,
  MessageError,
} from '@src/domain/seed-work/error-response';
import { isString } from '../core/type-guards';

export const DEFAULT_BODY_SIZE_LIMIT = '1mb';
export const MAX_BODY_SIZE_BYTES = 10 * 1024 * 1024;

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
};

/**
 * Valida BODY_SIZE_LIMIT (`<número>[kb|mb|b]`, p. ej. `500kb`, `1mb`) y devuelve el texto normalizado.
 * Vacío o ausente: 1mb. Inválido, cero o mayor a 10mb: lanza (el backend no arranca).
 */
export function parseBodySizeLimit(raw: unknown): string {
  if (raw === undefined || raw === null) return DEFAULT_BODY_SIZE_LIMIT;
  const invalid = () =>
    new Error(
      'BODY_SIZE_LIMIT no es válido. Use un tamaño como 500kb o 1mb (máximo 10mb), o borre la variable para usar 1mb.',
    );
  if (!isString(raw)) throw invalid();
  if (raw.trim().length === 0) return DEFAULT_BODY_SIZE_LIMIT;
  const value = raw.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(b|kb|mb)?$/.exec(value);
  if (!match) throw invalid();
  const bytes = Number(match[1]) * UNITS[match[2] ?? 'b'];
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_BODY_SIZE_BYTES) {
    throw invalid();
  }
  return value;
}

export function getBodySizeLimit(config: ConfigService): string {
  return parseBodySizeLimit(config.get('BODY_SIZE_LIMIT'));
}

const GENERIC_BODY_ERRORS: Record<number, [string, string]> = {
  413: ['payload-too-large', 'El cuerpo de la solicitud es demasiado grande.'],
  400: ['bad-request', 'La solicitud no es válida.'],
  415: [
    'unsupported-media-type',
    'El tipo de contenido o la codificación de la solicitud no están soportados.',
  ],
};

/**
 * Los errores del body parser (413, 415, JSON inválido) ocurren antes de Nest y no pasan por sus filtros:
 * este manejador de Express los responde con el cuerpo de error genérico, sin stack ni detalles.
 * Otros errores se delegan al siguiente manejador.
 */
export function bodyParserErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const status = (err as { status?: unknown } | null)?.status;
  const type = (err as { type?: unknown } | null)?.type;
  const isParserError =
    typeof status === 'number' &&
    status in GENERIC_BODY_ERRORS &&
    isString(type) &&
    /^entity\.|^encoding\.|^request\.|^charset\./.test(type);
  if (!isParserError || res.headersSent) {
    next(err);
    return;
  }
  const [code, message] = GENERIC_BODY_ERRORS[status];
  const body: ErrorResponse = new ErrorResponse(code, [
    new MessageError(message),
  ]);
  res.status(status).json(body);
}

export const configureBodyParser = (
  app: NestExpressApplication,
  config: ConfigService,
) => {
  const limit = getBodySizeLimit(config);
  app.useBodyParser('json', { limit });
  app.useBodyParser('urlencoded', { limit, extended: true });
  app.use(bodyParserErrorHandler);
};
