/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import {
  CalculateSettlementsQuery,
  CalculateSettlementsQueryHandler,
} from './queries/calculate-settlements-query';

const makePrisma = () =>
  ({
    organization: { findUnique: jest.fn().mockResolvedValue(null) },
    workItem: { findMany: jest.fn().mockResolvedValue([]) },
    professionalCategory: { findMany: jest.fn().mockResolvedValue([]) },
  }) as any;

const queryOf = (organizationId: unknown) =>
  Object.assign(new CalculateSettlementsQuery(), {
    month: '2026-01',
    organizationId,
  });

describe('CalculateSettlementsQueryHandler', () => {
  it.each([undefined, null, '', '   ', 5])(
    'organizacion vacia (%p): 403 sin consultas',
    async (org) => {
      const prisma = makePrisma();
      const handler = new CalculateSettlementsQueryHandler(prisma);
      await expect(handler.execute(queryOf(org))).rejects.toMatchObject({
        status: 403,
      });
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.workItem.findMany).not.toHaveBeenCalled();
      expect(prisma.professionalCategory.findMany).not.toHaveBeenCalled();
    },
  );

  it('usa la organizacion que asigno el controlador en todas las consultas', async () => {
    const prisma = makePrisma();
    const handler = new CalculateSettlementsQueryHandler(prisma);
    await expect(handler.execute(queryOf('org-1'))).resolves.toEqual([]);
    expect(prisma.organization.findUnique.mock.calls[0][0].where).toEqual({
      id: 'org-1',
    });
    expect(prisma.workItem.findMany.mock.calls[0][0].where.organizationId).toBe(
      'org-1',
    );
    expect(
      prisma.professionalCategory.findMany.mock.calls[0][0].where
        .organizationId,
    ).toBe('org-1');
  });
});
