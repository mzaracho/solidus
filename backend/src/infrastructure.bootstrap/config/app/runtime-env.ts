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
