import { ApiProperty } from '@nestjs/swagger';
import { IsEntityId } from '@src/infrastructure.bootstrap/config/core/validation/dto-validators';

/** Body de POST v1/patients/:id/merge. El paciente de origen sale del path. */
export class MergePatientRequestDto {
  @ApiProperty({ description: 'Target patient ID (will keep all work items)' })
  @IsEntityId()
  targetId!: string;
}
