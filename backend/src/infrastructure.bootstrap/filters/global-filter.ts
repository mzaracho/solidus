import { Catch } from '@nestjs/common';
import { FilterBase } from './filter-base';
import { Logger } from '../config/core/logger';

@Catch()
export class GlobalFilter extends FilterBase<unknown> {
  constructor(logger: Logger) {
    super(logger);
  }
}
