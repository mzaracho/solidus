/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { DashboardService } from './dashboard.service';

const makePrisma = () =>
  ({
    professional: { findMany: jest.fn(), findUnique: jest.fn() },
    workItem: { findMany: jest.fn(), groupBy: jest.fn() },
    payer: { findMany: jest.fn() },
  }) as any;

const EMPTY: unknown[] = [undefined, null, '', '   '];

describe('DashboardService: falla cerrado sin organización', () => {
  it.each(EMPTY)(
    'getChart con organización %p: 403 y sin consultas',
    async (org) => {
      const prisma = makePrisma();
      const service = new DashboardService(prisma);
      await expect(
        service.getChart(org as any, '2026-01-01', '2026-01-31', 'day'),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.getChart(
          org as any,
          undefined,
          undefined,
          'day',
          'ORGANIZATION',
          'u1',
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
        service.getPayerDistribution(org as any, '2026-01-01', '2026-01-31'),
      ).rejects.toMatchObject({ status: 403 });
      expect(prisma.workItem.groupBy).not.toHaveBeenCalled();
      expect(prisma.workItem.findMany).not.toHaveBeenCalled();
    },
  );

  it('getKpis sin organización devuelve ceros sin consultar', async () => {
    const prisma = makePrisma();
    const service = new DashboardService(prisma);
    const res = await service.getKpis({ organizationId: '' } as any);
    expect(res.accruedGross).toBe(0);
    expect(prisma.workItem.findMany).not.toHaveBeenCalled();
  });

  it('con organización, filtra el where por ella', async () => {
    const prisma = makePrisma();
    prisma.workItem.findMany.mockResolvedValue([]);
    prisma.workItem.groupBy.mockResolvedValue([]);
    prisma.payer.findMany.mockResolvedValue([]);
    const service = new DashboardService(prisma);
    await service.getChart('org-1', undefined, undefined, 'day');
    expect(prisma.workItem.findMany.mock.calls[0][0].where.organizationId).toBe(
      'org-1',
    );
    await service.getPayerDistribution('org-1');
    expect(prisma.workItem.groupBy.mock.calls[0][0].where.organizationId).toBe(
      'org-1',
    );
  });
});
