import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { BeneficiaryType, PaymentStatus } from '@prisma/client';

// Daily Report
export class GetDailyReportQuery implements IRequest<any> {
  @ApiProperty()
  @IsString()
  userId: string;
}

@RequestHandler(GetDailyReportQuery)
@Injectable()
export class GetDailyReportQueryHandler implements IRequestHandler<
  GetDailyReportQuery,
  any
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(query: GetDailyReportQuery): Promise<any> {
    const { userId } = query;
    if (!userId) return { error: 'userId required' };

    const professionalIds = await this.getProfessionalIds(userId);

    const workItems = await this.prisma.workItem.findMany({
      where: {
        professional: { userId },
      },
      include: {
        patient: true,
        payer: true,
        organization: true,
        splits: true,
      },
      orderBy: { occurredAt: 'desc' },
    });

    return workItems.map((item) => {
      const mySplit = item.splits.find(
        (s) =>
          s.beneficiaryType === BeneficiaryType.PROFESSIONAL &&
          professionalIds.includes(s.beneficiaryId || ''),
      );
      const orgSplit = item.splits.find((s) => s.beneficiaryType === BeneficiaryType.ORG);

      const honorarios = mySplit ? Number(mySplit.amount) : 0;
      const commission = orgSplit ? Number(orgSplit.amount) : 0;

      return {
        date: item.occurredAt,
        patient: item.patient
          ? `${item.patient.firstName} ${item.patient.lastName}`
          : 'N/A',
        network: item.payer.name,
        grossAmount: Number(item.grossAmount),
        attendance: item.attendance,
        paymentStatus: item.paymentStatus,
        commissionPaid: commission,
        netAmount: honorarios,
      };
    });
  }

  private async getProfessionalIds(userId: string): Promise<string[]> {
    const profiles = await this.prisma.professional.findMany({
      where: { userId },
      select: { id: true },
    });
    return profiles.map((p) => p.id);
  }
}

// Debtors Report
export class GetDebtorsReportQuery implements IRequest<any> {
  @ApiProperty()
  @IsString()
  userId: string;
}

@RequestHandler(GetDebtorsReportQuery)
@Injectable()
export class GetDebtorsReportQueryHandler implements IRequestHandler<
  GetDebtorsReportQuery,
  any
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(query: GetDebtorsReportQuery): Promise<any> {
    const { userId } = query;
    if (!userId) return { error: 'userId required' };

    const workItems = await this.prisma.workItem.findMany({
      where: {
        professional: { userId },
        paymentStatus: { not: 'PAID' },
      },
      include: {
        patient: true,
      },
      orderBy: { occurredAt: 'asc' },
    });

    const debtorMap = new Map<
      string,
      { patient: string; totalDebt: number; items: number }
    >();

    for (const item of workItems) {
      if (!item.patient) continue;
      const key = item.patient.id;
      const current = debtorMap.get(key) || {
        patient: `${item.patient.firstName} ${item.patient.lastName}`,
        totalDebt: 0,
        items: 0,
      };
      current.totalDebt += Number(item.grossAmount);
      current.items += 1;
      debtorMap.set(key, current);
    }

    return Array.from(debtorMap.values());
  }
}

// Monthly Report
export class GetMonthlyReportQuery implements IRequest<any> {
  @ApiProperty()
  @IsString()
  userId: string;
}

@RequestHandler(GetMonthlyReportQuery)
@Injectable()
export class GetMonthlyReportQueryHandler implements IRequestHandler<
  GetMonthlyReportQuery,
  any
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(query: GetMonthlyReportQuery): Promise<any> {
    const { userId } = query;
    if (!userId) return { error: 'userId required' };

    const workItems = await this.prisma.workItem.findMany({
      where: {
        professional: { userId },
      },
      include: {
        splits: true,
        payer: true,
      },
    });

    const monthlyData = new Map<
      string,
      {
        month: string;
        totalCollected: number;
        commissions: Record<string, number>;
        netTotal: number;
      }
    >();

    for (const item of workItems) {
      const monthKey = item.occurredAt.toISOString().slice(0, 7);

      const entry = monthlyData.get(monthKey) || {
        month: monthKey,
        totalCollected: 0,
        commissions: {},
        netTotal: 0,
      };

      if (item.paymentStatus === PaymentStatus.PAID) {
        const orgSplit = item.splits.find((s) => s.beneficiaryType === BeneficiaryType.ORG);
        const mySplit = item.splits.find(
          (s) => s.beneficiaryType === BeneficiaryType.PROFESSIONAL,
        );

        entry.totalCollected += Number(item.grossAmount);
        entry.netTotal += mySplit ? Number(mySplit.amount) : 0;

        const payerName = item.payer.name;
        const comm = orgSplit ? Number(orgSplit.amount) : 0;

        entry.commissions[payerName] =
          (entry.commissions[payerName] || 0) + comm;
      }

      monthlyData.set(monthKey, entry);
    }

    return Array.from(monthlyData.values()).sort((a, b) =>
      b.month.localeCompare(a.month),
    );
  }
}
