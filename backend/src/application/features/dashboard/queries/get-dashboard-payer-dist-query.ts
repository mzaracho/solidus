import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { DashboardService } from '@src/infrastructure/features/dashboard/dashboard.service';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class GetDashboardPayerDistributionQuery implements IRequest<any> {
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
    @IsOptional()
    mode?: 'ORGANIZATION' | 'PROFESSIONAL';

    @ApiProperty()
    @IsOptional()
    userId?: string;
}

@RequestHandler(GetDashboardPayerDistributionQuery)
@Injectable()
export class GetDashboardPayerDistributionQueryHandler implements IRequestHandler<
    GetDashboardPayerDistributionQuery,
    any
> {
    constructor(private readonly dashboardService: DashboardService) { }

    async execute(query: GetDashboardPayerDistributionQuery): Promise<any> {
        return this.dashboardService.getPayerDistribution(
            query.orgId,
            query.startDate,
            query.endDate,
            query.mode,
            query.userId
        );
    }
}
