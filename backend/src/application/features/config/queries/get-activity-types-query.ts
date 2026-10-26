import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ActivityType } from '@prisma/client';

export class GetActivityTypesQuery implements IRequest<ActivityType[]> {
    constructor(public readonly orgId?: string) { }
}

@RequestHandler(GetActivityTypesQuery)
@Injectable()
export class GetActivityTypesQueryHandler implements IRequestHandler<GetActivityTypesQuery, ActivityType[]> {
    constructor(private readonly prisma: PrismaService) { }

    async execute(query: GetActivityTypesQuery): Promise<ActivityType[]> {
        if (!query.orgId) {
            return [];
        }

        return this.prisma.activityType.findMany({
            where: { organizationId: query.orgId },
            orderBy: { name: 'asc' }
        });
    }
}
