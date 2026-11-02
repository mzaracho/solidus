import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import {
  requireOrgScope,
  RequestContext,
} from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { inOrg } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

export type LookupStaffResult =
  | { type: 'NOT_FOUND' }
  | { type: 'PROFESSIONAL'; id: string; name: string; hasUser: boolean };

/** Busca un profesional por CUIT solo dentro de la organización del request. */
export class LookupStaffByCuitQuery implements IRequest<LookupStaffResult> {
  constructor(public readonly cuit?: string) {}
}

@RequestHandler(LookupStaffByCuitQuery)
@Injectable()
export class LookupStaffByCuitQueryHandler implements IRequestHandler<
  LookupStaffByCuitQuery,
  LookupStaffResult
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: LookupStaffByCuitQuery,
    ctx: RequestContext,
  ): Promise<LookupStaffResult> {
    const scope = requireOrgScope(ctx);
    const cuit = typeof query.cuit === 'string' ? query.cuit.trim() : '';
    if (!cuit) return { type: 'NOT_FOUND' };

    const pro = await this.prisma.professional.findFirst({
      where: { cuit, deletedAt: null, ...inOrg(scope.primaryOrgId) },
      select: { id: true, displayName: true, userId: true },
    });
    if (!pro) return { type: 'NOT_FOUND' };
    return {
      type: 'PROFESSIONAL',
      id: pro.id,
      name: pro.displayName,
      hasUser: !!pro.userId,
    };
  }
}
