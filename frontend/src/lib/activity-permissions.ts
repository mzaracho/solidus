// Presentación de permisos sobre una atención. El backend es la autoridad (403 si no corresponde):
// esto solo decide qué botón se muestra habilitado. Política del feature 007 (decisión 1):
// - ADMIN: puede borrar todo.
// - MEMBER: solo borra lo propio (createdByUserId = sub); si createdByUserId es null, solo si es
//   el dueño del Professional de la atención.

export const ROLE_MEMBER = 'MEMBER'

export type DeletableActivity = {
  createdByUserId?: string | null
  professionalId?: string | null
}

export type ActivityIdentity = {
  userId: string | null
  professionalId: string | null
}

export function canDeleteActivity(
  orgRole: string | null | undefined,
  item: DeletableActivity,
  identity: ActivityIdentity,
): boolean {
  if (orgRole !== ROLE_MEMBER) return true
  if (item.createdByUserId) return !!identity.userId && item.createdByUserId === identity.userId
  return !!item.professionalId && item.professionalId === identity.professionalId
}

/**
 * "Cobrada" (017): la definicion la fija el backend (PAID con fecha de pago) y llega ya calculada en `isCollected`.
 * El front no la repite: solo la lee. Si el dato falta, la atencion se trata como no cobrada y el backend (409)
 * decide.
 */
export function isActivityCollected(item: { isCollected?: boolean | null } | null | undefined): boolean {
  return item?.isCollected === true
}
