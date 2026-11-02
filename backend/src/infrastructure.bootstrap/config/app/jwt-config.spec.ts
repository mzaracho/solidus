import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  getRequiredJwtSecret,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET_MIN_LENGTH,
  jwtModuleAsyncOptions,
} from './jwt-config';

const configWith = (value?: string) =>
  ({ get: () => value }) as unknown as ConfigService;

describe('getRequiredJwtSecret', () => {
  it.each([undefined, '', '   '])('lanza error si JWT_SECRET es %p', (v) => {
    expect(() => getRequiredJwtSecret(configWith(v))).toThrow(
      /JWT_SECRET is not defined/,
    );
  });

  it('lanza error de longitud con menos de 32 caracteres, sin mostrar el valor', () => {
    const short = 'x'.repeat(JWT_SECRET_MIN_LENGTH - 1);
    let message = '';
    try {
      getRequiredJwtSecret(configWith(short));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/at least 32 characters/);
    expect(message).not.toContain(short);
  });

  it('devuelve el secreto con 32 caracteres', () => {
    const ok = 'y'.repeat(JWT_SECRET_MIN_LENGTH);
    expect(getRequiredJwtSecret(configWith(ok))).toBe(ok);
  });
});

describe('jwtModuleAsyncOptions', () => {
  const original = process.env.JWT_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  const build = () =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        JwtModule.registerAsync(jwtModuleAsyncOptions()),
      ],
    }).compile();

  it('falla al compilar el módulo si falta JWT_SECRET', async () => {
    delete process.env.JWT_SECRET;
    await expect(build()).rejects.toThrow(/JWT_SECRET is not defined/);
  });

  it('firma y verifica con expiración de 8h', async () => {
    process.env.JWT_SECRET = 'z'.repeat(40);
    const moduleRef = await build();
    const jwt = moduleRef.get(JwtService);
    const token = jwt.sign({ sub: 'test' });
    const payload = jwt.verify<{ exp: number; iat: number }>(token);
    expect(payload.exp - payload.iat).toBe(8 * 3600);
  });

  it('firma con HS256, issuer y audience, y rechaza otro issuer, audience o algoritmo', async () => {
    process.env.JWT_SECRET = 'z'.repeat(40);
    const moduleRef = await build();
    const jwt = moduleRef.get(JwtService);
    const token = jwt.sign({ sub: 'test' });
    const header = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
    ) as { alg: string };
    expect(header.alg).toBe(JWT_ALGORITHM);
    const payload = jwt.verify<{ iss: string; aud: string }>(token);
    expect(payload.iss).toBe(JWT_ISSUER);
    expect(payload.aud).toBe(JWT_AUDIENCE);

    const other = jwt.sign({ sub: 'test' }, { issuer: 'otro' });
    expect(() => {
      jwt.verify(other);
    }).toThrow();
    const otherAud = jwt.sign({ sub: 'test' }, { audience: 'otro' });
    expect(() => {
      jwt.verify(otherAud);
    }).toThrow();
    const hs512 = jwt.sign({ sub: 'test' }, { algorithm: 'HS512' });
    expect(() => {
      jwt.verify(hs512);
    }).toThrow();
  });

  it('falla al compilar si JWT_SECRET está vacío', async () => {
    process.env.JWT_SECRET = '';
    await expect(build()).rejects.toThrow(/JWT_SECRET is not defined/);
  });

  it('falla al compilar si JWT_SECRET es corto', async () => {
    process.env.JWT_SECRET = 'short';
    await expect(build()).rejects.toThrow(/at least 32 characters/);
  });
});

describe('módulo JWT único y sin fallback (criterio 4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const modules = path.resolve(__dirname, '../../modules');

  it('app-module registra el único JwtModule con jwtModuleAsyncOptions y sin fallback', () => {
    const src = fs.readFileSync(path.join(modules, 'app-module.ts'), 'utf8');
    expect(src).toContain('jwtModuleAsyncOptions(');
    expect(src).not.toMatch(/JWT_SECRET['"]?\s*\)?\s*(\|\||\?\?)/);
    expect(src).not.toMatch(/secret\s*:\s*process\.env/);
    expect(src).not.toMatch(/get(<string>)?\(\s*['"]JWT_SECRET['"]\s*,/);
  });

  it('auth-module ya no registra JwtModule', () => {
    const src = fs.readFileSync(
      path.join(modules, 'features/auth/auth-module.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/JwtModule\s*\.\s*register/);
  });
});
