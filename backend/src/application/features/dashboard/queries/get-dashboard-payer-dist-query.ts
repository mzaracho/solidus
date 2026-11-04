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
import { IsDateString } from 'class-validator';

export class GetDashboardPayerDistributionQuery implements IRequest<any> {
    /** La asigna el controlador desde @CurrentOrgId(); la query del cliente no la pisa. */
    declare orgId: string;

    @ApiProperty()
    @IsDateString({ strict: true })
    startDate: string;

    @ApiProperty()
    @IsDateString({ strict: true })
    endDate: string;
}

@RequestHandler(GetDashboardPayerDistributionQuery)
@Injectable()
export class GetDashboardPayerDistributionQueryHandler implements IRequestHandler<
    GetDashboardPayerDistributionQuery,
    any
> {
    constructor(private readonly dashboardService: DashboardService) { }

    async execute(
        query: GetDashboardPayerDistributionQuery,
        ctx: RequestContext,
    ): Promise<any> {
        return this.dashboardService.getPayerDistribution(
            query.orgId,
            query.startDate,
            query.endDate,
            requireViewScope(ctx),
        );
    }
}
