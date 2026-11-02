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
