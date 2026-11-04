import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { DashboardService } from '@src/infrastructure/features/dashboard/dashboard.service';
import {
  RequestContext,
  requireViewScope,
} from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';

import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import {
  CHART_GROUP_BY,
  DASHBOARD_BASIS,
} from '@src/domain/constants/app.constants';

export class GetDashboardChartQuery implements IRequest<any> {
  /** La asigna el controlador desde @CurrentOrgId(); la query del cliente no la pisa. */
  declare orgId: string;

  @ApiProperty()
  @IsDateString({ strict: true })
  startDate: string;

  @ApiProperty()
  @IsDateString({ strict: true })
  endDate: string;

  @ApiProperty({ enum: Object.values(CHART_GROUP_BY) })
  @IsEnum(CHART_GROUP_BY)
  groupBy: 'day' | 'month';

  @ApiProperty({ enum: Object.values(DASHBOARD_BASIS), required: false })
  @IsOptional()
  @IsEnum(DASHBOARD_BASIS)
  basis?: 'ACCRUED' | 'CASH';
}

@RequestHandler(GetDashboardChartQuery)
@Injectable()
export class GetDashboardChartQueryHandler implements IRequestHandler<
  GetDashboardChartQuery,
  any
> {
  constructor(private readonly dashboardService: DashboardService) { }

  async execute(
    query: GetDashboardChartQuery,
    ctx: RequestContext,
  ): Promise<any> {
    return this.dashboardService.getChart(
      query.orgId,
      query.startDate,
      query.endDate,
      query.groupBy,
      requireViewScope(ctx),
      query.basis
    );
  }
}
