import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { respondWithError } from './filter-base';

const logger = new Logger('HttpError');

/**
 * Último manejador de errores de Express (defensa en profundidad, registrado después de `app.init()`):
 * cualquier error que no tomen los filtros de Nest responde con el contrato genérico, sin HTML ni stack.
 */
// Express reconoce un manejador de errores por sus 4 parámetros: `_next` debe declararse aunque no se use.
export function finalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  respondWithError(err, req, res, {
    error: (message) => logger.error(message),
    debug: (message) => logger.debug(message),
  });
}
