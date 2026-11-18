/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { makeCtx } from '../test/helpers/scope';
import { DashboardService } from './infrastructure/features/dashboard/dashboard.service';
import {
  CalculateSettlementsQuery,
  CalculateSettlementsQueryHandler,
} from './application/features/settlements/queries/calculate-settlements-query';
import {
  FindAllActivitiesQuery,
  FindAllActivitiesQueryHandler,
} from './application/features/activity/queries/find-all-activities-query';
import {
  FindActivityByIdQuery,
  FindActivityByIdQueryHandler,
} from './application/features/activity/queries/find-activity-by-id-query';
import {
  GetPatientSummaryQuery,
  GetPatientSummaryQueryHandler,
} from './application/features/patients/queries/get-patient-summary-query';
import { PatientsService } from './infrastructure/features/patients/patients.service';
import { ViewScope } from './infrastructure.bootstrap/config/core/cqrs/request-context';

// 017, criterios 1 y 2: los cálculos son exactos (0.1 + 0.2 = 0.3) y el formato JSON de los montos no cambia
// (siguen siendo `number`).
const D = (v: string | number) => new Prisma.Decimal(v);
const ORG = randomUUID();
const PRO = randomUUID();
const ORG_VIEW: ViewScope = {
  mode: 'org',
  requested: 'org',
  professionals: [],
};
const PRO_VIEW: ViewScope = {
  mode: 'pro',
  requested: 'pro',
  professionals: [{ id: PRO, organizationId: ORG, canLoadActivities: true }],
};

const split = (
  type: 'ORG' | 'PROFESSIONAL',
  beneficiaryId: string | null,
  amount: Prisma.Decimal,
) => ({
  beneficiaryType: type,
  beneficiaryId,
  amount,
});

const item = (over: Record<string, unknown>) => ({
  id: randomUUID(),
  organizationId: ORG,
  occurredAt: new Date('2026-01-10T12:00:00Z'),
  paymentStatus: 'UNPAID',
  paymentDate: null,
  grossAmount: D('0.1'),
  splits: [],
  ...over,
});

describe('DashboardService: dinero exacto y formato number', () => {
  const makePrisma = (items: any[]) =>
    ({
      workItem: {
        findMany: jest.fn().mockResolvedValue(items),
        groupBy: jest.fn(),
      },
      payer: { findMany: jest.fn().mockResolvedValue([]) },
    }) as any;

  const items = [
    item({
      grossAmount: D('0.1'),
      paymentStatus: 'PAID',
      splits: [split('ORG', null, D('0.1'))],
    }),
    item({
      grossAmount: D('0.2'),
      paymentStatus: 'UNPAID',
      splits: [
        split('ORG', null, D('0.07')),
        split('PROFESSIONAL', PRO, D('0.13')),
      ],
    }),
  ];

  it('getKpis (org): sumas exactas, todo number', async () => {
    const service = new DashboardService(makePrisma(items));
    const kpis = await service.getKpis(
      { organizationId: ORG } as any,
      ORG_VIEW,
    );
    expect(kpis).toEqual({
      accruedGross: 0.3,
      accruedNet: 0.17,
      pending: 0.2,
      cashGross: 0.1,
      cashNet: 0.1,
    });
    for (const v of Object.values(kpis)) expect(typeof v).toBe('number');
  });

  it('getKpis (pro): mi neto exacto', async () => {
    const service = new DashboardService(makePrisma(items));
    const kpis = await service.getKpis(
      { organizationId: ORG } as any,
      PRO_VIEW,
    );
    expect(kpis.accruedNet).toBe(0.13);
    expect(kpis.pending).toBe(0.13);
    expect(kpis.cashNet).toBe(0);
  });

  it('el resto del bruto que no se llevaron otros va a la organización (nunca negativo)', async () => {
    const only = [
      item({
        grossAmount: D('0.3'),
        splits: [
          split('PROFESSIONAL', PRO, D('0.1')),
          split('PROFESSIONAL', randomUUID(), D('0.2')),
        ],
      }),
    ];
    const service = new DashboardService(makePrisma(only));
    expect(
      (await service.getKpis({ organizationId: ORG } as any, ORG_VIEW))
        .accruedNet,
    ).toBe(0);
    const over = [
      item({
        grossAmount: D('0.1'),
        splits: [split('PROFESSIONAL', PRO, D('0.5'))],
      }),
    ];
    expect(
      (
        await new DashboardService(makePrisma(over)).getKpis(
          { organizationId: ORG } as any,
          ORG_VIEW,
        )
      ).accruedNet,
    ).toBe(0);
    const none = [item({ grossAmount: D('0.3') })];
    expect(
      (
        await new DashboardService(makePrisma(none)).getKpis(
          { organizationId: ORG } as any,
          ORG_VIEW,
        )
      ).accruedNet,
    ).toBe(0.3);
  });

  it('getChart: gross y net exactos y number', async () => {
    const service = new DashboardService(makePrisma(items));
    const chart = await service.getChart(
      ORG,
      undefined,
      undefined,
      'day',
      ORG_VIEW,
    );
    expect(chart).toEqual([{ date: '2026-01-10', gross: 0.3, net: 0.17 }]);
    expect(typeof chart[0].gross).toBe('number');
  });

  it('getPayerDistribution: value number', async () => {
    const prisma = makePrisma([]);
    prisma.workItem.groupBy.mockResolvedValue([
      { payerId: 'p1', _sum: { grossAmount: D('0.30') } },
    ]);
    prisma.payer.findMany.mockResolvedValue([{ id: 'p1', name: 'OS' }]);
    const res = await new DashboardService(prisma).getPayerDistribution(
      ORG,
      undefined,
      undefined,
      ORG_VIEW,
    );
    expect(res).toEqual([{ name: 'OS', value: 0.3 }]);
  });
});

