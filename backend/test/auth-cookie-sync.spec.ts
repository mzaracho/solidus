/**
 * Sincronía front/back (018): el nombre de la cookie de sesión y el header CSRF viven en dos lugares
 * (backend: auth-cookie-config.ts; frontend: lib/session.ts). Si divergen, el login entra en bucle o todas las
 * escrituras dan 403. Se compara el texto del archivo del front, igual que el fixture de bodies.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  AUTH_COOKIE_NAME,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
} from '@src/infrastructure.bootstrap/config/app/auth-cookie-config';

const frontendSession = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'session.ts'),
  'utf8',
);

const constant = (name: string): string => {
  const match = new RegExp(`export const ${name} = '([^']+)'`).exec(
    frontendSession,
  );
  if (!match) throw new Error(`frontend session.ts no define ${name}`);
  return match[1];
};

describe('coincidencia front/back de la cookie de sesión (018)', () => {
  it('el nombre de la cookie es el mismo', () => {
    expect(constant('AUTH_COOKIE_NAME')).toBe(AUTH_COOKIE_NAME);
  });

  it('el header CSRF y su valor son los mismos', () => {
    expect(constant('CSRF_HEADER_NAME')).toBe(CSRF_HEADER);
    expect(constant('CSRF_HEADER_VALUE')).toBe(CSRF_HEADER_VALUE);
  });

  it('la cookie vieja del front no es la nueva', () => {
    expect(constant('LEGACY_AUTH_COOKIE_NAME')).toBe('auth_token');
    expect(constant('LEGACY_AUTH_COOKIE_NAME')).not.toBe(AUTH_COOKIE_NAME);
  });
});
