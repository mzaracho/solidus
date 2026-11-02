import { ForbiddenException } from '@nestjs/common';
import {
  AUTH_ERROR_CODE,
  AuthenticatedRequest,
  OrgRoleValue,
} from '../authentication/auth-context';

export interface OrgScope {
  readonly userId: string;
  readonly primaryOrgId: string;
  /** Todas las organizaciones validadas por OrgAccessGuard para este request. */
  readonly orgIds: readonly string[];
  /** null = el vínculo en esa organización es solo de Professional. */
  readonly roles: Readonly<Record<string, OrgRoleValue | null>>;
}

export interface RequestContext {
  readonly userId: string | null;
  /** null en rutas @Public o @OrgOptional sin organización. */
  readonly org: OrgScope | null;
}

/** Arma el contexto (inmutable) a partir de lo que dejaron los guards globales. */
export function buildRequestContext(
  req: AuthenticatedRequest | undefined,
): RequestContext {
  const userId = req?.auth?.userId ?? null;
  const access = req?.orgAccess;
  const org: OrgScope | null =
    userId && access && access.organizationIds.length > 0
      ? Object.freeze({
          userId,
          primaryOrgId: access.primaryOrgId,
          orgIds: Object.freeze([...access.organizationIds]),
          roles: Object.freeze({ ...access.roles }),
        })
      : null;
  return Object.freeze({ userId, org });
}

/** Devuelve el scope de organización o 403 org-access-denied si el request no lo tiene. */
export function requireOrgScope(ctx: RequestContext | undefined): OrgScope {
  if (!ctx?.org) {
    throw new ForbiddenException({
      code: AUTH_ERROR_CODE.ORG_ACCESS_DENIED,
      message: 'Forbidden',
    });
  }
  return ctx.org;
}

/**
 * Para handlers y servicios que reciben la organización como dato: falla cerrado (403
 * org-access-denied) si llega vacía o no es un string; nunca se consulta sin filtro de organización.
 */
export function requireOrgId(orgId: unknown): string {
  if (typeof orgId !== 'string' || orgId.trim() === '') {
    throw new ForbiddenException({
      code: AUTH_ERROR_CODE.ORG_ACCESS_DENIED,
      message: 'Forbidden',
    });
  }
  return orgId;
}

export function roleIn(scope: OrgScope, orgId: string): OrgRoleValue | null {
  return scope.roles[orgId] ?? null;
}
