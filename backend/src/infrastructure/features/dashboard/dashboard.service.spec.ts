/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { DashboardService } from './dashboard.service';
import { ViewScope } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';

const makePrisma = () =>
  ({
    professional: { findMany: jest.fn(), findUnique: jest.fn() },
    workItem: { findMany: jest.fn(), groupBy: jest.fn() },
    payer: { findMany: jest.fn() },
  }) as any;

const EMPTY: unknown[] = [undefined, null, '', '   '];

const ORG_VIEW: ViewScope = { mode: 'org', requested: 'org', professionals: [] };
const proView = (...ids: string[]): ViewScope => ({
  mode: 'pro',
  requested: 'pro',
  professionals: ids.map((id) => ({
    id,
    organizationId: 'org-1',
    canLoadActivities: false,
  })),
});

describe('DashboardService: falla cerrado sin organización', () => {
  it.each(EMPTY)(
    'getChart con organización %p: 403 y sin consultas',
    async (org) => {
      const prisma = makePrisma();
      const service = new DashboardService(prisma);
      await expect(
        service.getChart(org as any, '2026-01-01', '2026-01-31', 'day', ORG_VIEW),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.getChart(
          org as any,
          undefined,
          undefined,
          'day',
          ORG_VIEW,
          'CASH',
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(prisma.workItem.findMany).not.toHaveBeenCalled();
      expect(prisma.professional.findMany).not.toHaveBeenCalled();
    },
  );

  it.each(EMPTY)(
    'getPayerDistribution con organización %p: 403 y sin consultas',
    async (org) => {
      const prisma = makePrisma();
      const service = new DashboardService(prisma);
      await expect(
        service.getPayerDistribution(
          org as any,
          '2026-01-01',
          '2026-01-31',
          ORG_VIEW,
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(prisma.workItem.groupBy).not.toHaveBeenCalled();
      expect(prisma.workItem.findMany).not.toHaveBeenCalled();
    },
  );

  it('getKpis sin organización devuelve ceros sin consultar', async () => {
    const prisma = makePrisma();
    const service = new DashboardService(prisma);
    const res = await service.getKpis({ organizationId: '' } as any, ORG_VIEW);
    expect(res.accruedGross).toBe(0);
    expect(prisma.workItem.findMany).not.toHaveBeenCalled();
  });

  it('con organización, filtra el where por ella', async () => {
    const prisma = makePrisma();
    prisma.workItem.findMany.mockResolvedValue([]);
    prisma.workItem.groupBy.mockResolvedValue([]);
    prisma.payer.findMany.mockResolvedValue([]);
    const service = new DashboardService(prisma);
    await service.getChart('org-1', undefined, undefined, 'day', ORG_VIEW);
    expect(prisma.workItem.findMany.mock.calls[0][0].where.organizationId).toBe(
      'org-1',
    );
    await service.getPayerDistribution(
      'org-1',
      undefined,
      undefined,
      ORG_VIEW,
    );
    expect(prisma.workItem.groupBy.mock.calls[0][0].where.organizationId).toBe(
      'org-1',
    );
  });
});

// -- Montos conocidos (criterio 7 del 009) -----------------------------------
const ME = 'pro-me';
const OTHER = 'pro-other';
const sp = (
  beneficiaryType: 'ORG' | 'PROFESSIONAL',
  beneficiaryId: string | null,
  amount: number,
) => ({ beneficiaryType, beneficiaryId, amount });
const wi = (over: Record<string, unknown>) => ({
  occurredAt: new Date('2026-01-10T12:00:00Z'),
  paymentDate: null,
  paymentStatus: 'UNPAID',
  grossAmount: 0,
  splits: [],
  ...over,
});
const ITEMS = [
  // i1: pagada, ORG 30 + propio 50 + otro 20
  wi({
    grossAmount: 100,
    paymentStatus: 'PAID',
    splits: [sp('ORG', null, 30), sp('PROFESSIONAL', ME, 50), sp('PROFESSIONAL', OTHER, 20)],
  }),
  // i2: impaga, sin split ORG: la organizacion se queda con el remanente (200 - 120 = 80)
  wi({ grossAmount: 200, splits: [sp('PROFESSIONAL', ME, 120)] }),
  // i3: pagada, sin splits: la organizacion se queda con todo
  wi({
    grossAmount: 50,
    paymentStatus: 'PAID',
    occurredAt: new Date('2026-01-11T12:00:00Z'),
  }),
  // i4: impaga, sin splits
  wi({ grossAmount: 80, occurredAt: new Date('2026-01-12T12:00:00Z') }),
];

const makeKnown = () => {
  const prisma = makePrisma();
  prisma.workItem.findMany.mockResolvedValue(ITEMS);
  return prisma;
};

const KPI_QUERY = {
  organizationId: 'org-1',
  startDate: '2026-01-01',
  endDate: '2026-01-31',
};

describe('DashboardService: montos conocidos', () => {
  it('getKpis en organizacion', async () => {
    const service = new DashboardService(makeKnown());
    const res = await service.getKpis(KPI_QUERY as any, ORG_VIEW);
    expect(res).toEqual({
      accruedGross: 430,
      accruedNet: 240, // 30 + 80 + 50 + 80
      pending: 280, // bruto impago: 200 + 80
      cashGross: 150,
      cashNet: 80, // 30 + 50
    });
  });

  it('getKpis en profesional: solo splits propios', async () => {
    const prisma = makeKnown();
    const service = new DashboardService(prisma);
    const res = await service.getKpis(KPI_QUERY as any, proView(ME));
    expect(res).toEqual({
      accruedGross: 430,
      accruedNet: 170, // 50 + 120
      pending: 120, // neto propio de las impagas
      cashGross: 150,
      cashNet: 50,
    });
    const where = prisma.workItem.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toBeUndefined();
    expect(where.OR).toEqual([
      { professionalId: { in: [ME] } },
      { participants: { some: { professionalId: { in: [ME] } } } },
    ]);
  });

  it('getChart por dia en organizacion', async () => {
    const service = new DashboardService(makeKnown());
    const res = await service.getChart('org-1', '2026-01-01', '2026-01-31', 'day', ORG_VIEW);
    expect(res).toEqual([
      { date: '2026-01-10', gross: 300, net: 110 },
      { date: '2026-01-11', gross: 50, net: 50 },
      { date: '2026-01-12', gross: 80, net: 80 },
    ]);
  });

  it('getChart por dia en profesional', async () => {
    const service = new DashboardService(makeKnown());
    const res = await service.getChart('org-1', '2026-01-01', '2026-01-31', 'day', proView(ME));
    expect(res).toEqual([
      { date: '2026-01-10', gross: 300, net: 170 },
      { date: '2026-01-11', gross: 50, net: 0 },
      { date: '2026-01-12', gross: 80, net: 0 },
    ]);
  });

  const payerMocks = () => {
    const prisma = makeKnown();
    prisma.workItem.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
    prisma.workItem.groupBy.mockResolvedValue([
      { payerId: 'py1', _sum: { grossAmount: 300 } },
      { payerId: null, _sum: { grossAmount: 50 } },
    ]);
    prisma.payer.findMany.mockResolvedValue([{ id: 'py1', name: 'Obra Social Uno' }]);
    return prisma;
  };

  it('getPayerDistribution en organizacion', async () => {
    const prisma = payerMocks();
    const service = new DashboardService(prisma);
    const res = await service.getPayerDistribution('org-1', '2026-01-01', '2026-01-31', ORG_VIEW);
    expect(res).toEqual([
      { name: 'Obra Social Uno', value: 300 },
      { name: 'Particular', value: 50 },
    ]);
    expect(prisma.workItem.groupBy.mock.calls[0][0].where.organizationId).toBe('org-1');
  });

  it('getPayerDistribution en profesional: ids de atenciones propias', async () => {
    const prisma = payerMocks();
    const service = new DashboardService(prisma);
    const res = await service.getPayerDistribution('org-1', '2026-01-01', '2026-01-31', proView(ME));
    expect(res).toEqual([
      { name: 'Obra Social Uno', value: 300 },
      { name: 'Particular', value: 50 },
    ]);
    const where = prisma.workItem.groupBy.mock.calls[0][0].where;
    expect(where.organizationId).toBeUndefined();
    expect(where.id).toEqual({ in: ['w1', 'w2'] });
  });
});

describe('DashboardService: vista pro desde el contexto', () => {
  it('sin Professional en la vista pro: ceros, [] y [] sin consultar atenciones', async () => {
    const prisma = makePrisma();
    const service = new DashboardService(prisma);
    const kpis = await service.getKpis(KPI_QUERY as any, proView());
    expect(kpis).toEqual({
      accruedGross: 0,
      accruedNet: 0,
      pending: 0,
      cashGross: 0,
      cashNet: 0,
    });
    expect(
      await service.getChart('org-1', undefined, undefined, 'day', proView()),
    ).toEqual([]);
    expect(
      await service.getPayerDistribution('org-1', undefined, undefined, proView()),
    ).toEqual([]);
    expect(prisma.workItem.findMany).not.toHaveBeenCalled();
    expect(prisma.workItem.groupBy).not.toHaveBeenCalled();
  });

  it('nunca consulta professional.findMany', async () => {
    const prisma = makeKnown();
    const service = new DashboardService(prisma);
    await service.getKpis(KPI_QUERY as any, proView(ME));
    await service.getChart('org-1', undefined, undefined, 'day', proView(ME));
    expect(prisma.professional.findMany).not.toHaveBeenCalled();
  });
});
