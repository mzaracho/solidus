import { Inject, Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IPatientService } from '@src/domain/features/patients/service/i-patient-service';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';

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
  ) {}

  async execute(query: GetDebtQuery): Promise<number> {
    return this.patientService.getDebt(query.id);
  }
}
