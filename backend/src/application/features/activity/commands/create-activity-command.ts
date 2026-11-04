import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { ActivityParticipantDto, CreateActivityDto } from '../Dtos/create-activity.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { requireOrgScope, requireViewScope, RequestContext } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { ActivityService } from '@src/infrastructure/features/activity/activity.service';
import { WorkItem } from '@src/domain/features/activity/WorkItem.entity';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AttendanceStatus, PaymentStatus } from '@prisma/client';
import { MAX_ACTIVITY_PARTICIPANTS } from '@src/domain/constants/app.constants';
import {
  IsEntityId,
  IsMoney,
  IsOptionalDateString,
  IsOptionalEntityId,
} from '@src/infrastructure.bootstrap/config/core/validation/dto-validators';
import { Type } from 'class-transformer';

export class CreateActivityCommand implements IRequest<WorkItem> {
  /** Organización destino (verificada contra el scope en ActivityService). Si falta, la del request. */
  @ApiPropertyOptional()
  @IsOptionalEntityId()
  organizationId: string;

  @ApiProperty()
  @IsDateString({ strict: true })
  date: string;

  @ApiProperty()
  @IsEntityId()
  patientId: string;

  @ApiPropertyOptional()
  @IsOptionalEntityId()
  professionalId?: string;

  @ApiPropertyOptional({ type: [ActivityParticipantDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ACTIVITY_PARTICIPANTS)
  @ValidateNested({ each: true })
  @Type(() => ActivityParticipantDto)
  participants?: ActivityParticipantDto[];

  @ApiPropertyOptional()
  @IsOptionalEntityId()
  activityTypeId?: string;

  @ApiPropertyOptional()
  @IsOptionalEntityId()
  presetId?: string;

  @ApiPropertyOptional()
  @IsOptionalEntityId()
  payerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  serviceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1000)
  hours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  gross?: number; // Alias enviado desde algunos frontends

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  amountBase?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  amountCard?: number;

  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  attendance?: AttendanceStatus;
}

@RequestHandler(CreateActivityCommand)
@Injectable()
export class CreateActivityCommandHandler implements IRequestHandler<
  CreateActivityCommand,
  WorkItem
> {
  constructor(private readonly activityService: ActivityService) { }

  async execute(command: CreateActivityCommand, ctx: RequestContext): Promise<WorkItem> {
    const scope = requireOrgScope(ctx);
    // El modo lo resolvio ViewModeGuard (la preferencia del cliente no decide); un `mode` del body se ignora.
    const { mode } = requireViewScope(ctx);
    const dto: CreateActivityDto = {
      organizationId: command.organizationId,
      date: command.date,
      patientId: command.patientId,
      professionalId: command.professionalId,
      participants: command.participants,
      activityTypeId: command.activityTypeId,
      presetId: command.presetId,
      payerId: command.payerId,
      role: command.role,
      hours: command.hours,
      quantity: command.quantity,
      paymentStatus: command.paymentStatus as 'PAID' | 'PARTIAL' | 'UNPAID' | undefined,
      paymentMethod: command.paymentMethod,
      paymentDate: command.paymentDate,
      amount: command.amount ?? command.gross,
      amountBase: command.amountBase,
      amountCard: command.amountCard,
      attendance: command.attendance,
      serviceType: command.serviceType,
    };
    return this.activityService.createActivity(dto, mode, scope);
  }
}
