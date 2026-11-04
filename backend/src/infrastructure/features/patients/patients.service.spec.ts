/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { ViewScope } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { PatientsService } from './patients.service';

const ORG = 'org-1';
const SOLO = 'org-solo';
const ME = 'pro-me';

const makePrisma = () =>
  ({
    professional: { findMany: jest.fn() },
    organizationMember: {
      findMany: jest.fn().mockResolvedValue([
        {
          organizationId: SOLO,
          role: 'ADMIN',
          organization: { type: 'SOLO_PRACTICE' },
        },
      ]),
    },
    patient: { findMany: jest.fn().mockResolvedValue([]) },
    workItem: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
    },
  }) as any;

const ORG_VIEW: ViewScope = {
  mode: 'org',
  requested: 'org',
  professionals: [],
};
const proView = (...ids: string[]): ViewScope => ({
  mode: 'pro',
  requested: 'pro',
  professionals: ids.map((id) => ({
    id,
    organizationId: ORG,
    canLoadActivities: false,
  })),
});
const filter = { organizationId: ORG, userId: 'u1', page: 1, limit: 10 };

describe('PatientsService.findAll (vista desde el contexto)', () => {
  it('org: filtra por la organizacion, sin consultar Professional', async () => {
    const prisma = makePrisma();
    await new PatientsService(prisma).findAll(filter, ORG_VIEW, {
      includeCurrentOrg: true,
    });
    expect(prisma.patient.findMany.mock.calls[0][0].where.organizationId).toBe(
      ORG,
    );
    expect(prisma.professional.findMany).not.toHaveBeenCalled();
  });

  const proWhere = async (includeCurrentOrg: boolean) => {
    const prisma = makePrisma();
    await new PatientsService(prisma).findAll(filter, proView(ME), {
      includeCurrentOrg,
    });
    expect(prisma.professional.findMany).not.toHaveBeenCalled();
    return prisma.patient.findMany.mock.calls[0][0].where;
  };

  it('pro con includeCurrentOrg: atendidos + toda la organizacion + practicas propias', async () => {
    const where = await proWhere(true);
    expect(where.organizationId).toBeUndefined();
    expect(where.AND[0].OR).toEqual([
      {
        workItems: {
          some: {
            OR: [
              { professionalId: { in: [ME] } },
              { participants: { some: { professionalId: { in: [ME] } } } },
            ],
          },
        },
      },
      { organizationId: ORG },
      { organizationId: { in: [SOLO] } },
    ]);
  });

  it('pro sin includeCurrentOrg: solo atendidos y practicas propias, sin la organizacion de la URL', async () => {
    const where = await proWhere(false);
    const ors = where.AND[0].OR;
    expect(ors).toHaveLength(2);
    expect(JSON.stringify(ors)).not.toContain(`"organizationId":"${ORG}"`);
  });

  it('pro sin Professional: vacio sin consultar pacientes', async () => {
    const prisma = makePrisma();
    const res = await new PatientsService(prisma).findAll(filter, proView(), {
      includeCurrentOrg: true,
    });
    expect(res).toEqual({ items: [], total: 0 });
    expect(prisma.patient.findMany).not.toHaveBeenCalled();
  });
});

describe('PatientsService.findAll: BAJA-3 y deuda acotada (MEDIA-1)', () => {
  const OTHER = 'pro-other';
  const members = (...rows: Array<[string, string, string]>) =>
    rows.map(([organizationId, role, type]) => ({
      organizationId,
      role,
      organization: { type },
    }));

  it('BAJA-3: practica propia como MEMBER no entra en el filtro de pacientes', async () => {
    const prisma = makePrisma();
    prisma.organizationMember.findMany.mockResolvedValue(
      members([SOLO, 'MEMBER', 'SOLO_PRACTICE'], ['org-clinic', 'ADMIN', 'CLINIC']),
    );
    await new PatientsService(prisma).findAll(filter, proView(ME), {
      includeCurrentOrg: false,
    });
    const ors = prisma.patient.findMany.mock.calls[0][0].where.AND[0].OR;
    expect(ors).toHaveLength(1);
    expect(JSON.stringify(ors)).not.toContain(SOLO);
    expect(JSON.stringify(ors)).not.toContain('org-clinic');
  });

  it('BAJA-3: practica propia como ADMIN si entra', async () => {
    const prisma = makePrisma();
    await new PatientsService(prisma).findAll(filter, proView(ME), {
      includeCurrentOrg: false,
    });
    const ors = prisma.patient.findMany.mock.calls[0][0].where.AND[0].OR;
    expect(ors).toContainEqual({ organizationId: { in: [SOLO] } });
  });

  const run = async (memberOf: string[]) => {
    const prisma = makePrisma();
    prisma.organizationMember.findMany.mockResolvedValue(
      memberOf.map((o) => ({
        organizationId: o,
        role: 'MEMBER',
        organization: { type: 'CLINIC' },
      })),
    );
    // paciente de ORG atendido por ME y por OTHER
    const patient = { id: 'p1', organizationId: ORG, firstName: 'A', lastName: 'B' };
    prisma.patient.findMany
      .mockResolvedValueOnce([patient])
      .mockResolvedValueOnce([]);
    await new PatientsService(prisma).findAll(filter, proView(ME), {
      includeCurrentOrg: true,
    });
    return prisma;
  };

  it('sin membresia en la organizacion del paciente: deuda y ultima visita solo de sus Professional', async () => {
    const prisma = await run([]);
    const own = {
      OR: [
        { professionalId: { in: [ME] } },
        { participants: { some: { professionalId: { in: [ME] } } } },
      ],
    };
    expect(prisma.workItem.findMany.mock.calls[0][0].where).toEqual({
      patientId: 'p1',
      paymentStatus: { not: 'PAID' },
      ...own,
    });
    expect(prisma.workItem.findFirst.mock.calls[0][0].where).toEqual({
      patientId: 'p1',
      ...own,
    });
    expect(JSON.stringify(prisma.workItem.findMany.mock.calls)).not.toContain(
      OTHER,
    );
  });

  it('con membresia en la organizacion del paciente: deuda completa, como antes', async () => {
    const prisma = await run([ORG]);
    expect(prisma.workItem.findMany.mock.calls[0][0].where).toEqual({
      patientId: 'p1',
      paymentStatus: { not: 'PAID' },
    });
    expect(prisma.workItem.findFirst.mock.calls[0][0].where).toEqual({
      patientId: 'p1',
    });
  });

  it('getDebt con professionalIds acota; sin ellos, no', async () => {
    const prisma = makePrisma();
    prisma.workItem.findMany.mockResolvedValue([
      { grossAmount: '10.5' },
      { grossAmount: 4 },
    ]);
    const svc = new PatientsService(prisma);
    await expect(svc.getDebt('p1', [ME])).resolves.toBe(14.5);
    expect(prisma.workItem.findMany.mock.calls[0][0].where.OR).toBeDefined();
    await svc.getDebt('p1');
    expect(prisma.workItem.findMany.mock.calls[1][0].where.OR).toBeUndefined();
  });
});
