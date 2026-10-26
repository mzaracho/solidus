import { ApiProperty } from '@nestjs/swagger';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { PatientResponseDto } from '../dtos/patient-response.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { IPatientService } from '@src/domain/features/patients/service/i-patient-service';

export class UpdatePatientCommand implements IRequest<PatientResponseDto> {
  constructor(
    id: string,
    firstName: string,
    lastName: string,
    email?: string,
    phone?: string,
  ) {
    this.id = id;
    this.firstName = firstName;
    this.lastName = lastName;
    this.email = email;
    this.phone = phone;
  }

  @ApiProperty({ description: 'Patient ID', type: String })
  id!: string;

  @ApiProperty({ description: 'First name', type: String })
  firstName!: string;

  @ApiProperty({ description: 'Last name', type: String })
  lastName!: string;

  @ApiProperty({ description: 'Email', type: String })
  email?: string;

  @ApiProperty({ description: 'Phone', type: String })
  phone?: string;
}

export class UpdatePatientCommandHandler implements IRequestHandler<
  UpdatePatientCommand,
  PatientResponseDto
> {
  constructor(private readonly patientService: IPatientService) { }

  async execute(command: UpdatePatientCommand): Promise<PatientResponseDto> {
    const patient = await this.patientService.update(command.id, command);
    return new PatientResponseDto(
      patient.id,
      patient.organizationId,
      patient.firstName,
      patient.lastName,
      patient.email,
      patient.phone || null,
      0,
      null,
    );
  }
}
