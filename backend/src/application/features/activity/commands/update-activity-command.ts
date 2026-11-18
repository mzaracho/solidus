import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { WorkItem, AttendanceStatus, PaymentStatus } from '@prisma/client';
import { requireOrgScope, RequestContext } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { ActivityService } from '@src/infrastructure/features/activity/activity.service';

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  IsMoney,
  IsNullableEntityId,
  IsOptionalDateString,
  IsOptionalNotNull,
} from '@src/infrastructure.bootstrap/config/core/validation/dto-validators';

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

  /** Ausente = sin cambio; null = 400. Solo editable mientras la atención no esté cobrada (409 si lo está). */
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @IsMoney()
  grossAmount?: number;

  /**
   * Ausente = sin cambio; null = pagador particular de la organización; UUID = ese pagador (verificado contra la
   * organización de la atención); '' = 400. Solo editable mientras la atención no esté cobrada.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsNullableEntityId()
  payerId?: string | null;
}

@RequestHandler(UpdateActivityCommand)
@Injectable()
export class UpdateActivityCommandHandler implements IRequestHandler<
  UpdateActivityCommand,
  WorkItem
> {
  constructor(private readonly activityService: ActivityService) { }

  async execute(
    command: UpdateActivityCommand,
    ctx: RequestContext,
  ): Promise<WorkItem> {
    const scope = requireOrgScope(ctx);
    return this.activityService.updateActivity(
      {
        id: command.id,
        date: command.date,
        paymentStatus: command.paymentStatus,
        paymentMethod: command.paymentMethod,
        paymentDate: command.paymentDate,
        attendance: command.attendance,
        grossAmount: command.grossAmount,
        payerId: command.payerId,
      },
      scope,
    );
  }
}
