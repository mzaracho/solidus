import { PaymentStatus, AttendanceStatus } from '@prisma/client';

export class WorkItem {
  id: string;
  organizationId: string;
  payerId: string;
  professionalId: string;
  patientId: string | null;
  serviceType: string;
  activityTypeId: string | null;
  occurredAt: Date;
  grossAmount: number;
  amountBase: number;
  amountCard: number | null;
  attendance: AttendanceStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: string | null;
  paymentDate: Date | null;
  presetId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<WorkItem>) {
    Object.assign(this, partial);
  }

  // Domain Rules
  get isPaid(): boolean {
    return this.paymentStatus === PaymentStatus.PAID;
  }



  markAsPaid(method: string, date: Date = new Date()) {
    this.paymentStatus = PaymentStatus.PAID;
    this.paymentMethod = method;
    this.paymentDate = date;
  }
}
