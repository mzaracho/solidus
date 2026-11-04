import { ArgumentsHost, ExceptionFilter, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { ILogger } from '../config/core/i-logger';
import { getHttpContext } from '../config/core/nest-helpers';
import {
  neutralizeUnsafeChars,
  sanitizeAccessPath,
} from '../config/app/access-log';
import {
  describeForLog,
  formatErrorLogLine,
  isPrismaError,
  mapException,
} from './error-contract';

export const ERROR_ID_HEADER = 'X-Error-Id';

/** Destino mínimo del log de errores (lo implementan `ILogger` y el `Logger` de Nest). */
export interface ErrorLogSink {
  error(message: string): void;
  debug(message: string): void;
}

/**
 * Mapea la excepción al contrato, la registra de forma segura y responde.
 * 5xx: log de error con identificador de correlación (también en el header `X-Error-Id`), solo clase y código
 * para Prisma. 4xx: solo debug, sin mensaje. Nunca lanza.
 */
export function respondWithError(
  exception: unknown,
  req: Request,
  res: Response,
  sink: ErrorLogSink,
): void {
  const mapped = mapException(exception);
  try {
    const method = neutralizeUnsafeChars(String(req?.method)).slice(0, 16);
    const path = sanitizeAccessPath(req?.originalUrl ?? req?.url);
    if (mapped.internal) {
      const id = randomUUID();
      sink.error(
        formatErrorLogLine(
          id,
          method,
          path,
          mapped.status,
          describeForLog(exception),
        ),
      );
      if (
        exception instanceof Error &&
        !isPrismaError(exception) &&
        exception.stack
      ) {
        sink.debug(`error id=${id} stack: ${exception.stack}`);
      }
      if (!res.headersSent) res.setHeader(ERROR_ID_HEADER, id);
    } else {
      sink.debug(`${method} ${path} ${mapped.status} ${mapped.body.code}`);
    }
  } catch {
    // El log nunca debe impedir la respuesta.
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(mapped.status).json(mapped.body);
}

export abstract class FilterBase<T> implements ExceptionFilter {
  constructor(@Inject(ILogger) private readonly logger: ILogger) {}

  catch(exception: T, host: ArgumentsHost) {
    const { request, response } = getHttpContext(host);
    respondWithError(exception, request, response, {
      error: (message) => this.logger.logError(message, undefined, request),
      debug: (message) => this.logger.logDebug(message, request),
    });
  }
}
