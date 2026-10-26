// src/domain/constants/app.constants.ts

// ─── User Mode ────────────────────────────────────────────────────────────────
// Two values circulate for "professional mode":
//   'PROFESSIONAL' — from the frontend store (ViewMode enum)
//   'pro'          — from x-mode header on pro-specific routes
// Use isProfessionalMode() everywhere instead of duplicating the || check.

export const USER_MODE = {
  PROFESSIONAL: 'PROFESSIONAL',
  PRO: 'pro',
  ORGANIZATION: 'ORGANIZATION',
  ORG: 'org',
} as const

export type UserMode = typeof USER_MODE[keyof typeof USER_MODE]

/** Returns true for both 'PROFESSIONAL' and 'pro' mode values */
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
