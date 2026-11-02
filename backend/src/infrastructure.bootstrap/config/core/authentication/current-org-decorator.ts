import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { AUTH_ERROR_CODE, AuthenticatedRequest } from './auth-context';

/**
 * Organización principal del request: sale de `request.orgAccess.primaryOrgId`, que llena
 * OrgAccessGuard después de verificar la pertenencia del usuario. Nunca se lee del header
 * `x-org-id` ni del query/body directamente. Sin organización validada: 403 org-access-denied.
 */
export const CurrentOrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const orgId = request.orgAccess?.primaryOrgId;
    if (!orgId) {
      throw new ForbiddenException({
        code: AUTH_ERROR_CODE.ORG_ACCESS_DENIED,
        message: 'Forbidden',
      });
    }
    return orgId;
  },
);
