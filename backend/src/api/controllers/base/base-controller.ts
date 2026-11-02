import { ApiBearerAuth } from '@nestjs/swagger';

// La autenticación es global (AuthenticationGuard, APP_GUARD): no hay guard por controlador.
@ApiBearerAuth()
export abstract class BaseController {}
