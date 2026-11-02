import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import {
  AUTH_ERROR_CODE,
  AuthenticatedRequest,
} from '../config/core/authentication/auth-context';

export const REQUIRED_ORG_ROLE_KEY = 'requiredOrgRole';

/**
 * Decorator to require a minimum OrgRole on a controller or route handler.
 * Use @RequireOrgRole('ADMIN') to restrict to admins only.
 */
export const RequireOrgRole = (role: OrgRole) =>
  SetMetadata(REQUIRED_ORG_ROLE_KEY, role);

/**
 * Guard que valida el rol del usuario autenticado en la organización pedida.
 * El rol sale de la base (OrgAccessGuard), no del `orgRole` del token, que corresponde a la
 * primera membresía. Solo bloquea si hay un rol declarado con @RequireOrgRole().
 */
@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRole = this.reflector.getAllAndOverride<string>(
      REQUIRED_ORG_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No role restriction declared → allow
    if (!requiredRole) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const access = request.orgAccess;

    const forbidden = () =>
      new ForbiddenException({
        code: AUTH_ERROR_CODE.FORBIDDEN,
        message: 'Forbidden',
      });

    if (!access || access.organizationIds.length === 0) throw forbidden();

    // Para cada organización involucrada el usuario debe tener el rol exigido.
    const ok = access.organizationIds.every(
      (orgId) => access.roles[orgId] === requiredRole,
    );
    if (!ok) throw forbidden();

    return true;
  }
}
