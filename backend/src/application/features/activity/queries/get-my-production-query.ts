import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GetMyProductionQuery implements IRequest<any> {
  @ApiProperty()
  @IsString()
  userId: string;
}

@RequestHandler(GetMyProductionQuery)
@Injectable()
export class GetMyProductionQueryHandler implements IRequestHandler<
  GetMyProductionQuery,
  any
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(query: GetMyProductionQuery): Promise<any> {
    const { userId } = query;
    if (!userId) {
      return { error: 'userId required' };
    }

    // 1. Find all professional profiles for this user across organizations
    const professionals = await this.prisma.professional.findMany({
      where: { userId },
      include: { organization: true },
    });

    if (professionals.length === 0) {
      return [];
    }

    const professionalIds = professionals.map((p) => p.id);

    // 2. Find all splits allocated to these profiles
    const splits = await this.prisma.workItemSplit.findMany({
      where: {
        beneficiaryType: 'PROFESSIONAL',
        beneficiaryId: { in: professionalIds },
      },
      include: {
        workItem: {
          select: {
            occurredAt: true,
            serviceType: true,
            grossAmount: true,
            payer: { select: { name: true } },
            organization: { select: { name: true } },
          },
        },
      },
      orderBy: {
        workItem: { occurredAt: 'desc' },
      },
    });

    return {
      summary: {
        totalAmount: splits.reduce((sum, s) => sum + Number(s.amount), 0),
        currency: 'ARS', // Assumption
      },
      items: splits.map((s) => ({
        id: s.id,
        amount: Number(s.amount),
        role: s.roleLabel,
        service: s.workItem.serviceType,
        date: s.workItem.occurredAt,
        payer: s.workItem.payer.name,
        organization: s.workItem.organization.name,
      })),
    };
  }
}
