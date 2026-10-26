import { Controller, Get, Query, Inject, UseGuards, Headers } from '@nestjs/common';
import { DashboardKpiQueryDto } from '@src/application/features/dashboard/Dtos/dashboard-kpi-query.dto';
import { DashboardKpisResponseDto } from '@src/application/features/dashboard/Dtos/dashboard-kpis-response.dto';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { GetDashboardKpisQuery } from '@src/application/features/dashboard/queries/get-dashboard-kpis-query';
import { GetDashboardChartQuery } from '@src/application/features/dashboard/queries/get-dashboard-chart-query';
import { BaseController } from '../../base/base-controller';
import { AuthGuard } from '@src/infrastructure.bootstrap/config/providers/auth-guard-provider';
import { GetDashboardPayerDistributionQuery } from '@src/application/features/dashboard/queries/get-dashboard-payer-dist-query';

@UseGuards(AuthGuard)
@Controller('dashboard')
export class DashboardController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get('kpis')
  async getKpis(
    @Headers('x-org-id') orgId: string,
    @Headers('x-user-id') userId: string,
    @Query() query: GetDashboardKpisQuery,
  ): Promise<DashboardKpisResponseDto> {
    query.organizationId = orgId;
    query.userId = userId; // Inject user ID for filtering if mode is Professional
    return this.dispatcher.dispatch(query);
  }

  @Get('chart')
  async getChart(
    @Headers('x-org-id') orgId: string,
    @Headers('x-user-id') userId: string,
    @Query() query: GetDashboardChartQuery,
  ) {
    query.orgId = orgId;
    query.userId = userId;
    return this.dispatcher.dispatch(query);
  }

  @Get('payers')
  async getPayers(
    @Headers('x-org-id') orgId: string,
    @Headers('x-user-id') userId: string,
    @Query() query: any // Use any or create DTO if strict, but reusing similar params
  ) {
    const q = new GetDashboardPayerDistributionQuery();
    Object.assign(q, query);
    q.orgId = orgId;
    q.userId = userId;
    return this.dispatcher.dispatch(q);
  }
}
