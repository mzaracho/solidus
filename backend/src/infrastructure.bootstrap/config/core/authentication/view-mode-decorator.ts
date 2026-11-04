import { SetMetadata } from '@nestjs/common';
import { OrgRoleValue } from './auth-context';

export const VIEW_MODE_KEY = 'USES_VIEW_MODE';

export interface UsesViewModeOptions {
  /** Rol de membresía exigido para la vista de organización (por ejemplo 'ADMIN' en el dashboard). */
  orgRole?: OrgRoleValue;
}

/**
 * Marca una ruta cuyo resultado depende de la vista org/pro. ViewModeGuard resuelve el modo efectivo
 * con los vínculos de la base y lo deja en RequestContext.view; el cliente solo expresa una preferencia.
 */
export const UsesViewMode = (options: UsesViewModeOptions = {}) =>
  SetMetadata(VIEW_MODE_KEY, options);
