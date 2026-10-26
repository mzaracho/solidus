import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class GetOrganizationQuery implements IRequest<any> {
    @ApiProperty()
    @IsString()
    @ApiProperty()
    @IsString()
    orgId!: string;

    constructor(init?: Partial<GetOrganizationQuery>) {
        if (init) {
            this.orgId = init.orgId!;
        }
    }
}

@RequestHandler(GetOrganizationQuery)
@Injectable()
export class GetOrganizationQueryHandler implements IRequestHandler<GetOrganizationQuery, any> {
    constructor(private readonly prisma: PrismaService) { }

    async execute(query: GetOrganizationQuery): Promise<any> {
        if (!query.orgId) return null;

        const org = await this.prisma.organization.findUnique({
            where: { id: query.orgId }
        });

        if (!org) return null;

        return {
            id: org.id,
            name: org.name,
            cuit: org.cuit || '',
            address: org.address || '',
            // Parse settings string assuming it's JSON
            settings: org.settings ? (typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings) : { alertsDays: 60, emailNotifs: true }
        };
    }
}
