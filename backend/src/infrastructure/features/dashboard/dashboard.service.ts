import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { BeneficiaryType, PaymentStatus, Prisma } from '@prisma/client';
import { isProfessionalMode } from '@src/domain/constants/app.constants';
import { DashboardKpiQueryDto } from '@src/application/features/dashboard/Dtos/dashboard-kpi-query.dto';
import { DashboardKpisResponseDto } from '@src/application/features/dashboard/Dtos/dashboard-kpis-response.dto';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) { }

  private async resolveProfessionalId(organizationId: string, userId: string): Promise<string | null> {
    const pro = await this.prisma.professional.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      select: { id: true },
    });
    return pro?.id || null;
  }

  private async resolveAllProfessionalIds(userId: string): Promise<string[]> {
    const pros = await this.prisma.professional.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { id: true },
    });
    return pros.map(p => p.id);
  }

  async getKpis(
    query: DashboardKpiQueryDto,
  ): Promise<DashboardKpisResponseDto> {
    if (!query.organizationId) {
      return {
        accruedGross: 0,
        accruedNet: 0,
        pending: 0,
        cashGross: 0,
        cashNet: 0
      };
    }

    const where: Prisma.WorkItemWhereInput = {};

    if (query.startDate && query.endDate) {
      const end = new Date(query.endDate);
      end.setUTCHours(23, 59, 59, 999);
      where.occurredAt = {
        gte: new Date(query.startDate),
        lte: end,
      };
    }

    // Cross-org filtering for Professional mode (same logic as FindAllActivitiesQuery)
    let proIds: string[] = [];
    if (isProfessionalMode(query.mode) && query.userId) {
      proIds = await this.resolveAllProfessionalIds(query.userId);
      if (proIds.length === 0) {
        return {
          accruedGross: 0,
          accruedNet: 0,
          pending: 0,
          cashGross: 0,
          cashNet: 0
        };
      }
      where.OR = [
        { professionalId: { in: proIds } },
        { participants: { some: { professionalId: { in: proIds } } } },
      ];
    } else {
      // Org mode: restrict to the current org
      where.organizationId = query.organizationId;
    }

    const items = await this.prisma.workItem.findMany({
      where,
      include: { splits: true }
    });

    // KPI Calculation Logic
    // 1. Accrued Gross (Total Invoiced/Worked)
    const accruedGross = items.reduce((sum, item) => sum + Number(item.grossAmount), 0);

    // 2. Accrued Net (Total Earnings - My Share)
    let accruedNet = 0;
    if (isProfessionalMode(query.mode) && proIds.length > 0) {
      items.forEach(item => {
        const mySplits = item.splits.filter(s => s.beneficiaryId != null && proIds.includes(s.beneficiaryId!));
        const myShare = mySplits.reduce((acc, s) => acc + Number(s.amount), 0);
        accruedNet += myShare;
      });
    } else {
      // Organization Mode (Net = ORG-attributed splits)
      items.forEach(item => {
        const orgSplits = item.splits.filter(s => s.beneficiaryType === BeneficiaryType.ORG);
        if (orgSplits.length > 0) {
          accruedNet += orgSplits.reduce((acc, s) => acc + Number(s.amount), 0);
        } else if (item.splits.length > 0) {
          // If splits exist but no explicit ORG split, ORG gets the remainder (Gross - what others took)
          const othersTook = item.splits.reduce((acc, s) => acc + Number(s.amount), 0);
          accruedNet += Math.max(0, Number(item.grossAmount) - othersTook);
        } else {
          // No splits recorded: fallback to full gross
          accruedNet += Number(item.grossAmount);
        }
      });
    }

    // 3. Pending (Outstanding)
    // Pending usually refers to what is NOT paid yet.
    // If Pro, it should be My Pending Net? Or Total Pending Gross?
    // "Pendiente de Cobro" usually implies money I am waiting for.
    // If I work for an Org, I wait for my fees, NOT the total gross (Org collects gross, pays me net).
    // So Pending should probably be NET Pending for Pro mode.
    // However, existing logic was Gross. Let's stick to Gross for consistency unless refined.
    // Updates: User asked for "Pendiente de cobro" (The amount pending collection).
    // Let's implement Net Pending for Pro Mode, as that's what they care about collecting.
    // AND Gross Pending for Org Mode.
    let pending = 0;
    const pendingItems = items.filter(i => i.paymentStatus !== PaymentStatus.PAID);

    if (isProfessionalMode(query.mode) && proIds.length > 0) {
      pendingItems.forEach(item => {
        const mySplits = item.splits.filter(s => s.beneficiaryId != null && proIds.includes(s.beneficiaryId!));
        pending += mySplits.reduce((acc, s) => acc + Number(s.amount), 0);
      });
    } else {
      pending += pendingItems.reduce((sum, i) => sum + Number(i.grossAmount), 0); // Org waits for Gross from Payer
    }

    // 4. Cash Gross (Collected Gross)
    // Items where paymentStatus IS 'PAID'
    const paidItems = items.filter(i => i.paymentStatus === PaymentStatus.PAID);
    const cashGross = paidItems.reduce((sum, item) => sum + Number(item.grossAmount), 0);

    // 5. Cash Net (Collected Net)
    let cashNet = 0;
    if (isProfessionalMode(query.mode) && proIds.length > 0) {
      paidItems.forEach(item => {
        const mySplits = item.splits.filter(s => s.beneficiaryId != null && proIds.includes(s.beneficiaryId!));
        cashNet += mySplits.reduce((acc, s) => acc + Number(s.amount), 0);
      });
    } else {
      // Org Cash Net (Retention collected)
      paidItems.forEach(item => {
        const orgSplits = item.splits.filter(s => s.beneficiaryType === BeneficiaryType.ORG);
        if (orgSplits.length > 0) {
          cashNet += orgSplits.reduce((acc, s) => acc + Number(s.amount), 0);
        } else if (item.splits.length > 0) {
          const othersTook = item.splits.reduce((acc, s) => acc + Number(s.amount), 0);
          cashNet += Math.max(0, Number(item.grossAmount) - othersTook);
        } else {
          cashNet += Number(item.grossAmount);
        }
      });
    }

    return {
      accruedGross,
      accruedNet,
      pending,
      cashGross,
      cashNet
    };
  }

  async getChart(
    organizationId: string,
    startDate?: string,
    endDate?: string,
    groupBy?: 'day' | 'month',
    mode?: 'ORGANIZATION' | 'PROFESSIONAL',
    userId?: string,
    basis: 'ACCRUED' | 'CASH' = 'ACCRUED'
  ) {
    const where: Prisma.WorkItemWhereInput = {};

    if (basis === 'CASH') {
      where.paymentStatus = PaymentStatus.PAID;
      if (startDate && endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        where.paymentDate = {
          gte: new Date(startDate),
          lte: end,
        };
      }
    } else {
      if (startDate && endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        where.occurredAt = {
          gte: new Date(startDate),
          lte: end,
        };
      }
    }

    let proIds: string[] = [];
    if (isProfessionalMode(mode) && userId) {
      proIds = await this.resolveAllProfessionalIds(userId);
      if (proIds.length === 0) return [];
      where.OR = [
        { professionalId: { in: proIds } },
        { participants: { some: { professionalId: { in: proIds } } } },
      ];
    } else {
      where.organizationId = organizationId;
    }

    const items = await this.prisma.workItem.findMany({
      where,
      include: {
        splits: true
      },
      orderBy: { occurredAt: 'asc' }
    });

    // Grouping
    const groups: Record<string, { gross: number, net: number, date: string }> = {};

    for (const item of items) {
      const dateObj = basis === 'CASH' && item.paymentDate ? item.paymentDate : item.occurredAt;
      const dateKey = dateObj.toISOString().split('T')[0]; // Daily grouping default

      // Adjust key for monthly if needed (not implemented fully in logic above, defaulting to day or map later)
      // Assuming groupBy='day' is primary for now.

      if (!groups[dateKey]) {
        groups[dateKey] = { date: dateKey, gross: 0, net: 0 };
      }

      // Calculate Amount
      const gross = Number(item.grossAmount);
      let net = 0;

      if (isProfessionalMode(mode) && proIds.length > 0) {
        const mySplits = item.splits.filter(s => s.beneficiaryId != null && proIds.includes(s.beneficiaryId!));
        net = mySplits.reduce((acc, s) => acc + Number(s.amount), 0);
      } else {
        // Organization mode: Net = ORG-attributed splits (retention / remainder)
        const orgSplits = item.splits.filter(s => s.beneficiaryType === BeneficiaryType.ORG);
        if (orgSplits.length > 0) {
          net = orgSplits.reduce((acc, s) => acc + Number(s.amount), 0);
        } else if (item.splits.length > 0) {
          const othersTook = item.splits.reduce((acc, s) => acc + Number(s.amount), 0);
          net = Math.max(0, Number(item.grossAmount) - othersTook);
        } else {
          net = Number(item.grossAmount);
        }
      }

      groups[dateKey].gross += gross;
      groups[dateKey].net += net;
    }

    // Convert to array and sort
    const result = Object.values(groups).sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }


  async getPayerDistribution(
    organizationId: string,
    startDate?: string,
    endDate?: string,
    mode?: 'ORGANIZATION' | 'PROFESSIONAL',
    userId?: string
  ) {
    const where: Prisma.WorkItemWhereInput = {};

    if (startDate && endDate) {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      where.occurredAt = {
        gte: new Date(startDate),
        lte: end,
      };
    }

    // Cross-org filtering for Professional mode
    if (isProfessionalMode(mode) && userId) {
      const proIds = await this.resolveAllProfessionalIds(userId);
      if (proIds.length === 0) return [];
      // groupBy doesn't support nested-relation OR; resolve matching IDs first
      const matchingItems = await this.prisma.workItem.findMany({
        where: {
          ...where,
          OR: [
            { professionalId: { in: proIds } },
            { participants: { some: { professionalId: { in: proIds } } } },
          ],
        },
        select: { id: true },
      });
      where.id = { in: matchingItems.map(i => i.id) };
    } else {
      where.organizationId = organizationId;
    }

    // Group by PayerId
    const grouped = await this.prisma.workItem.groupBy({
      by: ['payerId'],
      where,
      _sum: {
        grossAmount: true
      }
    });

    // Fetch names
    const payerIds = grouped.map(g => g.payerId);
    const payers = await this.prisma.payer.findMany({
      where: { id: { in: payerIds } },
      select: { id: true, name: true }
    });

    const payerMap = new Map(payers.map(p => [p.id, p.name]));

    return grouped.map(g => ({
      name: g.payerId ? (payerMap.get(g.payerId) || 'Desconocido') : 'Particular',
      value: Number(g._sum.grossAmount || 0)
    }));
  }
}
