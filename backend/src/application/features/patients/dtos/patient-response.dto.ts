export class PatientResponseDto {
  constructor(
    public id: string,
    public organizationId: string,
    public firstName: string,
    public lastName: string,
    public email: string | null,
    public phone: string | null,
    public debt: number,
    public lastVisit: Date | null,
  ) { }
}
