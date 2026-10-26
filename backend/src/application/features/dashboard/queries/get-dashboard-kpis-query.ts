import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { DashboardKpisResponseDto } from '../Dtos/dashboard-kpis-response.dto';
import { DashboardKpiQueryDto } from '../Dtos/dashboard-kpi-query.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { DashboardService } from '@src/infrastructure/features/dashboard/dashboard.service';

import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, IsOptional } from 'class-validator';

export class GetDashboardKpisQuery implements IRequest<DashboardKpisResponseDto> {
  @ApiProperty()
  @IsString()
  @IsOptional()
  organizationId: string;

  @ApiProperty()
  @IsString()
  startDate: string;

  @ApiProperty()
  @IsString()
  endDate: string;

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

  @ApiProperty()
  @IsOptional()
  @IsString()
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
  ): Promise<DashboardKpisResponseDto> {
    return this.dashboardService.getKpis(query);
  }
}
