import { Controller, Get, Query, Inject } from '@nestjs/common';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { CalculateSettlementsQuery } from '@src/application/features/settlements/queries/calculate-settlements-query';
import { BaseController } from '../../base/base-controller';

@Controller('settlements')
export class SettlementsController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get('calculate')
  async calculate(@Query() query: CalculateSettlementsQuery) {
    return this.dispatcher.dispatch(query);
  }
}
