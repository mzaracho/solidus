import { SetMetadata } from '@nestjs/common';

export const ORG_OPTIONAL_KEY = 'ORG_OPTIONAL';

/**
 * Por defecto toda ruta autenticada exige una organización válida (OrgAccessGuard).
 * Esta marca la exime de indicarla; si igual la trae, se valida.
 */
export const OrgOptional = () => SetMetadata(ORG_OPTIONAL_KEY, true);
