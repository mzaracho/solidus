import { Catch, HttpException } from '@nestjs/common';
import { FilterBase } from './filter-base';
import { Logger } from '../config/core/logger';

@Catch(HttpException)
export class HttpFilter extends FilterBase<HttpException> {
  constructor(logger: Logger) {
    super(logger);
  }
}
