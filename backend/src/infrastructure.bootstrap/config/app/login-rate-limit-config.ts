import { ConfigService } from '@nestjs/config';
import { Logger, Provider } from '@nestjs/common';
import {
  LoginRateLimiter,
  LoginRateLimitOptions,
} from '@src/infrastructure/features/auth/services/login-rate-limiter';

export const DEFAULT_LOGIN_RATE_LIMIT_IP = 20;
export const DEFAULT_LOGIN_RATE_LIMIT_USER = 5;
/** Ventana en segundos (15 minutos). */
export const DEFAULT_LOGIN_RATE_LIMIT_WINDOW = 900;

const MAX_IP = 100_000;
const MAX_USER = 10_000;
const MAX_WINDOW_SECONDS = 86_400;

function readInt(
  config: ConfigService,
  name: string,
  fallback: number,
  max: number,
): number {
  const raw: unknown = config.get(name);
  if (raw === undefined || raw === null) return fallback;
  const text =
    typeof raw === 'string' || typeof raw === 'number'
      ? String(raw).trim()
      : '';
  if (typeof raw === 'string' && text === '') return fallback;
  const value = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    // No se imprime el valor recibido.
    throw new Error(
      `${name} must be an integer between 1 and ${max}. Fix it in backend/.env (or the root .env) or remove it to use the default (${fallback}).`,
    );
  }
  return value;
}

/**
 * Lee y valida las variables opcionales del limitador; lanza al arrancar si alguna es inválida.
 *
 * Si LOGIN_RATE_LIMIT_USER > LOGIN_RATE_LIMIT_IP el límite por usuario nunca se alcanza (el de IP corta
 * antes): se emite un warning en vez de rechazar el arranque, porque es una configuración ineficaz pero
 * no insegura ni inválida, y rechazarla tumbaría el servicio por un ajuste de operador. El warning
 * nombra solo estas dos variables, sin valores ni otras variables del entorno.
 */
export function getLoginRateLimitOptions(
  config: ConfigService,
  warn: (message: string) => void = (m) => new Logger('LoginRateLimit').warn(m),
): LoginRateLimitOptions {
  const options = readOptions(config);
  if (options.userLimit > options.ipLimit) {
    warn(
      'LOGIN_RATE_LIMIT_USER is greater than LOGIN_RATE_LIMIT_IP: the per-user limit can never be reached before the per-IP limit. Lower LOGIN_RATE_LIMIT_USER or raise LOGIN_RATE_LIMIT_IP.',
    );
  }
  return options;
}

function readOptions(config: ConfigService): LoginRateLimitOptions {
  return {
    ipLimit: readInt(
      config,
      'LOGIN_RATE_LIMIT_IP',
      DEFAULT_LOGIN_RATE_LIMIT_IP,
      MAX_IP,
    ),
    userLimit: readInt(
      config,
      'LOGIN_RATE_LIMIT_USER',
      DEFAULT_LOGIN_RATE_LIMIT_USER,
      MAX_USER,
    ),
    windowMs:
      readInt(
        config,
        'LOGIN_RATE_LIMIT_WINDOW',
        DEFAULT_LOGIN_RATE_LIMIT_WINDOW,
        MAX_WINDOW_SECONDS,
      ) * 1000,
  };
}

export const LoginRateLimiterProvider: Provider = {
  provide: LoginRateLimiter,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new LoginRateLimiter(getLoginRateLimitOptions(config)),
};
