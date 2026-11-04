import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

export interface AccessLogSink {
  log(message: string): void;
  warn(message: string): void;
}

const MAX_PATH_LENGTH = 200;

/** Ruta sin query ni fragmento y acotada; nunca incluye headers, body ni parámetros de query. */
export function sanitizeAccessPath(url: unknown): string {
  const raw = typeof url === 'string' ? url : '';
  return neutralizeUnsafeChars(
    raw.split('?')[0].split('#')[0].slice(0, MAX_PATH_LENGTH),
  );
}

/**
 * Reemplaza por `?` todo carácter fuera de ASCII imprimible `[!-~]` (controles, espacios,
 * saltos de línea, 0x7F, 0x85, Unicode como U+2028) para que un request no pueda inyectar líneas
 * falsas en el log. Se elige `?` (no percent-encoding) para no alargar la línea.
 */
export function neutralizeUnsafeChars(value: string): string {
  return value.replace(/[^!-~]/g, '?');
}

/** `log` para 2xx y 3xx; `warn` para 4xx y 5xx. */
export function formatAccessLine(
  method: string,
  path: string,
  status: number,
  ms: number,
): string {
  return `${method} ${path} ${status} ${ms}ms`;
}

/**
 * Middleware de acceso: una línea por request al terminar la respuesta (`finish`), también para
 * los rechazos de guards, del body parser, las rutas inexistentes y los errores 5xx.
 * Solo escribe método, ruta sin query, status y duración. Debe registrarse antes del body parser.
 */
export function createAccessLogMiddleware(
  sink: AccessLogSink = new Logger('Access'),
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();
    const method = neutralizeUnsafeChars(String(req.method)).slice(0, 16);
    const path = sanitizeAccessPath(req.originalUrl ?? req.url);
    res.on('finish', () => {
      const ms = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      const line = formatAccessLine(method, path, res.statusCode, ms);
      if (res.statusCode >= 400) sink.warn(line);
      else sink.log(line);
    });
    next();
  };
}
