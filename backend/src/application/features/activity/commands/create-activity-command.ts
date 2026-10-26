import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { ActivityParticipantDto, CreateActivityDto } from '../Dtos/create-activity.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { ActivityService } from '@src/infrastructure/features/activity/activity.service';
import { WorkItem } from '@src/domain/features/activity/WorkItem.entity';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDateString, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateActivityCommand implements IRequest<WorkItem> {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId: string;

  @ApiProperty()
  @IsDateString()
  date: string;

  @ApiProperty()
  @IsString()
  patientId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  professionalId?: string;

  @ApiPropertyOptional({ type: [ActivityParticipantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActivityParticipantDto)
  participants?: ActivityParticipantDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  activityTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  presetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serviceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  hours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentStatus?: string;

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
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  gross?: number; // Alias enviado desde algunos frontends

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountBase?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountCard?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  attendance?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mode?: string;

  userId?: string; // Internal use
}

@RequestHandler(CreateActivityCommand)
@Injectable()
export class CreateActivityCommandHandler implements IRequestHandler<
  CreateActivityCommand,
  WorkItem
> {
  constructor(private readonly activityService: ActivityService) { }

  async execute(command: CreateActivityCommand): Promise<WorkItem> {
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
      userId: command.userId,
      serviceType: command.serviceType,
    };
    return this.activityService.createActivity(dto, command.mode ?? 'org');
  }
}
