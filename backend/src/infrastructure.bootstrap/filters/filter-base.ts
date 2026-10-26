import {
  ArgumentsHost,
  ExceptionFilter,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ErrorResponse } from '@src/domain/seed-work/error-response';
import { ILogger } from '../config/core/i-logger';
import { getHttpContext } from '../config/core/nest-helpers';

export abstract class FilterBase<T> implements ExceptionFilter {
  constructor(@Inject(ILogger) private readonly logger: ILogger) {}

  catch(exception: T, host: ArgumentsHost) {
    const { request, response } = getHttpContext(host);

    this.logger.logError(
      this.buildLogMessage(exception),
      (exception as any).stack,
      request,
    );

    response
      .status(this.getStatusCode(exception))
      .json(this.buildResponse(exception));
  }

  abstract getStatusCode(exception: T): HttpStatus;
  abstract buildResponse(exception: T): ErrorResponse;

  protected buildLogMessage(exception: T): string {
    return exception instanceof Error
      ? exception.message
      : JSON.stringify(exception);
  }
}
