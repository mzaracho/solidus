import { Patient } from '../Patient.entity';
import { FindAllPatientsFilter } from '../find-all-patients-filter';
import { CreatePatientRequest } from '../create-patient-request';

export abstract class IPatientService {
  abstract findAll(query: FindAllPatientsFilter): Promise<{ items: Patient[]; total: number }>;
  abstract getDebt(id: string): Promise<number>;
  abstract create(command: CreatePatientRequest): Promise<Patient>;
  abstract update(id: string, command: Partial<CreatePatientRequest>): Promise<Patient>;
}
