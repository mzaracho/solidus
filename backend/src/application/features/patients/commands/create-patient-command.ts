import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { CreatePatientDto } from '../dtos/create-patient.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { IPatientService } from '@src/domain/features/patients/service/i-patient-service';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';

export class CreatePatientCommand implements IRequest<CreatePatientDto> {
  /** La asigna el controlador desde @CurrentOrgId(); el cliente no la manda (400). */
  declare organizationId: string;

  @ApiProperty({ description: 'First name', type: String })
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ description: 'Last name', type: String })
  @IsString()
  @MaxLength(100)
  lastName!: string;

  @ApiPropertyOptional({ description: 'Email', type: String })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ description: 'Phone', type: String })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;
}

@Injectable()
@RequestHandler(CreatePatientCommand)
export class CreatePatientCommandHandler implements IRequestHandler<
  CreatePatientCommand,
  CreatePatientDto
> {
  constructor(private readonly patientService: IPatientService) { }

  async execute(command: CreatePatientCommand): Promise<CreatePatientDto> {
    const patient = await this.patientService.create(command);
    return new CreatePatientDto(
      patient.id,
      patient.organizationId,
      patient.firstName,
      patient.lastName,
      patient.email,
      patient.phone,
    );
  }
}
