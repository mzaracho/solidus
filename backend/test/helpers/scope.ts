/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import {
  buildRequestContext,
  RequestContext,
} from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';

type Role = 'ADMIN' | 'MEMBER' | null;

/** Contexto de request para llamar a un handler directamente (sin HTTP). */
export function makeCtx(opts: {
  userId?: string;
  roles: Record<string, Role>;
  primaryOrgId?: string;
  /** Vista efectiva (lo que dejaria ViewModeGuard); sin esto, ctx.view es null. */
  view?: {
    mode: 'org' | 'pro';
    professionals?: Array<{
      id: string;
      organizationId: string;
      canLoadActivities?: boolean;
    }>;
  };
}): RequestContext {
  const orgIds = Object.keys(opts.roles);
  const userId = opts.userId ?? randomUUID();
  return buildRequestContext({
    auth: { userId },
    orgAccess: {
      organizationIds: orgIds,
      primaryOrgId: opts.primaryOrgId ?? orgIds[0],
      roles: opts.roles,
    },
    viewAccess: opts.view
      ? {
          mode: opts.view.mode,
          requested: opts.view.mode,
          professionals: (opts.view.professionals ?? []).map((p) => ({
            canLoadActivities: false,
            ...p,
          })),
        }
      : undefined,
  } as any);
}

/** Devuelve la excepción lanzada por fn (o undefined si no lanzó). */
export async function errorOf(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

export const NOT_FOUND_BODY = { code: 'not-found', message: 'Not Found' };
export const FORBIDDEN_BODY = { code: 'forbidden', message: 'Forbidden' };
