import { Patient } from '../Patient.entity';
import { FindAllPatientsFilter } from '../find-all-patients-filter';
import { CreatePatientRequest } from '../create-patient-request';
import { ViewScope } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';

export interface FindAllPatientsOptions {
  /**
   * En vista pro: incluir todos los pacientes de la organizacion de la URL. Solo con membresia o con permiso
   * de carga; si no, el profesional ve solo los pacientes que atendio.
   */
  includeCurrentOrg: boolean;
}

export abstract class IPatientService {
  abstract findAll(
    query: FindAllPatientsFilter,
    view: ViewScope,
    options: FindAllPatientsOptions,
  ): Promise<{ items: Patient[]; total: number }>;
  /** `professionalIds`: si viene, la deuda cuenta solo las atenciones de esos Professional (o donde participan). */
  abstract getDebt(id: string, professionalIds?: string[]): Promise<number>;
  abstract create(command: CreatePatientRequest): Promise<Patient>;
  abstract update(id: string, command: Partial<CreatePatientRequest>): Promise<Patient>;
}
