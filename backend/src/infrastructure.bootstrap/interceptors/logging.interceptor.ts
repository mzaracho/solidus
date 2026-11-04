import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { safeStringify } from '../config/core/redact';

export interface LoggingInterceptorOptions {
  /** Solo fuera de producción (ver getRuntimeEnv). */
  debugEnabled: boolean;
}

/**
 * Solo debug: params, query y body redactados (fuera de producción). La línea de acceso la escribe el
 * middleware de `access-log.ts`. Nunca loguea headers ni cuerpos de respuesta.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(private readonly options: LoggingInterceptorOptions) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();

    if (this.options.debugEnabled) {
      this.logger.debug(`Params: ${safeStringify(req.params)}`);
      this.logger.debug(`Query: ${safeStringify(req.query)}`);
      this.logger.debug(`Body: ${safeStringify(req.body)}`);
    }

    return next.handle();
  }
}
