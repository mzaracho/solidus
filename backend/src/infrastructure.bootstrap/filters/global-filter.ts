import { Catch, HttpStatus } from '@nestjs/common';
import { FilterBase } from './filter-base';
import { Logger } from '../config/core/logger';
import { ErrorResponse } from '@src/domain/seed-work/error-response';

@Catch()
export class GlobalFilter extends FilterBase<unknown> {
  constructor(logger: Logger) {
    super(logger);
  }

  buildResponse(exception: unknown): ErrorResponse {
    return {
      code: 'unhandled-exception',
      details: JSON.stringify(exception),
      errors: [
        {
          message:
            'Ocurrio un error en la aplicacion. Por favor intenta mas tarde',
        },
      ],
    };
  }

  getStatusCode(exception: unknown): HttpStatus {
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
