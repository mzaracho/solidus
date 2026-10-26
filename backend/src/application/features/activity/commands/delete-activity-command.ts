import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { WorkItem, PaymentStatus } from '@prisma/client';
import { isProfessionalMode } from '@src/domain/constants/app.constants';

export class DeleteActivityCommand implements IRequest<WorkItem> {
  constructor(
    public readonly id: string,
    public readonly userId?: string,
    public readonly mode?: string,
  ) {}
}

@RequestHandler(DeleteActivityCommand)
@Injectable()
export class DeleteActivityCommandHandler implements IRequestHandler<
  DeleteActivityCommand,
  WorkItem
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: DeleteActivityCommand): Promise<WorkItem> {
    // Ownership guard: a professional can only delete records they created
    const existing = await this.prisma.workItem.findUnique({
      where: { id: command.id },
      select: { createdByUserId: true, paymentStatus: true, paymentDate: true },
    });

    if (!existing) return null as any; // Or handle as you prefer, prisma delete will fail anyway

    // Financial safeguard: prevent deletion of paid activities with a payment date
    if (existing.paymentStatus === PaymentStatus.PAID && existing.paymentDate) {
      throw new ForbiddenException('No se puede eliminar una actividad ya cobrada con fecha de pago.');
    }

    if (isProfessionalMode(command.mode) && command.userId) {
      if (existing.createdByUserId && existing.createdByUserId !== command.userId) {
        throw new ForbiddenException('No tienes permiso para eliminar esta actividad.');
      }
    }

    return this.prisma.workItem.delete({ where: { id: command.id } });
  }
}
