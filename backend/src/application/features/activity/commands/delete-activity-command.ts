import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { WorkItem, PaymentStatus } from '@prisma/client';
import { requireOrgScope, RequestContext } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { foundOr404, forbiddenAction, inScope, requireId } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';
import { canModifyActivity } from '../activity-ownership';

export class DeleteActivityCommand implements IRequest<WorkItem> {
  constructor(public readonly id: string) {}
}

@RequestHandler(DeleteActivityCommand)
@Injectable()
export class DeleteActivityCommandHandler implements IRequestHandler<
  DeleteActivityCommand,
  WorkItem
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    command: DeleteActivityCommand,
    ctx: RequestContext,
  ): Promise<WorkItem> {
    const scope = requireOrgScope(ctx);
    const id = requireId(command.id);

    const existing = await foundOr404(
      this.prisma.workItem.findFirst({
        where: { id, ...inScope(scope) },
        select: {
          organizationId: true,
          createdByUserId: true,
          paymentStatus: true,
          paymentDate: true,
          professional: { select: { userId: true } },
        },
      }),
    );

    if (!canModifyActivity(existing, scope, 'delete')) throw forbiddenAction();

    // Financial safeguard: prevent deletion of paid activities with a payment date
    if (existing.paymentStatus === PaymentStatus.PAID && existing.paymentDate) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'No se puede eliminar una actividad ya cobrada con fecha de pago.',
      });
    }

    return this.prisma.workItem.delete({ where: { id } });
  }
}
