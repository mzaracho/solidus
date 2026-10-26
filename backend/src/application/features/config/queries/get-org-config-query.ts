import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';

import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class GetOrgConfigQuery implements IRequest<any> {
  @ApiProperty()
  @IsString()
  @IsOptional()
  orgId: string;
}

@RequestHandler(GetOrgConfigQuery)
@Injectable()
export class GetOrgConfigQueryHandler implements IRequestHandler<
  GetOrgConfigQuery,
  any
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(query: GetOrgConfigQuery): Promise<any> {
    if (!query.orgId) return {};
    const [categories, presets, professionals] = await Promise.all([
      this.prisma.professionalCategory.findMany({
        where: { organizationId: query.orgId },
      }),
      this.prisma.feePreset.findMany({
        where: { organizationId: query.orgId },
      }),
      this.prisma.professional.findMany({
        where: {
          organizationId: query.orgId,
          deletedAt: null
        },
        include: {
          category: true,
          user: { select: { email: true } },
        },
      }),
    ]);
    return {
      categories,
      staff: professionals,
      presets: presets.map(p => ({
        id: p.id,
        organizationId: p.organizationId,
        name: p.name,
        value: p.value,
        cardValue: p.cardValue,
        serviceType: p.serviceType,
        linkedType: p.linkedType
      }))
    };
  }
}
