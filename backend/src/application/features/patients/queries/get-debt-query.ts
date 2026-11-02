import { Inject, Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IPatientService } from '@src/domain/features/patients/service/i-patient-service';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import {
  requireOrgScope,
  RequestContext,
} from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import {
  foundOr404,
  inScope,
  requireId,
} from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

export class GetDebtQuery implements IRequest<number> {
  @ApiProperty({ description: 'Patient ID', type: String })
  id!: string;

  constructor(id: string) {
    this.id = id;
  }
}

@RequestHandler(GetDebtQuery)
@Injectable()
export class GetDebtQueryHandler implements IRequestHandler<
  GetDebtQuery,
  number
> {
  constructor(
    @Inject(IPatientService) private readonly patientService: IPatientService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(query: GetDebtQuery, ctx: RequestContext): Promise<number> {
    const scope = requireOrgScope(ctx);
    const id = requireId(query.id);
    await foundOr404(
      this.prisma.patient.findFirst({
        where: { id, ...inScope(scope) },
        select: { id: true },
      }),
    );
    return this.patientService.getDebt(id);
  }
}
