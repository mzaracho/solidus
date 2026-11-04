import { Controller, Get, Query, Inject } from '@nestjs/common';
import { DashboardKpisResponseDto } from '@src/application/features/dashboard/Dtos/dashboard-kpis-response.dto';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { GetDashboardKpisQuery } from '@src/application/features/dashboard/queries/get-dashboard-kpis-query';
import { GetDashboardChartQuery } from '@src/application/features/dashboard/queries/get-dashboard-chart-query';
import { BaseController } from '../../base/base-controller';
import { UsesViewMode } from '@src/infrastructure.bootstrap/config/core/authentication/view-mode-decorator';
import { GetDashboardPayerDistributionQuery } from '@src/application/features/dashboard/queries/get-dashboard-payer-dist-query';
import { CurrentOrgId } from '@src/infrastructure.bootstrap/config/core/authentication/current-org-decorator';

@Controller('dashboard')
export class DashboardController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  // Vista efectiva: ViewModeGuard (ctx.view). La vista org de estas rutas es financiera: solo ADMIN.
  @UsesViewMode({ orgRole: 'ADMIN' })
  @Get('kpis')
  async getKpis(
    @CurrentOrgId() orgId: string,
    @Query() query: GetDashboardKpisQuery,
  ): Promise<DashboardKpisResponseDto> {
    query.organizationId = orgId;
    return this.dispatcher.dispatch(query);
  }

  @UsesViewMode({ orgRole: 'ADMIN' })
  @Get('chart')
  async getChart(
    @CurrentOrgId() orgId: string,
    @Query() query: GetDashboardChartQuery,
  ) {
    query.orgId = orgId;
    return this.dispatcher.dispatch(query);
  }

  @UsesViewMode({ orgRole: 'ADMIN' })
  @Get('payers')
  async getPayers(
    @CurrentOrgId() orgId: string,
    @Query() query: GetDashboardPayerDistributionQuery,
  ) {
    query.orgId = orgId;
    return this.dispatcher.dispatch(query);
  }
}
