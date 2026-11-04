/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import {
  FindAllActivitiesQuery,
  FindAllActivitiesQueryHandler,
} from './queries/find-all-activities-query';
import { makeCtx } from '../../../../test/helpers/scope';

// Montos con valores conocidos (criterio 7 del 009): el neto de la vista que corresponde no cambia.
const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const ME = 'pro-me';
const OTHER = 'pro-other';

const split = (
  beneficiaryType: 'ORG' | 'PROFESSIONAL',
  beneficiaryId: string | null,
  amount: number,
) => ({ beneficiaryType, beneficiaryId, amount });

const item = (over: Record<string, unknown>) => ({
  id: 'w',
  organizationId: ORG,
  occurredAt: new Date('2026-01-10T12:00:00Z'),
  serviceType: 'session',
  patientId: 'pat-1',
  patient: { firstName: 'Ana', lastName: 'Prueba' },
  professionalId: ME,
  professional: { displayName: 'Pro Yo' },
  presetId: null,
  payerId: null,
  payer: null,
  paymentStatus: 'UNPAID',
  paymentMethod: null,
  paymentDate: null,
  attendance: null,
  createdByUserId: null,
  grossAmount: 100,
  organization: { id: ORG, name: 'Clinica Uno' },
  participants: [],
  splits: [],
  ...over,
});

// A1: bruto 100; ORG 30, profesional propio 50, otro profesional 20.
const A1 = item({
  id: 'a1',
  splits: [
    split('ORG', null, 30),
    split('PROFESSIONAL', ME, 50),
    split('PROFESSIONAL', OTHER, 20),
  ],
  participants: [{ professionalId: ME, roleLabel: 'Admisor' }],
});
// A2: de otra organización, participa el profesional propio (vista multi-organización).
const A2 = item({
  id: 'a2',
  organizationId: OTHER_ORG,
  professionalId: OTHER,
  grossAmount: 200,
  organization: { id: OTHER_ORG, name: 'Clinica Dos' },
  splits: [split('ORG', null, 40), split('PROFESSIONAL', ME, 160)],
  participants: [{ professionalId: ME, roleLabel: 'Coadmisor' }],
});

const makePrisma = (items: any[]) =>
  ({
    professional: { findMany: jest.fn() },
    workItem: {
      count: jest.fn().mockResolvedValue(items.length),
      findMany: jest.fn().mockResolvedValue(items),
    },
  }) as any;

// El modo y los Professional salen de ctx.view (lo que deja ViewModeGuard), no del query.
async function run(
  prisma: any,
  mode: 'org' | 'pro',
  professionals: Array<{ id: string; organizationId: string }> = [
    { id: ME, organizationId: ORG },
  ],
) {
  const handler = new FindAllActivitiesQueryHandler(prisma);
  const query = new FindAllActivitiesQuery();
  query.organizationId = ORG;
  const ctx = makeCtx({
    roles: { [ORG]: mode === 'org' ? 'ADMIN' : null },
    view: { mode, professionals: mode === 'pro' ? professionals : [] },
  });
  return handler.execute(query, ctx);
}

describe('FindAllActivitiesQueryHandler: montos conocidos', () => {
  it('org: netAmount = splits PROFESSIONAL (70) y commission = splits ORG (30)', async () => {
    const prisma = makePrisma([A1]);
    const res = await run(prisma, 'org');
    expect(res.items[0]).toMatchObject({
      id: 'a1',
      grossAmount: 100,
      commission: 30,
      netAmount: 70,
      role: null,
      isExternal: false,
      isReadOnly: false,
    });
    expect(prisma.workItem.findMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
    });
  });

  it('pro: netAmount = solo splits del Professional propio (50) y role del participante', async () => {
    const prisma = makePrisma([A1, A2]);
    const res = await run(prisma, 'pro');
    const [a1, a2] = res.items;
    expect(a1).toMatchObject({
      id: 'a1',
      grossAmount: 100,
      commission: 30,
      netAmount: 50,
      role: 'Admisor',
      isExternal: false,
    });
    expect(a2).toMatchObject({
      id: 'a2',
      grossAmount: 200,
      netAmount: 160,
      role: 'Coadmisor',
      isExternal: true,
      isReadOnly: true,
    });
  });

  it('pro: lista por profesional propio o participante, sin filtro de organización', async () => {
    const prisma = makePrisma([A1]);
    await run(prisma, 'pro');
    expect(prisma.workItem.findMany.mock.calls[0][0].where).toEqual({
      OR: [
        { professionalId: { in: [ME] } },
        { participants: { some: { professionalId: { in: [ME] } } } },
      ],
    });
  });

  it('pro: el profesional principal sin participante tiene role "Profesional"', async () => {
    const prisma = makePrisma([item({ id: 'a3', participants: [] })]);
    const res = await run(prisma, 'pro');
    expect(res.items[0].role).toBe('Profesional');
  });

  it('pro con professionals vacio: pagina vacia sin consultar atenciones', async () => {
    const prisma = makePrisma([A1]);
    const res = await run(prisma, 'pro', []);
    expect(res).toEqual({
      items: [],
      total: 0,
      page: 0,
      pageSize: 0,
      totalPages: 0,
    });
    expect(prisma.workItem.findMany).not.toHaveBeenCalled();
  });

  it('nunca consulta professional.findMany (los Professional vienen del contexto)', async () => {
    for (const mode of ['org', 'pro'] as const) {
      const prisma = makePrisma([A1]);
      await run(prisma, mode);
      expect(prisma.professional.findMany).not.toHaveBeenCalled();
    }
  });

  it('sin ctx.view (ruta sin @UsesViewMode): 403 forbidden, sin consultas', async () => {
    const prisma = makePrisma([A1]);
    const handler = new FindAllActivitiesQueryHandler(prisma);
    const query = new FindAllActivitiesQuery();
    query.organizationId = ORG;
    const ctx = makeCtx({ roles: { [ORG]: 'ADMIN' } });
    await expect(handler.execute(query, ctx)).rejects.toMatchObject({
      status: 403,
    });
    expect(prisma.workItem.findMany).not.toHaveBeenCalled();
  });
});
