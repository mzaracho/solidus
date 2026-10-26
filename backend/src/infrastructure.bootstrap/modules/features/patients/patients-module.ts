import { Module } from '@nestjs/common';

import { PatientsController } from '@src/api/controllers/v1/patients/patients-controller';
import { PrismaModule } from '../prisma/prisma-module';

import { PatientsService } from '@src/infrastructure/features/patients/patients.service';
import { DispatcherProvider } from '@src/infrastructure.bootstrap/config/core/cqrs/dispatcher-provider';
import {
  FindAllPatientsQuery,
  FindAllPatientsQueryHandler,
} from '@src/application/features/patients/queries/find-all-patients-query';
import {
  GetDebtQuery,
  GetDebtQueryHandler,
} from '@src/application/features/patients/queries/get-debt-query';
import { GetPatientSummaryQueryHandler } from '@src/application/features/patients/queries/get-patient-summary-query';
import { IPatientService } from '@src/domain/features/patients/service/i-patient-service';
import { CreatePatientCommandHandler } from '@src/application/features/patients/commands/create-patient-command';
import { UpdatePatientCommandHandler } from '@src/application/features/patients/commands/update-patient-command';
import { MergePatientCommandHandler } from '@src/application/features/patients/commands/merge-patient-command';

@Module({
  imports: [PrismaModule],
  controllers: [PatientsController],
  providers: [
    PatientsService,
    {
      provide: IPatientService,
      useClass: PatientsService,
    },
    FindAllPatientsQueryHandler,
    GetDebtQueryHandler,
    GetPatientSummaryQueryHandler,
    CreatePatientCommandHandler,
    UpdatePatientCommandHandler,
    MergePatientCommandHandler,
    DispatcherProvider,
  ],

  exports: [IPatientService],
})
export class PatientsModule {}
