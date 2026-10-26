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
      code: 'unhandled-exception',
      details: JSON.stringify(exception),
      errors: [{ message: exception.message }],
    };
  }

  getStatusCode(exception: HttpException): HttpStatus {
    return exception.getStatus();
  }
}
