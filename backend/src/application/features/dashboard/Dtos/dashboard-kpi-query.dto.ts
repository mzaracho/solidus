import { IsString, IsOptional } from 'class-validator';

export class DashboardKpiQueryDto {
  organizationId: string;
  startDate?: string;
  endDate?: string;
  @IsOptional()
  @IsString()
  basis?: 'ACCRUED' | 'CASH';

  @IsOptional()
  @IsString()
  valueType?: 'NET' | 'GROSS';
}
