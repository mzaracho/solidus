import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { OrgRole } from '@prisma/client';

export const REQUIRED_ORG_ROLE_KEY = 'requiredOrgRole';

/**
 * Decorator to require a minimum OrgRole on a controller or route handler.
 * Use @RequireOrgRole('ADMIN') to restrict to admins only.
 */
export const RequireOrgRole = (role: OrgRole) =>
  SetMetadata(REQUIRED_ORG_ROLE_KEY, role);

/**
 * Guard that validates the authenticated user's OrgRole from the JWT payload.
 * Only blocks access if a required role is declared via @RequireOrgRole().
 */
@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRole = this.reflector.getAllAndOverride<string>(
      REQUIRED_ORG_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No role restriction declared → allow
    if (!requiredRole) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ForbiddenException('Authentication required.');
    }

    const token = authHeader.split(' ')[1];
    let payload: any;

    try {
      payload = this.jwtService.decode(token);
    } catch {
      throw new ForbiddenException('Invalid token.');
    }

    const orgRole: string | null = payload?.orgRole ?? null;

    if (requiredRole === OrgRole.ADMIN && orgRole !== OrgRole.ADMIN) {
      throw new ForbiddenException(
        'Solo los administradores pueden realizar esta acción.',
      );
    }

    return true;
  }
}
