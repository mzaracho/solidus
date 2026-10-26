import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { WorkItem, AttendanceStatus, PaymentStatus } from '@prisma/client';
import { isProfessionalMode } from '@src/domain/constants/app.constants';

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateActivityCommand implements IRequest<WorkItem> {
  id: string; // Will be set from Param

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  attendance?: string;

  // Ownership check fields – populated by the controller from request context
  userId?: string;
  mode?: string;
}

@RequestHandler(UpdateActivityCommand)
@Injectable()
export class UpdateActivityCommandHandler implements IRequestHandler<
  UpdateActivityCommand,
  WorkItem
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: UpdateActivityCommand): Promise<WorkItem> {
    const { id } = command;

    // Ownership guard: a professional can only modify records they created
    if (isProfessionalMode(command.mode) && command.userId) {
      const existing = await this.prisma.workItem.findUnique({ where: { id }, select: { createdByUserId: true } });
      if (existing && existing.createdByUserId && existing.createdByUserId !== command.userId) {
        throw new ForbiddenException('No tienes permiso para modificar esta actividad.');
      }
    }

    const data: any = {};

    if (command.date) data.occurredAt = new Date(command.date);
    if (command.paymentMethod) data.paymentMethod = command.paymentMethod;
    if (command.paymentDate)
      data.paymentDate = command.paymentDate
        ? new Date(command.paymentDate)
        : null;
    if (command.attendance) data.attendance = command.attendance as AttendanceStatus;

    if (command.paymentStatus) data.paymentStatus = command.paymentStatus;

    return this.prisma.workItem.update({
      where: { id },
      data,
    });
  }
}
