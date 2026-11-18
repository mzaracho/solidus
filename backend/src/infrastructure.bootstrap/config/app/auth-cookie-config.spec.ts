import { ConfigService } from '@nestjs/config';
import {
  AUTH_COOKIE_NAME,
  buildSessionCookieOptions,
  getAllowedOrigins,
  getAuthCookieSecure,
  isAllowedOrigin,
  parseAuthCookieSecure,
  readSessionCookie,
  resolveCookieSecure,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from './auth-cookie-config';
import { JWT_EXPIRES_IN_SECONDS } from './jwt-config';

const cfg = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const JWT = 'aaa.bbb.ccc';

describe('parseAuthCookieSecure', () => {
  it.each([
    ['true', true],
    [' TRUE ', true],
    ['false', false],
    ['False', false],
  ])('%p vale %p', (raw, expected) => {
    expect(parseAuthCookieSecure(raw)).toBe(expected);
  });

  it.each([undefined, null, '', '   '])(
    '%p vale null (usa el default)',
    (raw) => {
      expect(parseAuthCookieSecure(raw)).toBeNull();
    },
  );

  it.each(['yes', '1', '0', 'si', 'truee', 'secreto-ficticio'])(
    'rechaza %p sin imprimir el valor',
    (raw) => {
      let message = '';
      try {
        parseAuthCookieSecure(raw);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/AUTH_COOKIE_SECURE must be true or false/);
      expect(message).not.toContain(raw);
    },
  );

  it('rechaza un valor que no es string', () => {
    expect(() => parseAuthCookieSecure(1)).toThrow(/AUTH_COOKIE_SECURE/);
  });
});

describe('getAuthCookieSecure / resolveCookieSecure', () => {
  it('sin variable: producción (o NODE_ENV ausente) lleva Secure; desarrollo y test no', () => {
    expect(getAuthCookieSecure(cfg({ NODE_ENV: 'production' }))).toBe(true);
    expect(getAuthCookieSecure(cfg({}))).toBe(true);
    expect(getAuthCookieSecure(cfg({ NODE_ENV: 'development' }))).toBe(false);
    expect(getAuthCookieSecure(cfg({ NODE_ENV: 'test' }))).toBe(false);
  });

  it('el valor explícito gana al entorno', () => {
    expect(
      getAuthCookieSecure(
        cfg({ NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'false' }),
      ),
    ).toBe(false);
    expect(
      getAuthCookieSecure(
        cfg({ NODE_ENV: 'development', AUTH_COOKIE_SECURE: 'true' }),
      ),
    ).toBe(true);
  });

  it('un origen https ya validado fuerza Secure; uno http no lo quita ni lo pone', () => {
    const dev = cfg({ NODE_ENV: 'development' });
    expect(resolveCookieSecure(dev, 'https://app.example.test')).toBe(true);
    expect(resolveCookieSecure(dev, 'http://localhost:3002')).toBe(false);
    expect(resolveCookieSecure(dev, null)).toBe(false);
    expect(
      resolveCookieSecure(
        cfg({ NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'false' }),
        'http://localhost:3002',
      ),
    ).toBe(false);
  });
});

describe('buildSessionCookieOptions', () => {
  it('HttpOnly, SameSite=Lax, Path=/, sin domain y maxAge en milisegundos', () => {
    const options = buildSessionCookieOptions({
      secure: false,
      maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS,
    });
    expect(options).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
      maxAge: 28800 * 1000,
    });
    expect('domain' in options).toBe(false);
  });

  it('Max-Age es la vida del JWT', () => {
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(JWT_EXPIRES_IN_SECONDS);
  });
});

describe('readSessionCookie', () => {
  it('lee la cookie entre otras', () => {
    expect(readSessionCookie(`a=1; ${AUTH_COOKIE_NAME}=${JWT}; b=2`)).toBe(JWT);
    expect(readSessionCookie(`${AUTH_COOKIE_NAME}=${JWT}`)).toBe(JWT);
  });

  it.each([undefined, null, 42, ['x'], '', 'a=1', `auth_token=${JWT}`])(
    '%p da null',
    (header) => {
      expect(readSessionCookie(header)).toBeNull();
    },
  );

  it('falla cerrado si el nombre aparece más de una vez', () => {
    expect(
      readSessionCookie(
        `${AUTH_COOKIE_NAME}=${JWT}; ${AUTH_COOKIE_NAME}=${JWT}`,
      ),
    ).toBeNull();
  });

  it('un nombre que solo termina igual no cuenta', () => {
    expect(readSessionCookie(`x${AUTH_COOKIE_NAME}=${JWT}`)).toBeNull();
  });

  it.each(['abc', 'a.b', 'a.b.c.d', 'a b.c.d', 'a.b.c=', '"a.b.c"', '..'])(
    'valor mal formado %p da null',
    (value) => {
      expect(readSessionCookie(`${AUTH_COOKIE_NAME}=${value}`)).toBeNull();
    },
  );

  it('valor de más de 4096 caracteres da null', () => {
    expect(
      readSessionCookie(`${AUTH_COOKIE_NAME}=${'a'.repeat(4100)}.b.c`),
    ).toBeNull();
  });
});

describe('isAllowedOrigin / getAllowedOrigins', () => {
  const list = ['http://localhost:3002', 'http://127.0.0.1:3002'];

  it('compara exacto contra la lista', () => {
    expect(isAllowedOrigin('http://localhost:3002', list)).toBe(true);
    expect(isAllowedOrigin('http://localhost:3002/', list)).toBe(false);
    expect(isAllowedOrigin('http://localhost:3000', list)).toBe(false);
    expect(isAllowedOrigin('null', list)).toBe(false);
    expect(isAllowedOrigin(undefined, list)).toBe(false);
    expect(isAllowedOrigin(['http://localhost:3002'], list)).toBe(false);
    expect(isAllowedOrigin('http://localhost:3002', [])).toBe(false);
  });

  it('usa CORS_ORIGIN como única fuente', () => {
    expect(
      getAllowedOrigins(cfg({ CORS_ORIGIN: 'http://a.test, http://b.test' })),
    ).toEqual(['http://a.test', 'http://b.test']);
    expect(getAllowedOrigins(cfg({}))).toEqual([]);
  });
});
