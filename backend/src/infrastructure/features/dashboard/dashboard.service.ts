import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { BeneficiaryType, PaymentStatus, Prisma } from '@prisma/client';
import { DashboardKpiQueryDto } from '@src/application/features/dashboard/Dtos/dashboard-kpi-query.dto';
import { DashboardKpisResponseDto } from '@src/application/features/dashboard/Dtos/dashboard-kpis-response.dto';
import {
  professionalIdsOf,
  requireOrgId,
  ViewScope,
} from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { Money, money, nonNegative, sumMoney, toJsonNumber } from '@src/domain/seed-work/money';

type SplitLike = { beneficiaryId: string | null; beneficiaryType: BeneficiaryType; amount: Prisma.Decimal };
type ItemLike = { grossAmount: Prisma.Decimal; splits: SplitLike[] };

/** Lo que se lleva el profesional (mis splits). */
const myShare = (item: ItemLike, proIds: string[]): Money =>
  sumMoney(
    item.splits
      .filter((s) => s.beneficiaryId != null && proIds.includes(s.beneficiaryId))
      .map((s) => s.amount),
  );

/** Neto de la organización: splits ORG; si no hay, el resto del bruto; si no hay splits, el bruto. */
const orgNet = (item: ItemLike): Money => {
  const orgSplits = item.splits.filter((s) => s.beneficiaryType === BeneficiaryType.ORG);
  if (orgSplits.length > 0) return sumMoney(orgSplits.map((s) => s.amount));
  if (item.splits.length > 0) {
    // If splits exist but no explicit ORG split, ORG gets the remainder (Gross - what others took)
    const othersTook = sumMoney(item.splits.map((s) => s.amount));
    return nonNegative(money(item.grossAmount).sub(othersTook));
  }
  // No splits recorded: fallback to full gross
  return money(item.grossAmount);
};

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) { }

  /**
   * El modo y los Professional del usuario (`view`) los resolvio ViewModeGuard con los vinculos de la base;
   * el servicio no consulta Professional ni lee ningun dato de modo del cliente.
   */
  async getKpis(
    query: DashboardKpiQueryDto,
    view: ViewScope,
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
    const isPro = view.mode === 'pro';
    const proIds: string[] = isPro ? professionalIdsOf(view) : [];
    if (isPro) {
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
    const netOf = (item: ItemLike): Money => (isPro ? myShare(item, proIds) : orgNet(item));

    // 1. Accrued Gross (Total Invoiced/Worked)
    const accruedGross = sumMoney(items.map((item) => item.grossAmount));

    // 2. Accrued Net (Total Earnings - My Share; en modo organización, lo atribuido a la organización)
    const accruedNet = sumMoney(items.map(netOf));

    // 3. Pending (Outstanding)
    // Pro: mi neto pendiente. Org: el bruto que la organización espera del pagador.
    const pendingItems = items.filter((i) => i.paymentStatus !== PaymentStatus.PAID);
    const pending = isPro
      ? sumMoney(pendingItems.map((item) => myShare(item, proIds)))
      : sumMoney(pendingItems.map((i) => i.grossAmount));

    // 4. Cash Gross (Collected Gross): paymentStatus PAID
    const paidItems = items.filter((i) => i.paymentStatus === PaymentStatus.PAID);
    const cashGross = sumMoney(paidItems.map((item) => item.grossAmount));

    // 5. Cash Net (Collected Net)
    const cashNet = sumMoney(paidItems.map(netOf));

    return {
      accruedGross: toJsonNumber(accruedGross),
      accruedNet: toJsonNumber(accruedNet),
      pending: toJsonNumber(pending),
      cashGross: toJsonNumber(cashGross),
      cashNet: toJsonNumber(cashNet),
    };
  }

  async getChart(
    organizationId: string,
    startDate: string | undefined,
    endDate: string | undefined,
    groupBy: 'day' | 'month' | undefined,
    view: ViewScope,
    basis: 'ACCRUED' | 'CASH' = 'ACCRUED'
  ) {
    organizationId = requireOrgId(organizationId);
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

    const isPro = view.mode === 'pro';
    const proIds: string[] = isPro ? professionalIdsOf(view) : [];
    if (isPro) {
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
    const groups: Record<string, { gross: Money; net: Money; date: string }> = {};

    for (const item of items) {
      const dateObj = basis === 'CASH' && item.paymentDate ? item.paymentDate : item.occurredAt;
      const dateKey = dateObj.toISOString().split('T')[0]; // Daily grouping default

      // Adjust key for monthly if needed (not implemented fully in logic above, defaulting to day or map later)
      // Assuming groupBy='day' is primary for now.

      if (!groups[dateKey]) {
        groups[dateKey] = { date: dateKey, gross: money(0), net: money(0) };
      }

      // Pro: my splits. Organization mode: Net = ORG-attributed splits (retention / remainder)
      const net = isPro ? myShare(item, proIds) : orgNet(item);

      groups[dateKey].gross = groups[dateKey].gross.add(item.grossAmount);
      groups[dateKey].net = groups[dateKey].net.add(net);
    }

    // Convert to array and sort
    const result = Object.values(groups)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((g) => ({ date: g.date, gross: toJsonNumber(g.gross), net: toJsonNumber(g.net) }));
    return result;
  }


  async getPayerDistribution(
    organizationId: string,
    startDate: string | undefined,
    endDate: string | undefined,
    view: ViewScope,
  ) {
    organizationId = requireOrgId(organizationId);
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
    if (view.mode === 'pro') {
      const proIds = professionalIdsOf(view);
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
      value: toJsonNumber(g._sum.grossAmount)
    }));
  }
}
