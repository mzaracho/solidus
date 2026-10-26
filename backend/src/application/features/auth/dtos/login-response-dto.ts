export class LoginResponseDto {
  id: string;
  type: string;
  name: string;
  email: string;
  settings: { theme: string; notifications: boolean };
  roles: { code: string; name: string }[];
  orgRole: string | null;
  cuit?: string;
  professionalId?: string | null;
  token?: string;
}
