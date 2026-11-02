import { Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthenticationGuard } from '../../guards/authentication-guard';
import { OrgAccessGuard } from '../../guards/org-access-guard';

// El orden de registro es el de ejecución: primero autenticación, luego pertenencia.
export const AuthenticationGuardProvider: Provider = {
  provide: APP_GUARD,
  useClass: AuthenticationGuard,
};
export const OrgAccessGuardProvider: Provider = {
  provide: APP_GUARD,
  useClass: OrgAccessGuard,
};
