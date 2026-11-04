/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { OrgAccessService } from '@src/infrastructure/features/auth/services/org-access.service';
import { UsesViewMode } from '../config/core/authentication/view-mode-decorator';
import { ViewModeGuard } from './view-mode-guard';

class Ctrl {
  free() {
    return 1;
  }
  @UsesViewMode()
  common() {
    return 1;
  }
  @UsesViewMode({ orgRole: 'ADMIN' })
  financial() {
    return 1;
  }
}

describe('ViewModeGuard', () => {
  const userId = randomUUID();
  const orgX = randomUUID();
  const proX = {
    id: randomUUID(),
    organizationId: orgX,
    canLoadActivities: true,
  };
  let getActiveProfessionals: jest.Mock;
  let getOrgType: jest.Mock;
  let guard: ViewModeGuard;

  beforeEach(() => {
    getActiveProfessionals = jest.fn(async () => []);
    getOrgType = jest.fn(async () => 'CLINIC');
    guard = new ViewModeGuard(new Reflector(), {
      getActiveProfessionals,
      getOrgType,
    } as unknown as OrgAccessService);
  });

  const makeContext = (
    handler: () => unknown,
    parts: {
      role?: 'ADMIN' | 'MEMBER' | null;
      headers?: Record<string, unknown>;
      query?: Record<string, unknown>;
      noAccess?: boolean;
    } = {},
  ) => {
    const request: any = {
      headers: parts.headers ?? {},
      query: parts.query ?? {},
      auth: { userId },
      orgAccess: parts.noAccess
        ? undefined
        : {
            organizationIds: [orgX],
            primaryOrgId: orgX,
            roles: { [orgX]: parts.role ?? null },
          },
    };
    const context = {
      getHandler: () => handler,
      getClass: () => Ctrl,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  const errorOf = async (context: ExecutionContext) => {
    try {
      await guard.canActivate(context);
    } catch (e) {
      return e;
    }
    return undefined;
  };

  it('ruta sin metadata: pasa sin consultas y sin viewAccess', async () => {
    const { context, request } = makeContext(Ctrl.prototype.free, {
      role: 'MEMBER',
      headers: { 'x-mode': 'xyz' },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.viewAccess).toBeUndefined();
    expect(getActiveProfessionals).not.toHaveBeenCalled();
    expect(getOrgType).not.toHaveBeenCalled();
  });

  it('miembro en org: sin consultar Professional ni tipo', async () => {
    const { context, request } = makeContext(Ctrl.prototype.common, {
      role: 'MEMBER',
      query: { mode: 'ORGANIZATION' },
    });
    await guard.canActivate(context);
    expect(request.viewAccess).toEqual({
      mode: 'org',
      requested: 'org',
      professionals: [],
    });
    expect(getActiveProfessionals).not.toHaveBeenCalled();
    expect(getOrgType).not.toHaveBeenCalled();
  });

  it('sin pedido y con membresia: org sin consultas', async () => {
    const { context, request } = makeContext(Ctrl.prototype.common, {
      role: 'ADMIN',
    });
    await guard.canActivate(context);
    expect(request.viewAccess.mode).toBe('org');
    expect(request.viewAccess.requested).toBeNull();
    expect(getActiveProfessionals).not.toHaveBeenCalled();
  });

  it('pro: una sola consulta de Professional, con el userId del token', async () => {
    getActiveProfessionals.mockResolvedValue([proX]);
    const { context, request } = makeContext(Ctrl.prototype.common, {
      role: null,
      headers: { 'x-mode': 'pro' },
    });
    await guard.canActivate(context);
    expect(getActiveProfessionals).toHaveBeenCalledTimes(1);
    expect(getActiveProfessionals).toHaveBeenCalledWith(userId);
    expect(getOrgType).not.toHaveBeenCalled();
    expect(request.viewAccess).toEqual({
      mode: 'pro',
      requested: 'pro',
      professionals: [proX],
    });
  });

  it('solo Professional sin pedido: pro', async () => {
    getActiveProfessionals.mockResolvedValue([proX]);
    const { context, request } = makeContext(Ctrl.prototype.common, {
      role: null,
    });
    await guard.canActivate(context);
    expect(request.viewAccess.mode).toBe('pro');
  });

  it('MEMBER + Professional sin pedido en ruta financiera: pro', async () => {
    getActiveProfessionals.mockResolvedValue([proX]);
    const { context, request } = makeContext(Ctrl.prototype.financial, {
      role: 'MEMBER',
    });
    await guard.canActivate(context);
    expect(request.viewAccess.mode).toBe('pro');
    expect(request.viewAccess.professionals).toEqual([proX]);
  });

  it('getOrgType solo en la excepcion SOLO_PRACTICE (ADMIN sin Professional que pide pro)', async () => {
    getOrgType.mockResolvedValue('SOLO_PRACTICE');
    const { context, request } = makeContext(Ctrl.prototype.common, {
      role: 'ADMIN',
      headers: { 'x-mode': 'pro' },
    });
    await guard.canActivate(context);
    expect(getOrgType).toHaveBeenCalledWith(orgX);
    expect(request.viewAccess).toEqual({
      mode: 'pro',
      requested: 'pro',
      professionals: [],
    });
  });

  it('ADMIN de clinica sin Professional que pide pro: 403', async () => {
    const { context, request } = makeContext(Ctrl.prototype.common, {
      role: 'ADMIN',
      headers: { 'x-mode': 'pro' },
    });
    const e = await errorOf(context);
    expect(e.getStatus()).toBe(403);
    expect(e.getResponse()).toEqual({
      code: 'forbidden',
      message: 'Forbidden',
    });
    expect(request.viewAccess).toBeUndefined();
  });

  it('MEMBER sin Professional que pide pro: 403 sin consultar el tipo', async () => {
    const { context } = makeContext(Ctrl.prototype.common, {
      role: 'MEMBER',
      query: { mode: 'PROFESSIONAL' },
    });
    const e = await errorOf(context);
    expect(e.getStatus()).toBe(403);
    expect(getOrgType).not.toHaveBeenCalled();
  });

  it('Professional sin membresia que pide org: 403 sin consultar la base', async () => {
    const { context } = makeContext(Ctrl.prototype.common, {
      role: null,
      query: { mode: 'ORGANIZATION' },
    });
    const e = await errorOf(context);
    expect(e.getStatus()).toBe(403);
    expect(e.getResponse()).toEqual({
      code: 'forbidden',
      message: 'Forbidden',
    });
    expect(getActiveProfessionals).not.toHaveBeenCalled();
  });

  it('orgRole ADMIN con MEMBER en org: 403', async () => {
    const { context } = makeContext(Ctrl.prototype.financial, {
      role: 'MEMBER',
      query: { mode: 'ORGANIZATION' },
    });
    const e = await errorOf(context);
    expect(e.getStatus()).toBe(403);
    expect(e.getResponse()).toEqual({
      code: 'forbidden',
      message: 'Forbidden',
    });
  });

  it('orgRole ADMIN con ADMIN en org: pasa', async () => {
    const { context, request } = makeContext(Ctrl.prototype.financial, {
      role: 'ADMIN',
      query: { mode: 'ORGANIZATION' },
    });
    await guard.canActivate(context);
    expect(request.viewAccess.mode).toBe('org');
  });

  it('sin ningun modo posible: 403', async () => {
    const { context } = makeContext(Ctrl.prototype.common, { role: null });
    const e = await errorOf(context);
    expect(e.getStatus()).toBe(403);
  });

  it.each([
    [{ 'x-mode': 'xyz' }, {}],
    [{}, { mode: ['org', 'pro'] }],
    [{ 'x-mode': 'pro' }, { mode: 'ORGANIZATION' }],
  ])(
    'valor de modo invalido %j %j: 400 invalid-mode sin viewAccess',
    async (headers, query) => {
      const { context, request } = makeContext(Ctrl.prototype.common, {
        role: 'ADMIN',
        headers,
        query,
      });
      const e = await errorOf(context);
      expect(e.getStatus()).toBe(400);
      expect(e.getResponse()).toEqual({
        code: 'invalid-mode',
        message: 'Bad Request',
      });
      expect(request.viewAccess).toBeUndefined();
    },
  );

  it('sin orgAccess: 403 org-access-denied', async () => {
    const { context } = makeContext(Ctrl.prototype.common, { noAccess: true });
    const e = await errorOf(context);
    expect(e.getStatus()).toBe(403);
    expect(e.getResponse()).toEqual({
      code: 'org-access-denied',
      message: 'Forbidden',
    });
  });
});
