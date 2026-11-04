/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { OrgAccessService } from './org-access.service';

describe('OrgAccessService (consultas del 009)', () => {
  it('getActiveProfessionals: where exacto y select minimo', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'p1', organizationId: 'o1', canLoadActivities: true },
      { id: 'p2', organizationId: 'o2', canLoadActivities: false },
    ]);
    const service = new OrgAccessService({ professional: { findMany } } as any);
    const res = await service.getActiveProfessionals('u1');
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        status: 'ACTIVE',
        deletedAt: null,
        user: { deletedAt: null },
      },
      select: { id: true, organizationId: true, canLoadActivities: true },
    });
    expect(res).toEqual([
      { id: 'p1', organizationId: 'o1', canLoadActivities: true },
      { id: 'p2', organizationId: 'o2', canLoadActivities: false },
    ]);
  });

  it('getOrgType: lectura por PK solo del tipo; null si no existe', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ type: 'SOLO_PRACTICE' })
      .mockResolvedValueOnce(null);
    const service = new OrgAccessService({
      organization: { findUnique },
    } as any);
    expect(await service.getOrgType('o1')).toBe('SOLO_PRACTICE');
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'o1' },
      select: { type: true },
    });
    expect(await service.getOrgType('o2')).toBeNull();
  });
});
