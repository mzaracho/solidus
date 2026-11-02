import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@src/infrastructure.bootstrap/config/core/authentication/public-decorator';

/**
 * Ruta pública mínima para esperas de arranque y pruebas de humo (dev.ps1).
 * Fuera del prefijo /api (ver global-prefix-config). No expone versión, entorno ni estado de la base.
 */
@ApiExcludeController()
@Controller('health')
export class HealthController {
  @Public()
  @Get('liveness')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
