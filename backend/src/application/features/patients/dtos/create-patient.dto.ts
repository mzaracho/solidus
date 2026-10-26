export class CreatePatientDto {
  constructor(
    public id: string,
    public organizationId: string,
    public firstName: string,
    public lastName: string,
    public email?: string | undefined | null,
    public phone?: string | undefined | null,
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.firstName = firstName;
    this.lastName = lastName;
    this.email = email;
    this.phone = phone;
  }
}
