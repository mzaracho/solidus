import { ForbiddenException } from '@nestjs/common';
import {
  AUTH_ERROR_CODE,
  AuthenticatedRequest,
  OrgRoleValue,
  OwnProfessional,
  ViewModeValue,
} from '../authentication/auth-context';

export interface OrgScope {
  readonly userId: string;
  readonly primaryOrgId: string;
  /** Todas las organizaciones validadas por OrgAccessGuard para este request. */
  readonly orgIds: readonly string[];
  /** null = el vínculo en esa organización es solo de Professional. */
  readonly roles: Readonly<Record<string, OrgRoleValue | null>>;
}

/** Vista efectiva decidida por ViewModeGuard (solo en rutas con @UsesViewMode). */
export interface ViewScope {
  readonly mode: ViewModeValue;
  /** Preferencia que mandó el cliente; solo informativa. */
  readonly requested: ViewModeValue | null;
  /** Solo en pro: Professional ACTIVE, no eliminados, de cualquier organización, tomados de la base. En org: []. */
  readonly professionals: readonly OwnProfessional[];
}

export interface RequestContext {
  readonly userId: string | null;
  /** null en rutas @Public o @OrgOptional sin organización. */
  readonly org: OrgScope | null;
  /** null en rutas sin @UsesViewMode. */
  readonly view: ViewScope | null;
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
  const v = req?.viewAccess;
  const view: ViewScope | null = v
    ? Object.freeze({
        mode: v.mode,
        requested: v.requested,
        professionals: Object.freeze(
          v.professionals.map((p) => Object.freeze({ ...p })),
        ),
      })
    : null;
  return Object.freeze({ userId, org, view });
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

/** Devuelve la vista efectiva o 403 forbidden si la ruta no pasó por ViewModeGuard (falla cerrado). */
export function requireViewScope(ctx: RequestContext | undefined): ViewScope {
  if (!ctx?.view) {
    throw new ForbiddenException({
      code: AUTH_ERROR_CODE.FORBIDDEN,
      message: 'Forbidden',
    });
  }
  return ctx.view;
}

export const professionalIdsOf = (view: ViewScope): string[] =>
  view.professionals.map((p) => p.id);
