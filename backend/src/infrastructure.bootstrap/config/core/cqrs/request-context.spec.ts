/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  buildRequestContext,
  requireOrgScope,
  roleIn,
} from './request-context';

describe('request-context', () => {
  const userId = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const req: any = {
    auth: { userId },
    orgAccess: {
      organizationIds: [orgA, orgB],
      primaryOrgId: orgA,
      roles: { [orgA]: 'ADMIN', [orgB]: null },
    },
  };

  it('arma el contexto con el scope del request y lo congela', () => {
    const ctx = buildRequestContext(req);
    expect(ctx.userId).toBe(userId);
    expect(ctx.org).toEqual({
      userId,
      primaryOrgId: orgA,
      orgIds: [orgA, orgB],
      roles: { [orgA]: 'ADMIN', [orgB]: null },
    });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.org)).toBe(true);
    expect(Object.isFrozen(ctx.org?.orgIds)).toBe(true);
  });

  it('sin orgAccess el scope es null y requireOrgScope da 403 org-access-denied', () => {
    const ctx = buildRequestContext({ auth: { userId } } as any);
    expect(ctx.org).toBeNull();
    expect(ctx.userId).toBe(userId);
    try {
      requireOrgScope(ctx);
      fail('debía lanzar');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(e.getResponse()).toEqual({
        code: 'org-access-denied',
        message: 'Forbidden',
      });
    }
    expect(() => requireOrgScope(undefined)).toThrow(ForbiddenException);
    expect(buildRequestContext(undefined).userId).toBeNull();
  });

  it('roleIn devuelve el rol o null', () => {
    const scope = requireOrgScope(buildRequestContext(req));
    expect(roleIn(scope, orgA)).toBe('ADMIN');
    expect(roleIn(scope, orgB)).toBeNull();
    expect(roleIn(scope, randomUUID())).toBeNull();
  });
});
