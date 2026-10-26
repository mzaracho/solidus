import { Controller, Get, Query, Inject } from '@nestjs/common';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { GetMyProductionQuery } from '@src/application/features/activity/queries/get-my-production-query';
import { BaseController } from '../../base/base-controller';

@Controller('my-production')
export class ProductionController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get()
  async getMyProduction(@Query() query: GetMyProductionQuery) {
    return this.dispatcher.dispatch(query);
  }
}
