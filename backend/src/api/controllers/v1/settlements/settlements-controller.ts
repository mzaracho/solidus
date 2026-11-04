import { Controller, Get, Query, Inject, UseGuards } from '@nestjs/common';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { CalculateSettlementsQuery } from '@src/application/features/settlements/queries/calculate-settlements-query';
import { BaseController } from '../../base/base-controller';
import { CurrentOrgId } from '@src/infrastructure.bootstrap/config/core/authentication/current-org-decorator';
import {
  OrgRoleGuard,
  RequireOrgRole,
} from '@src/infrastructure.bootstrap/guards/org-role-guard';

@Controller('settlements')
export class SettlementsController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  // Pagos de la organizacion a todos sus profesionales: financiero, solo ADMIN (rol de la base).
  // La organizacion sale de @CurrentOrgId() (validada por OrgAccessGuard), no de la query.
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  @Get('calculate')
  async calculate(
    @Query() query: CalculateSettlementsQuery,
    @CurrentOrgId() orgId: string,
  ) {
    query.organizationId = orgId;
    return this.dispatcher.dispatch(query);
  }
}
