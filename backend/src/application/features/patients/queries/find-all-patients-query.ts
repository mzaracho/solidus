import { Inject, Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiHideProperty } from '@nestjs/swagger';
import { PaginatedArrayDto } from '@src/domain/seed-work/paginated-array';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Transform, Type } from 'class-transformer';
import { IsNumber, IsString, IsOptional } from 'class-validator';
import { PatientResponseDto } from '../dtos/patient-response.dto';
import { IPatientService } from '@src/domain/features/patients/service/i-patient-service';
import {
  RequestContext,
  requireOrgScope,
  requireViewScope,
  roleIn,
} from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';

export class FindAllPatientsQuery implements IRequest<
  PaginatedArrayDto<PatientResponseDto>
> {
  @IsString()
  @IsOptional()
  organizationId!: string;

  @ApiHideProperty()
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Search term', type: String })
  search?: string;

  @ApiProperty({ type: Number })
  @Transform(({ value }) => (value ? Number(value) : 1))
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  page: number = 1;

  @ApiProperty({ type: Number })
  @Transform(({ value }) => (value ? Number(value) : 10))
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  limit: number = 10;
}

@RequestHandler(FindAllPatientsQuery)
@Injectable()
export class FindAllPatientsQueryHandler implements IRequestHandler<
  FindAllPatientsQuery,
  PaginatedArrayDto<PatientResponseDto>
> {
  constructor(
    @Inject(IPatientService) private readonly patientService: IPatientService,
  ) { }

  async execute(
    query: FindAllPatientsQuery,
    ctx: RequestContext,
  ): Promise<PaginatedArrayDto<PatientResponseDto>> {
    const scope = requireOrgScope(ctx);
    const view = requireViewScope(ctx);
    const orgId = query.organizationId;
    // Con membresia, o con permiso de carga en esta organizacion, la vista pro incluye toda la organizacion;
    // un profesional sin ninguna de las dos ve solo los pacientes que atendio.
    const includeCurrentOrg =
      roleIn(scope, orgId) !== null ||
      view.professionals.some(
        (p) => p.organizationId === orgId && p.canLoadActivities,
      );
    const { items, total } = await this.patientService.findAll(query, view, {
      includeCurrentOrg,
    });
    return new PaginatedArrayDto<PatientResponseDto>(
      items.map(
        (patient) =>
          new PatientResponseDto(
            patient.id,
            patient.organizationId,
            patient.firstName,
            patient.lastName,
            patient.email,
            patient.phone || null,
            patient.debt || 0, // Pass calculated debt
            patient.lastVisit || null,
          ),
      ),
      total,
    );
  }
}
