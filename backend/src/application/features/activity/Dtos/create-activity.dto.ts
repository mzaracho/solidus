import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { IsEntityId } from '@src/infrastructure.bootstrap/config/core/validation/dto-validators';

export class ActivityParticipantDto {
  @ApiProperty()
  @IsEntityId()
  professionalId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  roleLabel: string;
}

/**
 * Tipo interno que recibe ActivityService.createActivity. NO es el contrato del request: el body se valida en
 * CreateActivityCommand (014). Sin decoradores de class-validator a propósito.
 */
export interface CreateActivityDto {
  date: string; // ISO Date

  organizationId: string;

  patientId: string;

  professionalId?: string;

  participants?: ActivityParticipantDto[];

  activityTypeId?: string;

  serviceType?: string;

  // Optional / Mode dependent
  payerId?: string;

  presetId?: string;

  amount?: number; // For Pro mode

  amountBase?: number;

  amountCard?: number;

  // Status
  paymentStatus?: 'PAID' | 'PARTIAL' | 'UNPAID';

  paymentMethod?: string;

  paymentDate?: string;

  // Org specifics
  role?: string;

  hours?: number;

  quantity?: number;

  attendance?: string;

}
