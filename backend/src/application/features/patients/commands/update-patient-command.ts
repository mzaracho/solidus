import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsOptionalNotNull } from '@src/infrastructure.bootstrap/config/core/validation/dto-validators';
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
  /** Lo asigna el controlador desde el path; el cliente no lo manda (400). */
  declare id: string;

  @ApiPropertyOptional({ description: 'First name', type: String })
  @IsOptionalNotNull()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last name', type: String })
  @IsOptionalNotNull()
  @IsString()
  @MaxLength(100)
  lastName?: string;

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
