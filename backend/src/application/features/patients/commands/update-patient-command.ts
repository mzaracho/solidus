import { ApiProperty } from '@nestjs/swagger';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { PatientResponseDto } from '../dtos/patient-response.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { IPatientService } from '@src/domain/features/patients/service/i-patient-service';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { requireOrgScope, RequestContext } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { foundOr404, inScope, requireId } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

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

@RequestHandler(UpdatePatientCommand)
@Injectable()
export class UpdatePatientCommandHandler implements IRequestHandler<
  UpdatePatientCommand,
  PatientResponseDto
> {
  constructor(
    @Inject(IPatientService) private readonly patientService: IPatientService,
    private readonly prisma: PrismaService,
  ) { }

  async execute(
    command: UpdatePatientCommand,
    ctx: RequestContext,
  ): Promise<PatientResponseDto> {
    const scope = requireOrgScope(ctx);
    const id = requireId(command.id);
    await foundOr404(
      this.prisma.patient.findFirst({
        where: { id, ...inScope(scope) },
        select: { id: true },
      }),
    );
    const patient = await this.patientService.update(id, command);
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
