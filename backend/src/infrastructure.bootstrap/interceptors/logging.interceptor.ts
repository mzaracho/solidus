import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { safeStringify } from '../config/core/redact';

export interface LoggingInterceptorOptions {
  /** Solo fuera de producción (ver getRuntimeEnv). */
  debugEnabled: boolean;
}

/**
 * Una línea por request (método, ruta sin query, status y duración).
 * En debug agrega params, query y body redactados. Nunca loguea headers ni cuerpos de respuesta.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(private readonly options: LoggingInterceptorOptions) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const method = req.method;
    const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];

    if (this.options.debugEnabled) {
      this.logger.debug(`Params: ${safeStringify(req.params)}`);
      this.logger.debug(`Query: ${safeStringify(req.query)}`);
      this.logger.debug(`Body: ${safeStringify(req.body)}`);
    }

    const now = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            `${method} ${path} ${res.statusCode} ${Date.now() - now}ms`,
          );
        },
      }),
    );
  }
}
