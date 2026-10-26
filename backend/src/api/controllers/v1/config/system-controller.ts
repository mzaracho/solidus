import { Controller, Get, Query, Inject, UseGuards } from '@nestjs/common';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { SearchProfessionalsQuery } from '@src/application/features/config/queries/search-professionals-query';
import { BaseController } from '../../base/base-controller';
import { AuthGuard } from '@src/infrastructure.bootstrap/config/providers/auth-guard-provider';

@UseGuards(AuthGuard)
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
