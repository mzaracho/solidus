import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgAccessService } from '@src/infrastructure/features/auth/services/org-access.service';
import {
  AUTH_ERROR_CODE,
  AuthenticatedRequest,
  OwnProfessional,
} from '../config/core/authentication/auth-context';
import {
  UsesViewModeOptions,
  VIEW_MODE_KEY,
} from '../config/core/authentication/view-mode-decorator';
import {
  canViewOrg,
  parseRequestedMode,
  resolveViewMode,
} from '../config/core/authentication/view-mode';

const forbidden = (code: string) =>
  new ForbiddenException({ code, message: 'Forbidden' });

/**
 * Guard global (APP_GUARD, después de OrgAccessGuard). Solo actúa en rutas marcadas con @UsesViewMode():
 * lee la preferencia del cliente (header x-mode o query mode) una sola vez, la contrasta con los vínculos
 * de la base (rol de la organización principal y Professional activos) y deja en request.viewAccess el
 * modo efectivo. Si el modo pedido no corresponde: 403 forbidden, sin degradar al otro modo.
 * En el resto de las rutas solo lee metadata: no consulta la base.
 */
@Injectable()
export class ViewModeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly orgAccess: OrgAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<
      UsesViewModeOptions | undefined
    >(VIEW_MODE_KEY, [context.getHandler(), context.getClass()]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.auth?.userId;
    const access = request.orgAccess;
    if (!userId || !access || access.organizationIds.length === 0) {
      throw forbidden(AUTH_ERROR_CODE.ORG_ACCESS_DENIED);
    }

    const requested = parseRequestedMode(
      request.headers?.['x-mode'],
      request.query?.['mode'],
    );
    const orgId = access.primaryOrgId;
    const role = access.roles[orgId] ?? null;

    // Solo se consulta lo necesario: en org no hay consultas nuevas.
    const needsPro =
      requested === 'pro' ||
      (requested === null && !canViewOrg({ role }, options));
    let professionals: OwnProfessional[] = [];
    let soloPracticeAdmin = false;
    if (needsPro) {
      professionals = await this.orgAccess.getActiveProfessionals(userId);
      if (professionals.length === 0 && role === 'ADMIN') {
        soloPracticeAdmin =
          (await this.orgAccess.getOrgType(orgId)) === 'SOLO_PRACTICE';
      }
    }

    const mode = resolveViewMode(
      requested,
      { role, hasProfessional: professionals.length > 0, soloPracticeAdmin },
      options,
    );
    if (!mode) throw forbidden(AUTH_ERROR_CODE.FORBIDDEN);

    request.viewAccess = {
      mode,
      requested,
      professionals: mode === 'pro' ? professionals : [],
    };
    return true;
  }
}
