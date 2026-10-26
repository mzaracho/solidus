export class Patient {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
  debt: number;
  lastVisit: Date | null;

  constructor(partial: Partial<Patient>) {
    Object.assign(this, partial);
  }

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }
}
