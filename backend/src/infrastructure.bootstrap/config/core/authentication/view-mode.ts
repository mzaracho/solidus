import { BadRequestException } from '@nestjs/common';
import { USER_MODE } from '@src/domain/constants/app.constants';
import { AUTH_ERROR_CODE, OrgRoleValue, ViewModeValue } from './auth-context';

/**
 * Lógica pura del modo efectivo (009). El cliente solo expresa una preferencia (header x-mode o
 * query ?mode=); el servidor la contrasta con los vínculos de la base. Ver ViewModeGuard.
 */

const invalidMode = () =>
  new BadRequestException({
    code: AUTH_ERROR_CODE.INVALID_MODE,
    message: 'Bad Request',
  });

const isAbsent = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '');

const ORG_VALUES: readonly string[] = [
  USER_MODE.ORG,
  USER_MODE.ORGANIZATION,
].map((v) => v.toLowerCase());
const PRO_VALUES: readonly string[] = [
  USER_MODE.PRO,
  USER_MODE.PROFESSIONAL,
].map((v) => v.toLowerCase());

function normalize(value: unknown): ViewModeValue | null {
  if (isAbsent(value)) return null;
  // Header o query repetidos llegan como arreglo; cualquier cosa que no sea string es inválida.
  if (typeof value !== 'string') throw invalidMode();
  const v = value.trim().toLowerCase();
  if (ORG_VALUES.includes(v)) return 'org';
  if (PRO_VALUES.includes(v)) return 'pro';
  throw invalidMode();
}

/**
 * Normaliza la preferencia pedida. Ausente (undefined, null, vacío) -> null. Valor desconocido, no string,
 * o header y query con valores distintos -> 400 invalid-mode (falla cerrado).
 */
export function parseRequestedMode(
  header: unknown,
  query: unknown,
): ViewModeValue | null {
  const fromHeader = normalize(header);
  const fromQuery = normalize(query);
  if (fromHeader && fromQuery && fromHeader !== fromQuery) throw invalidMode();
  return fromHeader ?? fromQuery;
}

/** Vínculos del usuario con la organización principal X (y sus Professional, en cualquier organización). */
export interface ViewLinks {
  /** Rol de membresía en X; null si no es miembro. */
  role: OrgRoleValue | null;
  /** Tiene al menos un Professional activo, en cualquier organización. */
  hasProfessional: boolean;
  /** ADMIN de una práctica SOLO_PRACTICE (todavía puede no tener su Professional: se crea en la primera carga pro). */
  soloPracticeAdmin: boolean;
}

export interface ViewModeOptions {
  /** Rol exigido para la vista org de la ruta. */
  orgRole?: OrgRoleValue;
}

export const canViewOrg = (
  links: Pick<ViewLinks, 'role'>,
  options: ViewModeOptions = {},
): boolean =>
  links.role !== null &&
  (options.orgRole === undefined || links.role === options.orgRole);

export const canViewPro = (links: ViewLinks): boolean =>
  links.hasProfessional || links.soloPracticeAdmin;

/**
 * Modo efectivo. null = no corresponde ninguno (el guard responde 403). Sin degradación: si se pide un
 * modo que los vínculos no permiten, null.
 */
export function resolveViewMode(
  requested: ViewModeValue | null,
  links: ViewLinks,
  options: ViewModeOptions = {},
): ViewModeValue | null {
  const org = canViewOrg(links, options);
  const pro = canViewPro(links);
  if (requested === 'org') return org ? 'org' : null;
  if (requested === 'pro') return pro ? 'pro' : null;
  if (org) return 'org';
  return pro ? 'pro' : null;
}
