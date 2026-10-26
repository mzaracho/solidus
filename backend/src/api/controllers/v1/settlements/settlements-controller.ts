import { Controller, Get, Param, Query, Inject } from '@nestjs/common';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import {
  FindAllSettlementsQuery,
  FindSettlementDetailsQuery,
} from '@src/application/features/settlements/queries/settlement-queries';
import { CalculateSettlementsQuery } from '@src/application/features/settlements/queries/calculate-settlements-query';
import { BaseController } from '../../base/base-controller';

@Controller('settlements')
export class SettlementsController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get()
  async findAll(@Query() query: FindAllSettlementsQuery) {
    return this.dispatcher.dispatch(query);
  }

  @Get('calculate')
  async calculate(@Query() query: CalculateSettlementsQuery) {
    return this.dispatcher.dispatch(query);
  }

  @Get(':id/details')
  async findDetails(@Param('id') id: string) {
    return this.dispatcher.dispatch(new FindSettlementDetailsQuery(id));
  }
}
