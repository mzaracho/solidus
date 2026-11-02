import {
  OrgScope,
  roleIn,
} from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';

export type ActivityAction = 'edit' | 'delete';

export interface OwnableActivity {
  organizationId: string;
  createdByUserId: string | null;
  professional: { userId: string | null } | null;
}

/**
 * Política de ownership de una atención (no depende de ningún header del cliente):
 * - ADMIN de la organización de la atención: puede todo.
 * - MEMBER: puede editar y cobrar cualquier atención de la organización; borrar solo las propias
 *   (createdByUserId = sub) o, si createdByUserId es null, las de su Professional.
 * - Solo vínculo de Professional: edita y borra lo que cargó o, si createdByUserId es null,
 *   las atenciones de su Professional.
 */
export function canModifyActivity(
  item: OwnableActivity,
  scope: OrgScope,
  action: ActivityAction,
): boolean {
  const role = roleIn(scope, item.organizationId);
  if (role === 'ADMIN') return true;
  if (role === 'MEMBER' && action === 'edit') return true;
  if (item.createdByUserId !== null) {
    return item.createdByUserId === scope.userId;
  }
  return (
    !!item.professional?.userId && item.professional.userId === scope.userId
  );
}
