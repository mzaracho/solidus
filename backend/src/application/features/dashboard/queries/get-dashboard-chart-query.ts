import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { DashboardService } from '@src/infrastructure/features/dashboard/dashboard.service';

import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class GetDashboardChartQuery implements IRequest<any> {
  @ApiProperty()
  @IsString()
  @IsOptional()
  orgId: string;

  @ApiProperty()
  @IsString()
  startDate: string;

  @ApiProperty()
  @IsString()
  endDate: string;

  @ApiProperty()
  @IsString()
  groupBy: 'day' | 'month';

  @ApiProperty()
  @IsOptional()
  mode?: 'ORGANIZATION' | 'PROFESSIONAL';

  @ApiProperty()
  @IsOptional()
  @ApiProperty()
  @IsOptional()
  userId?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  basis?: 'ACCRUED' | 'CASH';
}

@RequestHandler(GetDashboardChartQuery)
@Injectable()
export class GetDashboardChartQueryHandler implements IRequestHandler<
  GetDashboardChartQuery,
  any
> {
  constructor(private readonly dashboardService: DashboardService) { }

  async execute(query: GetDashboardChartQuery): Promise<any> {
    return this.dashboardService.getChart(
      query.orgId,
      query.startDate,
      query.endDate,
      query.groupBy,
      query.mode,
      query.userId,
      query.basis
    );
  }
}
