import { Catch, HttpException } from '@nestjs/common';
import { FilterBase } from './filter-base';
import { Logger } from '../config/core/logger';
import { ErrorResponse } from '@src/domain/seed-work/error-response';
import { HttpStatus } from '@nestjs/common';

@Catch(HttpException)
export class HttpFilter extends FilterBase<HttpException> {
  constructor(logger: Logger) {
    super(logger);
  }

  buildResponse(exception: HttpException): ErrorResponse {
    return {
      code: this.resolveCode(exception),
      details: JSON.stringify(exception),
      errors: [{ message: exception.message }],
    };
  }

  /** Usa el `code` de la excepción si es un identificador simple (p. ej. 'unauthorized'). */
  private resolveCode(exception: HttpException): string {
    const body = exception.getResponse();
    if (typeof body === 'object' && body !== null) {
      const code = (body as { code?: unknown }).code;
      if (typeof code === 'string' && /^[a-z][a-z-]{0,40}$/.test(code)) {
        return code;
      }
    }
    return 'unhandled-exception';
  }

  getStatusCode(exception: HttpException): HttpStatus {
    return exception.getStatus();
  }
}
