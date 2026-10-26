import { Catch, HttpStatus } from '@nestjs/common';
import { FilterBase } from './filter-base';
import {
  ErrorResponse,
  isErrorResponse,
  MessageError,
} from '@src/domain/seed-work/error-response';
import { AxiosError } from 'axios';
import { Logger } from '../config/core/logger';

type DataAxiosError = {
  error: string;
  detail: {
    content: string;
    exception: string;
  };
};

@Catch(AxiosError)
export class AxiosFilter extends FilterBase<AxiosError> {
  constructor(logger: Logger) {
    super(logger);
  }
  getStatusCode(exception: AxiosError): HttpStatus {
    return exception.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;
  }

  buildResponse(exception: AxiosError): ErrorResponse {
    if (exception.response && isErrorResponse(exception.response.data)) {
      return exception.response.data;
    }

    const errors: MessageError[] = [];
    const data = exception.response?.data as DataAxiosError;

    if (data.detail?.content) {
      errors.push({
        message: JSON.parse(data.detail.content).error_description,
      });
    }

    return {
      code: 'api-external-error',
      details: JSON.stringify(exception),
      errors,
    };
  }
}
