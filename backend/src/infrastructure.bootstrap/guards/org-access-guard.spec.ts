/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { OrgAccessService } from '@src/infrastructure/features/auth/services/org-access.service';
import { OrgOptional } from '../config/core/authentication/org-optional-decorator';
import { Public } from '../config/core/authentication/public-decorator';
import { OrgAccessGuard } from './org-access-guard';

class Ctrl {
  normal() {
    return 1;
  }
  @OrgOptional()
  optional() {
    return 1;
  }
  @Public()
  open() {
    return 1;
  }
}

const makeContext = (
  handler: () => unknown,
  parts: {
    headers?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
    userId?: string | null;
  },
) => {
  const request: any = {
    headers: parts.headers ?? {},
    query: parts.query ?? {},
    body: parts.body,
    auth: parts.userId === null ? undefined : { userId: parts.userId },
  };
  const context = {
    getHandler: () => handler,
    getClass: () => Ctrl,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
};

describe('OrgAccessGuard', () => {
  const userId = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  let getAccess: jest.Mock;
  let guard: OrgAccessGuard;

  beforeEach(() => {
    getAccess = jest.fn(async (_user: string, org: string) => {
      if (org === orgA) return { allowed: true, memberRole: 'ADMIN' };
      if (org === orgB) return { allowed: true, memberRole: null };
      return { allowed: false, memberRole: null };
    });
    guard = new OrgAccessGuard(new Reflector(), {
      getAccess,
    } as unknown as OrgAccessService);
  });

  const expect403 = async (
    handler: () => unknown,
    parts: Parameters<typeof makeContext>[1],
  ) => {
    const { context } = makeContext(handler, { userId, ...parts });
    let error: any;
    try {
      await guard.canActivate(context);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toEqual({
      code: 'org-access-denied',
      message: 'Forbidden',
    });
  };

  it('miembro: pasa y deja el rol de la membresía', async () => {
    const { context, request } = makeContext(Ctrl.prototype.normal, {
      userId,
      headers: { 'x-org-id': orgA },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.orgAccess).toEqual({
      organizationIds: [orgA],
      roles: { [orgA]: 'ADMIN' },
    });
    expect(getAccess).toHaveBeenCalledWith(userId, orgA);
  });

  it('solo Professional: pasa con rol null', async () => {
    const { context, request } = makeContext(Ctrl.prototype.normal, {
      userId,
      headers: { 'x-org-id': orgB },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.orgAccess.roles[orgB]).toBeNull();
  });

  it('organización ajena: 403 org-access-denied', async () => {
    await expect403(Ctrl.prototype.normal, {
      headers: { 'x-org-id': randomUUID() },
    });
  });

  it('valor que no es UUID ("slug"): 403 sin consultar la base', async () => {
    await expect403(Ctrl.prototype.normal, {
      headers: { 'x-org-id': 'psico-lsa' },
    });
    expect(getAccess).not.toHaveBeenCalled();
  });

  it('UUID en mayúsculas y con espacios se normaliza y pasa', async () => {
    const { context } = makeContext(Ctrl.prototype.normal, {
      userId,
      headers: { 'x-org-id': `  ${orgA.toUpperCase()} ` },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getAccess).toHaveBeenCalledWith(userId, orgA);
  });

  it('header y body distintos: se consultan los dos y si uno falla, 403', async () => {
    const outsider = randomUUID();
    await expect403(Ctrl.prototype.normal, {
      headers: { 'x-org-id': orgA },
      body: { organizationId: outsider },
    });
    expect(getAccess).toHaveBeenCalledWith(userId, orgA);
    expect(getAccess).toHaveBeenCalledWith(userId, outsider);
  });

  it('header y body con vínculo en ambas: pasa con las dos', async () => {
    const { context, request } = makeContext(Ctrl.prototype.normal, {
      userId,
      headers: { 'x-org-id': orgA },
      body: { organizationId: orgB },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.orgAccess.organizationIds).toEqual([orgA, orgB]);
  });

  it('el mismo valor repetido se consulta una sola vez', async () => {
    const { context } = makeContext(Ctrl.prototype.normal, {
      userId,
      headers: { 'x-org-id': orgA },
      query: { organizationId: orgA, orgId: orgA.toUpperCase() },
      body: { organizationId: orgA },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getAccess).toHaveBeenCalledTimes(1);
  });

  it('query organizationId y orgId se validan', async () => {
    await expect403(Ctrl.prototype.normal, {
      headers: { 'x-org-id': orgA },
      query: { organizationId: randomUUID() },
    });
    await expect403(Ctrl.prototype.normal, {
      headers: { 'x-org-id': orgA },
      query: { orgId: randomUUID() },
    });
    await expect403(Ctrl.prototype.normal, {
      headers: { 'x-org-id': orgA },
      body: { orgId: randomUUID() },
    });
  });

  it('fuente que no es string (array u objeto): 403', async () => {
    await expect403(Ctrl.prototype.normal, {
      headers: { 'x-org-id': [orgA, orgA] },
    });
    await expect403(Ctrl.prototype.normal, {
      headers: { 'x-org-id': orgA },
      query: { organizationId: [orgA] },
    });
    await expect403(Ctrl.prototype.normal, {
      headers: { 'x-org-id': orgA },
      body: { organizationId: { id: orgA } },
    });
  });

  it('header repetido ("a, b") no es UUID: 403', async () => {
    await expect403(Ctrl.prototype.normal, {
      headers: { 'x-org-id': `${orgA}, ${orgB}` },
    });
  });

  it('ruta normal sin organización: 403', async () => {
    await expect403(Ctrl.prototype.normal, {});
    await expect403(Ctrl.prototype.normal, {
      headers: { 'x-org-id': '' },
      body: { organizationId: null },
    });
  });

  it('@OrgOptional sin organización pasa; con organización ajena, 403', async () => {
    const { context } = makeContext(Ctrl.prototype.optional, { userId });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect403(Ctrl.prototype.optional, {
      headers: { 'x-org-id': randomUUID() },
    });
  });

  it('@Public no consulta', async () => {
    const { context } = makeContext(Ctrl.prototype.open, { userId: null });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getAccess).not.toHaveBeenCalled();
  });

  it('sin usuario autenticado en el request: 403', async () => {
    await expect403(Ctrl.prototype.normal, {
      userId: null,
      headers: { 'x-org-id': orgA },
    });
  });
});

describe('OrgAccessService', () => {
  const { OrgAccessService: Service } = jest.requireActual(
    '@src/infrastructure/features/auth/services/org-access.service',
  );

  it('consulta Professional solo ACTIVE y no eliminado, y filtra la membresía por usuario', async () => {
    const findFirst = jest.fn().mockResolvedValue({ members: [] });
    const service = new Service({ organization: { findFirst } });
    const userId = randomUUID();
    const orgId = randomUUID();
    const result = await service.getAccess(userId, orgId);
    expect(result).toEqual({ allowed: true, memberRole: null });
    const args = findFirst.mock.calls[0][0];
    expect(args.where.id).toBe(orgId);
    expect(args.where.OR).toEqual([
      { members: { some: { userId } } },
      {
        professionals: {
          some: { userId, deletedAt: null, status: 'ACTIVE' },
        },
      },
    ]);
    expect(args.select.members.where).toEqual({ userId });
  });

  it('devuelve el rol de la membresía y deniega si no hay organización', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ members: [{ role: 'ADMIN' }] })
      .mockResolvedValueOnce(null);
    const service = new Service({ organization: { findFirst } });
    await expect(service.getAccess('u', 'o')).resolves.toEqual({
      allowed: true,
      memberRole: 'ADMIN',
    });
    await expect(service.getAccess('u', 'o')).resolves.toEqual({
      allowed: false,
      memberRole: null,
    });
  });
});
