/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRoleGuard, RequireOrgRole } from './org-role-guard';

class Ctrl {
  free() {
    return 1;
  }
  @RequireOrgRole('ADMIN')
  adminOnly() {
    return 1;
  }
}

const run = (handler: () => unknown, request: Record<string, unknown>) => {
  const context = {
    getHandler: () => handler,
    getClass: () => Ctrl,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return new OrgRoleGuard(new Reflector()).canActivate(context);
};

describe('OrgRoleGuard', () => {
  const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const orgB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const expectForbidden = (fn: () => unknown) => {
    let error: any;
    try {
      fn();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toEqual({
      code: 'forbidden',
      message: 'Forbidden',
    });
  };

  it('sin @RequireOrgRole pasa', () => {
    expect(run(Ctrl.prototype.free, {})).toBe(true);
  });

  it('ADMIN en la organización pedida pasa', () => {
    const request = {
      orgAccess: { organizationIds: [orgA], roles: { [orgA]: 'ADMIN' } },
    };
    expect(run(Ctrl.prototype.adminOnly, request)).toBe(true);
  });

  it('MEMBER da 403 forbidden', () => {
    const request = {
      orgAccess: { organizationIds: [orgA], roles: { [orgA]: 'MEMBER' } },
    };
    expectForbidden(() => run(Ctrl.prototype.adminOnly, request));
  });

  it('vínculo solo de Professional (rol null) da 403', () => {
    const request = {
      orgAccess: { organizationIds: [orgA], roles: { [orgA]: null } },
    };
    expectForbidden(() => run(Ctrl.prototype.adminOnly, request));
  });

  it('dos organizaciones con ADMIN en una sola da 403', () => {
    const request = {
      orgAccess: {
        organizationIds: [orgA, orgB],
        roles: { [orgA]: 'ADMIN', [orgB]: 'MEMBER' },
      },
    };
    expectForbidden(() => run(Ctrl.prototype.adminOnly, request));
  });

  it('sin orgAccess da 403', () => {
    expectForbidden(() => run(Ctrl.prototype.adminOnly, {}));
    expectForbidden(() =>
      run(Ctrl.prototype.adminOnly, {
        orgAccess: { organizationIds: [], roles: {} },
      }),
    );
  });

  it('un orgRole ADMIN en los claims del token no alcanza', () => {
    const request = {
      auth: { userId: 'u', claims: { orgRole: 'ADMIN' } },
      orgAccess: { organizationIds: [orgA], roles: { [orgA]: 'MEMBER' } },
    };
    expectForbidden(() => run(Ctrl.prototype.adminOnly, request));
  });
});
