import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { Settlement } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Find All
export class FindAllSettlementsQuery implements IRequest<Settlement[]> {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  month?: string;

  @ApiProperty()
  @IsString()
  organizationId: string;
}

@RequestHandler(FindAllSettlementsQuery)
@Injectable()
export class FindAllSettlementsQueryHandler implements IRequestHandler<
  FindAllSettlementsQuery,
  Settlement[]
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: FindAllSettlementsQuery): Promise<Settlement[]> {
    if (query.month) {
      return this.prisma.settlement.findMany({
        where: { organizationId: query.organizationId, period: query.month },
      });
    }
    return this.prisma.settlement.findMany({
      where: { organizationId: query.organizationId },
      take: 20,
    });
  }
}

// Find Details
export class FindSettlementDetailsQuery implements IRequest<any[]> {
  constructor(public readonly id: string) {}
}

@RequestHandler(FindSettlementDetailsQuery)
@Injectable()
export class FindSettlementDetailsQueryHandler implements IRequestHandler<
  FindSettlementDetailsQuery,
  any[]
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: FindSettlementDetailsQuery): Promise<any[]> {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: query.id },
      include: { workItems: true },
    });
    return settlement?.workItems || [];
  }
}
