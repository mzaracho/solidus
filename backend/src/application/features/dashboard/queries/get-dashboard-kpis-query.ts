import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { DashboardKpisResponseDto } from '../Dtos/dashboard-kpis-response.dto';
import { DashboardKpiQueryDto } from '../Dtos/dashboard-kpi-query.dto';
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
  DASHBOARD_BASIS,
  DASHBOARD_VALUE_TYPE,
} from '@src/domain/constants/app.constants';

export class GetDashboardKpisQuery implements IRequest<DashboardKpisResponseDto> {
  /** La asigna el controlador desde @CurrentOrgId(); la query del cliente no la pisa. */
  declare organizationId: string;

  @ApiProperty()
  @IsDateString({ strict: true })
  startDate: string;

  @ApiProperty()
  @IsDateString({ strict: true })
  endDate: string;

  @ApiProperty({ enum: Object.values(DASHBOARD_BASIS), required: false })
  @IsOptional()
  @IsEnum(DASHBOARD_BASIS)
  basis?: 'ACCRUED' | 'CASH';

  @ApiProperty({ enum: Object.values(DASHBOARD_VALUE_TYPE), required: false })
  @IsOptional()
  @IsEnum(DASHBOARD_VALUE_TYPE)
  valueType?: 'NET' | 'GROSS';
}

@RequestHandler(GetDashboardKpisQuery)
@Injectable()
export class GetDashboardKpisQueryHandler implements IRequestHandler<
  GetDashboardKpisQuery,
  DashboardKpisResponseDto
> {
  constructor(private readonly dashboardService: DashboardService) { }

  async execute(
    query: GetDashboardKpisQuery,
    ctx: RequestContext,
  ): Promise<DashboardKpisResponseDto> {
    return this.dashboardService.getKpis(query, requireViewScope(ctx));
  }
}
