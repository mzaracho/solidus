export class ActivityResponseDto {
  id: string;
  date: string;
  patientId: string | null;
  patientName: string;
  professionalId: string;
  presetId: string | null;
  grossAmount: number;
  payerId: string;
  payerName: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  paymentMethod: string | null;
  paymentDate: Date | null;
  attendance: string;
  commission: number;
  payments: number;
  paidAmount: number;
  netAmount: number;
  organizationName: string;
  isExternal: boolean;
  isReadOnly: boolean;
  role: string | null;
}
