import { ConfigService } from '@nestjs/config';
import { isString } from '../core/type-guards';

export type RuntimeEnv = 'development' | 'test' | 'production';

/**
 * Entorno de ejecución. Falla cerrado: solo `development` y `test` (exactos, sin importar
 * mayúsculas ni espacios) se consideran fuera de producción; cualquier otro valor, o su ausencia,
 * se trata como producción.
 */
export function getRuntimeEnv(config: ConfigService): RuntimeEnv {
  const raw = config.get<string>('NODE_ENV');
  const value = isString(raw) ? raw.trim().toLowerCase() : '';
  if (value === 'development' || value === 'test') return value;
  return 'production';
}

export function isProduction(config: ConfigService): boolean {
  return getRuntimeEnv(config) === 'production';
}

/** Swagger solo se monta fuera de producción. */
export function shouldEnableSwagger(config: ConfigService): boolean {
  return getRuntimeEnv(config) !== 'production';
}

/**
 * El backend no arranca con la verificación TLS desactivada (NODE_TLS_REJECT_UNAUTHORIZED=0):
 * afecta a todo el proceso Node. Función pura: recibe el entorno y lanza si el valor es '0'.
 */
export function assertTlsVerificationEnabled(
  env: Record<string, string | undefined> = process.env,
): void {
  const raw = env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (
    typeof raw === 'string' &&
    raw.trim().replace(/^["']|["']$/g, '') === '0'
  ) {
    throw new Error(
      'NODE_TLS_REJECT_UNAUTHORIZED=0 desactiva la verificación TLS de todo el proceso y no está permitido. Quite la variable del entorno y de backend/.env; si un antivirus o proxy inspecciona TLS, use .\\dev.ps1 -ExportCa.',
    );
  }
}
