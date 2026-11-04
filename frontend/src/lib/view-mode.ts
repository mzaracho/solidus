// Que vistas (Organizacion / Profesional) ofrece la interfaz. Solo presentacion: el backend es la autoridad
// y responde 403 si la vista pedida no corresponde a los vinculos del usuario (feature 009).
import { APP_ROLE_CODE, VIEW_MODE } from './constants.ts'

export type ViewModeValue = (typeof VIEW_MODE)[keyof typeof VIEW_MODE]

export type ViewModeInput = {
  /** Rol de la (primera) membresia, del token. null/undefined si no tiene ninguna. */
  orgRole?: string | null
  /** Codigos de rol global del usuario (`roles` del token). */
  roles?: ReadonlyArray<{ code: string }> | null
  /** Id del Professional del usuario, si el token lo trae. */
  professionalId?: string | null
}

/**
 * Vistas permitidas:
 * - ORGANIZATION: si tiene alguna membresia (ADMIN o MEMBER).
 * - PROFESSIONAL: si tiene el codigo de rol PROFESSIONAL o un Professional.
 */
export function allowedViewModes(input: ViewModeInput): ViewModeValue[] {
  const modes: ViewModeValue[] = []
  if (input.orgRole === 'ADMIN' || input.orgRole === 'MEMBER') modes.push(VIEW_MODE.ORGANIZATION)
  const hasProRole = (input.roles ?? []).some((r) => r.code === APP_ROLE_CODE.PROFESSIONAL)
  if (hasProRole || !!input.professionalId) modes.push(VIEW_MODE.PROFESSIONAL)
  return modes
}

/** Mantiene la vista actual si esta permitida; si no, la primera permitida. Sin permitidas, la actual (decide el backend). */
export function pickViewMode(current: ViewModeValue, allowed: readonly ViewModeValue[]): ViewModeValue {
  if (allowed.length === 0) return current
  return allowed.includes(current) ? current : allowed[0]
}

/** Enlaces "restricted" (financieros de la organizacion): solo ADMIN. */
export function canSeeRestrictedLinks(orgRole: string | null | undefined): boolean {
  return orgRole === 'ADMIN'
}
