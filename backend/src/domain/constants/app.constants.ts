// src/domain/constants/app.constants.ts

// ─── User Mode ────────────────────────────────────────────────────────────────
// Two values circulate for "professional mode" as a client PREFERENCE (never as a decision):
//   'PROFESSIONAL' — from the frontend store (ViewMode enum), in ?mode=
//   'pro'          — from the x-mode header on POST /activity
// The effective mode is decided by the server (ViewModeGuard + @UsesViewMode, see view-mode.ts) and
// reaches handlers as ctx.view (requireViewScope). Do NOT read the client's mode in handlers or services.
// isProfessionalMode() only normalizes the user's role code at login.

export const USER_MODE = {
  PROFESSIONAL: 'PROFESSIONAL',
  PRO: 'pro',
  ORGANIZATION: 'ORGANIZATION',
  ORG: 'org',
} as const

export type UserMode = typeof USER_MODE[keyof typeof USER_MODE]

/** Returns true for both 'PROFESSIONAL' and 'pro' values (login: role code of the user, not a client input) */
export function isProfessionalMode(mode?: string | null): boolean {
  return mode === USER_MODE.PROFESSIONAL || mode === USER_MODE.PRO
}

// ─── Fee Strategy ─────────────────────────────────────────────────────────────
// Stored as JSON inside ActivityType.roles[].feeStrategy — not a Prisma enum.

export const FEE_STRATEGY = {
  FIXED: 'FIXED',
  CATEGORY: 'CATEGORY',
} as const

export type FeeStrategy = typeof FEE_STRATEGY[keyof typeof FEE_STRATEGY]

// ─── Activity Type Role Limits ────────────────────────────────────────────────

export const MAX_ROLES_PER_ACTIVITY_TYPE = 3

// ─── Pagination Defaults ──────────────────────────────────────────────────────

export const DEFAULT_ACTIVITY_PAGE_SIZE = 20

// ─── Role Codes (from User.userRoles — application-level codes) ──────────────
// These are application role codes stored in the Role table, distinct from
// OrgRole (which is the Prisma enum for org membership roles).

export const ROLE_CODE = {
  PROFESSIONAL: 'PROFESSIONAL',
  ADMIN: 'ADMIN',
} as const

// ─── Validación de requests (014) ─────────────────────────────────────────────

/** Mayor monto representable en una columna Decimal(10,2). */
export const MAX_MONEY_AMOUNT = 99_999_999.99;

/** Tope de `limit` en los listados paginados. */
export const MAX_PAGE_SIZE = 100;

/** Tope de `page` en los listados paginados (evita un `skip` fuera del entero de 32 bits de Prisma). */
export const MAX_PAGE_NUMBER = 10_000;

/** Tope de roles aceptados en el body de un tipo de actividad (el handler luego exige MAX_ROLES_PER_ACTIVITY_TYPE). */
export const MAX_ACTIVITY_TYPE_ROLES_INPUT = 20;

/** Tope de participantes por atención (cada uno es una consulta a la base). */
export const MAX_ACTIVITY_PARTICIPANTS = 10;

export const DASHBOARD_BASIS = {
  ACCRUED: 'ACCRUED',
  CASH: 'CASH',
} as const;

export const DASHBOARD_VALUE_TYPE = {
  NET: 'NET',
  GROSS: 'GROSS',
} as const;

export const CHART_GROUP_BY = {
  DAY: 'day',
  MONTH: 'month',
} as const;
