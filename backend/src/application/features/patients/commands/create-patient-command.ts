import { ApiProperty } from '@nestjs/swagger';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { CreatePatientDto } from '../dtos/create-patient.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { IPatientService } from '@src/domain/features/patients/service/i-patient-service';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';

export class CreatePatientCommand implements IRequest<CreatePatientDto> {
  constructor(
    organizationId: string,
    firstName: string,
    lastName: string,
    email?: string,
    phone?: string,
  ) {
    this.organizationId = organizationId;
    this.firstName = firstName;
    this.lastName = lastName;
    this.email = email;
    this.phone = phone;
  }

  @ApiProperty({ description: 'Organization ID', type: String })
  organizationId!: string;

  @ApiProperty({ description: 'First name', type: String })
  firstName!: string;

  @ApiProperty({ description: 'Last name', type: String })
  lastName!: string;

  @ApiProperty({ description: 'Email', type: String })
  email?: string;

  @ApiProperty({ description: 'Phone', type: String })
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
