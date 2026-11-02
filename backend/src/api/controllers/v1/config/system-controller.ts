import { Controller, Get, Query, Inject } from '@nestjs/common';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { SearchProfessionalsQuery } from '@src/application/features/config/queries/search-professionals-query';
import { BaseController } from '../../base/base-controller';

@Controller('system')
export class SystemController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get('professionals')
  async searchProfessionals(@Query() query: SearchProfessionalsQuery) {
    return this.dispatcher.dispatch(query);
  }
}
