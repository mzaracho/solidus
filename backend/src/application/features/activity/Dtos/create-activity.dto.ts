import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ActivityParticipantDto {
  @ApiProperty()
  @IsString()
  professionalId: string;

  @ApiProperty()
  @IsString()
  roleLabel: string;
}

export class CreateActivityDto {
  @ApiProperty()
  @IsDateString()
  date: string; // ISO Date

  @ApiProperty()
  @IsString()
  organizationId: string;

  @ApiProperty()
  @IsString()
  patientId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  professionalId: string | undefined;

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
  serviceType?: string;

  // Optional / Mode dependent
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  presetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number; // For Pro mode

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountBase?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountCard?: number;

  // Status
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentStatus?: 'PAID' | 'PARTIAL' | 'UNPAID';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentDate?: string;

  // Org specifics
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  role?: string;

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
  attendance?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mode?: string;
}
