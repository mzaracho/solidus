import { Request } from 'express';

/** Claims que firma el login. `sub` es el id del usuario (UUID). */
export interface JwtPayload {
  sub: string;
  exp: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  name?: string;
  email?: string;
  roles?: { code: string; name: string }[];
  orgRole?: string | null;
  organizationId?: string | null;
  professionalId?: string | null;
}

export type OrgRoleValue = 'ADMIN' | 'MEMBER';

export interface AuthContext {
  userId: string;
  claims: JwtPayload;
}

/** Resultado de la validación de pertenencia (OrgAccessGuard). */
export interface OrgAccessContext {
  organizationIds: string[];
  /** Rol de membresía por organización; null si el vínculo es solo de Professional. */
  roles: Record<string, OrgRoleValue | null>;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
  orgAccess?: OrgAccessContext;
}

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const AUTH_ERROR_CODE = {
  UNAUTHORIZED: 'unauthorized',
  ORG_ACCESS_DENIED: 'org-access-denied',
  FORBIDDEN: 'forbidden',
} as const;
