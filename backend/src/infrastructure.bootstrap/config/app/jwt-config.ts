import { ConfigService } from '@nestjs/config';
import {
  JwtModuleAsyncOptions,
  JwtModuleOptions,
  JwtSignOptions,
} from '@nestjs/jwt';
import { isString } from '../core/type-guards';

export const JWT_SECRET_MIN_LENGTH = 32;

/**
 * Devuelve el secreto JWT o falla al arrancar si falta o es demasiado corto.
 * Los mensajes nunca incluyen el valor recibido.
 */
export function getRequiredJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!isString(secret) || secret.trim().length === 0) {
    throw new Error(
      'JWT_SECRET is not defined. Set it in backend/.env (local) or in the root .env (Docker Compose). See .env.example.',
    );
  }
  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters long.`,
    );
  }
  return secret;
}

export function jwtModuleAsyncOptions(
  expiresIn: JwtSignOptions['expiresIn'],
): JwtModuleAsyncOptions {
  return {
    inject: [ConfigService],
    useFactory: (config: ConfigService): JwtModuleOptions => ({
      secret: getRequiredJwtSecret(config),
      signOptions: { expiresIn },
    }),
  };
}
