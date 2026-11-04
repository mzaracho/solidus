import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { WorkItem, AttendanceStatus, PaymentStatus } from '@prisma/client';
import { requireOrgScope, RequestContext } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { foundOr404, forbiddenAction, inScope, requireId } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';
import { canModifyActivity } from '../activity-ownership';

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsOptionalDateString } from '@src/infrastructure.bootstrap/config/core/validation/dto-validators';

export class UpdateActivityCommand implements IRequest<WorkItem> {
  /** Lo asigna el controlador desde el path; el cliente no lo manda (400). */
  declare id: string;

  @ApiPropertyOptional()
  @IsOptionalDateString()
  date?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptionalDateString()
  paymentDate?: string;

  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  attendance?: AttendanceStatus;
}

@RequestHandler(UpdateActivityCommand)
@Injectable()
export class UpdateActivityCommandHandler implements IRequestHandler<
  UpdateActivityCommand,
  WorkItem
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(
    command: UpdateActivityCommand,
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
          professional: { select: { userId: true } },
        },
      }),
    );
    if (!canModifyActivity(existing, scope, 'edit')) throw forbiddenAction();

    const data: any = {};

    if (command.date) data.occurredAt = new Date(command.date);
    if (command.paymentMethod) data.paymentMethod = command.paymentMethod;
    if (command.paymentDate)
      data.paymentDate = command.paymentDate
        ? new Date(command.paymentDate)
        : null;
    if (command.attendance) data.attendance = command.attendance;

    if (command.paymentStatus) data.paymentStatus = command.paymentStatus;

    return this.prisma.workItem.update({
      where: { id },
      data,
    });
  }
}
