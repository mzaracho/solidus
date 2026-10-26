export interface CreatePatientRequest {
  organizationId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}
