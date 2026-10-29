import { ConfigService } from '@nestjs/config';
import { isString } from '../core/type-guards';

/**
 * Solo loopback: si LISTEN_HOST falta o está vacía el backend NO queda expuesto en la red (falla cerrado).
 * Los JWT no se verifican y el tenant viene de headers del cliente (ver docs/auditoria/RIESGOS.md).
 */
export const DEFAULT_LISTEN_HOST = '127.0.0.1';

/**
 * Interfaz donde escucha el backend (variable LISTEN_HOST). Vacía o ausente: 127.0.0.1.
 * `dev.ps1` la escribe en backend/.env (derivada de BIND_ADDRESS, 127.0.0.1 por defecto) y el compose
 * la fija en 0.0.0.0 de forma explícita para el contenedor (se publica según BIND_ADDRESS).
 */
export function getListenHost(config: ConfigService): string {
  const host = config.get<string>('LISTEN_HOST');
  return isString(host) && host.trim().length > 0
    ? host.trim()
    : DEFAULT_LISTEN_HOST;
}