describe('CalculateSettlementsQueryHandler: dinero exacto', () => {
  const run = async (workItems: any[]) => {
    const prisma: any = {
      organization: { findUnique: jest.fn().mockResolvedValue(null) },
      workItem: { findMany: jest.fn().mockResolvedValue(workItems) },
      professionalCategory: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const handler = new CalculateSettlementsQueryHandler(prisma);
    return handler.execute(
      Object.assign(new CalculateSettlementsQuery(), {
        month: '2026-01',
        organizationId: ORG,
      }),
    );
  };
  const pro = (id: string, pct: number | null) => ({
    id,
    displayName: 'Pro ' + id.slice(0, 4),
    category: pct == null ? null : { percentage: pct },
  });

  it('con participantes: suma de honorarios exacta (0.1 + 0.2 = 0.3) y number', async () => {
    const p1 = pro(randomUUID(), null);
    const res = await run([
      {
        occurredAt: new Date('2026-01-10T12:00:00Z'),
        serviceType: 'session',
        amountBase: D('1'),
        grossAmount: D('1'),
        professional: p1,
        patient: null,
        participants: [
          { professional: p1, feeAmount: D('0.1'), roleLabel: 'Titular' },
        ],
      },
      {
        occurredAt: new Date('2026-01-11T12:00:00Z'),
        serviceType: 'session',
        amountBase: D('1'),
        grossAmount: D('1'),
        professional: p1,
        patient: null,
        participants: [
          { professional: p1, feeAmount: D('0.2'), roleLabel: 'Titular' },
        ],
      },
    ]);
    expect(res).toHaveLength(1);
    expect(res[0].payout).toBe(0.3);
    expect(res[0].grossBase).toBe(2);
    expect(res[0].count).toBe(2);
    expect(res[0].details[0]).toMatchObject({
      calculationBase: 1,
      payoutAmount: 0.1,
      percent: 10,
    });
    expect(typeof res[0].payout).toBe('number');
  });

  it('rama vieja (sin participantes): la comisión de la categoría se redondea al centavo', async () => {
    const p1 = pro(randomUUID(), 33.33);
    const res = await run([
      {
        occurredAt: new Date('2026-01-10T12:00:00Z'),
        serviceType: 'session',
        amountBase: D('100.01'),
        grossAmount: D('100.01'),
        professional: p1,
        patient: null,
        participants: [],
      },
    ]);
    expect(res[0].payout).toBe(33.33);
    expect(res[0].details[0].payoutAmount).toBe(33.33);
    expect(res[0].details[0].percent).toBe(33.33);
  });
});

describe('FindAllActivities / FindActivityById: formato number e isCollected', () => {
  it('lista: commission y netAmount exactos y number; isCollected = PAID con fecha', async () => {
    const mk = (over: Record<string, unknown>) => ({
      id: randomUUID(),
      organizationId: ORG,
      occurredAt: new Date('2026-01-10T12:00:00Z'),
      serviceType: 'session',
      patientId: null,
      patient: null,
      professionalId: PRO,
      professional: { displayName: 'Pro' },
      presetId: null,
      payerId: randomUUID(),
      payer: { name: 'OS' },
      paymentStatus: 'UNPAID',
      paymentMethod: null,
      paymentDate: null,
      attendance: null,
      createdByUserId: null,
      grossAmount: D('0.3'),
      organization: { id: ORG, name: 'Org' },
      participants: [],
      splits: [
        split('ORG', null, D('0.1')),
        split('ORG', null, D('0.2')),
        split('PROFESSIONAL', PRO, D('0.1')),
        split('PROFESSIONAL', PRO, D('0.2')),
      ],
      ...over,
    });
    const rows = [
      mk({}),
      mk({
        paymentStatus: 'PAID',
        paymentDate: new Date('2026-01-12T12:00:00Z'),
      }),
      mk({ paymentStatus: 'PAID', paymentDate: null }),
    ];
    const prisma: any = {
      workItem: {
        count: jest.fn().mockResolvedValue(3),
        findMany: jest.fn().mockResolvedValue(rows),
      },
    };
    const query = new FindAllActivitiesQuery();
    query.organizationId = ORG;
    const res = await new FindAllActivitiesQueryHandler(prisma).execute(
      query,
      makeCtx({ roles: { [ORG]: 'ADMIN' }, view: { mode: 'org' } }),
    );
    expect(res.items[0]).toMatchObject({
      commission: 0.3,
      netAmount: 0.3,
      grossAmount: 0.3,
      paidAmount: 0,
    });
    expect(typeof res.items[0].commission).toBe('number');
    expect(res.items.map((i: any) => i.isCollected)).toEqual([
      false,
      true,
      false,
    ]);
    expect(res.items[1].paidAmount).toBe(0.3);
  });

  it('detalle: montos number e isCollected', async () => {
    const id = randomUUID();
    const row = {
      id,
      organizationId: ORG,
      occurredAt: new Date('2026-01-02T12:00:00Z'),
      serviceType: 'session',
      patient: null,
      professional: { displayName: 'Pro' },
      payer: null,
      preset: null,
      professionalId: PRO,
      paymentStatus: 'PAID',
      paymentDate: new Date('2026-01-03T12:00:00Z'),
      grossAmount: D('0.30'),
      splits: [split('PROFESSIONAL', PRO, D('0.10'))],
    };
    const handler = new FindActivityByIdQueryHandler({
      workItem: { findFirst: jest.fn().mockResolvedValue(row) },
    } as any);
    const res = await handler.execute(
      new FindActivityByIdQuery(id),
      makeCtx({ roles: { [ORG]: 'ADMIN' } }),
    );
    expect(res.isCollected).toBe(true);
    expect(res.grossAmount).toBe(0.3);
    expect(res.admissionValue).toBe(0.3);
    expect(res.distributions[0].amount).toBe(0.1);
    expect(typeof res.grossAmount).toBe('number');
  });
});

describe('deuda de pacientes: dinero exacto', () => {
  it('summary: totalDebt exacto y number', async () => {
    const patientId = randomUUID();
    const prisma: any = {
      patient: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: patientId, organizationId: ORG }),
      },
      professional: { findMany: jest.fn().mockResolvedValue([]) },
      workItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '1',
            occurredAt: new Date('2026-01-01T00:00:00Z'),
            serviceType: 's',
            grossAmount: D('0.1'),
            paymentStatus: 'UNPAID',
            payer: null,
            professional: null,
          },
          {
            id: '2',
            occurredAt: new Date('2026-01-02T00:00:00Z'),
            serviceType: 's',
            grossAmount: D('0.2'),
            paymentStatus: 'UNPAID',
            payer: null,
            professional: null,
          },
        ]),
      },
    };
    const res = await new GetPatientSummaryQueryHandler(prisma).execute(
      new GetPatientSummaryQuery(patientId),
      makeCtx({ roles: { [ORG]: 'ADMIN' } }),
    );
    expect(res.totalDebt).toBe(0.3);
    expect(res.pendingItems.map((i) => i.grossAmount)).toEqual([0.1, 0.2]);
  });

  it('calcDebt: exacto y number', async () => {
    const prisma: any = {
      workItem: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { grossAmount: D('0.1') },
            { grossAmount: D('0.2') },
          ]),
      },
    };
    const debt = await new PatientsService(prisma).calcDebt(randomUUID());
    expect(debt).toBe(0.3);
    expect(typeof debt).toBe('number');
  });
});
