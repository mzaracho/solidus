import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_KEY } from '../config/core/authentication/public-decorator';
import { ORG_OPTIONAL_KEY } from '../config/core/authentication/org-optional-decorator';
import {
  AUTH_ERROR_CODE,
  AuthenticatedRequest,
  OrgAccessContext,
  UUID_REGEX,
} from '../config/core/authentication/auth-context';
import { OrgAccessService } from '@src/infrastructure/features/auth/services/org-access.service';

const denied = () =>
  new ForbiddenException({
    code: AUTH_ERROR_CODE.ORG_ACCESS_DENIED,
    message: 'Forbidden',
  });

const isAbsent = (value: unknown) =>
  value === undefined || value === null || value === '';

/**
 * Guard global (APP_GUARD, después de AuthenticationGuard): si la petición indica una organización
 * (header x-org-id, query organizationId/orgId o body organizationId/orgId), exige que el usuario
 * autenticado tenga vínculo activo con ella (OrganizationMember o Professional ACTIVE).
 * La organización es obligatoria salvo en rutas @Public() o @OrgOptional().
 * Siempre responde el mismo 403, exista o no la organización.
 */
@Injectable()
export class OrgAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly orgAccess: OrgAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) {
      return true;
    }
    const orgOptional = !!this.reflector.getAllAndOverride<boolean>(
      ORG_OPTIONAL_KEY,
      targets,
    );

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.auth?.userId;
    if (!userId) throw denied();

    const body = request.body as Record<string, unknown> | undefined;
    const sources: unknown[] = [
      request.headers?.['x-org-id'],
      request.query?.['organizationId'],
      request.query?.['orgId'],
      body?.['organizationId'],
      body?.['orgId'],
    ];

    const orgIds = new Set<string>();
    for (const value of sources) {
      if (isAbsent(value)) continue;
      if (typeof value !== 'string') throw denied();
      const normalized = value.trim().toLowerCase();
      if (!UUID_REGEX.test(normalized)) throw denied();
      orgIds.add(normalized);
    }

    if (orgIds.size === 0) {
      if (orgOptional) return true;
      throw denied();
    }

    const result: OrgAccessContext = {
      organizationIds: [],
      primaryOrgId: [...orgIds][0],
      roles: {},
    };
    for (const orgId of orgIds) {
      const access = await this.orgAccess.getAccess(userId, orgId);
      if (!access.allowed) throw denied();
      result.organizationIds.push(orgId);
      result.roles[orgId] = access.memberRole;
    }
    request.orgAccess = result;
    return true;
  }
}
