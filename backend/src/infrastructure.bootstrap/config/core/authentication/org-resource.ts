import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AUTH_ERROR_CODE, UUID_REGEX } from './auth-context';
import { OrgScope } from '../cqrs/request-context';

/** 404 genérico e idéntico para "no existe", "es de otra organización" e "id inválido". */
export const resourceNotFound = () =>
  new NotFoundException({
    code: AUTH_ERROR_CODE.NOT_FOUND,
    message: 'Not Found',
  });

/** 403 para rol insuficiente u ownership dentro de la propia organización. */
export const forbiddenAction = () =>
  new ForbiddenException({
    code: AUTH_ERROR_CODE.FORBIDDEN,
    message: 'Forbidden',
  });

/** Id obligatorio: string UUID (trim + minúsculas) o 404 sin consultar la base. */
export function requireId(value: unknown): string {
  if (typeof value !== 'string') throw resourceNotFound();
  const normalized = value.trim().toLowerCase();
  if (!UUID_REGEX.test(normalized)) throw resourceNotFound();
  return normalized;
}

/** Id opcional referenciado: undefined, null o '' -> null; si no, como requireId. */
export function optionalId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireId(value);
}

/** Fragmento de where: el recurso está en alguna organización validada del request. */
export const inScope = (scope: OrgScope) => ({
  organizationId: { in: [...scope.orgIds] },
});

/** Fragmento de where: el recurso está en una organización concreta. */
export const inOrg = (orgId: string) => ({ organizationId: orgId });

/** Espera la consulta y lanza el 404 genérico si devolvió null. */
export async function foundOr404<T>(query: Promise<T | null>): Promise<T> {
  const found = await query;
  if (found === null || found === undefined) throw resourceNotFound();
  return found;
}
