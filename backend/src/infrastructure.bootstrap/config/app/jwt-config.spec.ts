import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  getRequiredJwtSecret,
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
        JwtModule.registerAsync(jwtModuleAsyncOptions('8h')),
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

  it('firma con expiración de 1d (módulo global de app-module)', async () => {
    process.env.JWT_SECRET = 'z'.repeat(40);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        JwtModule.registerAsync(jwtModuleAsyncOptions('1d')),
      ],
    }).compile();
    const jwt = moduleRef.get(JwtService);
    const payload = jwt.verify<{ exp: number; iat: number }>(
      jwt.sign({ sub: 'test' }),
    );
    expect(payload.exp - payload.iat).toBe(24 * 3600);
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

describe('módulos JWT sin fallback (criterio 4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const modules = path.resolve(__dirname, '../../modules');
  const files = [
    path.join(modules, 'app-module.ts'),
    path.join(modules, 'features/auth/auth-module.ts'),
  ];

  it.each(files)('%s usa jwtModuleAsyncOptions y no tiene fallback', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toContain('jwtModuleAsyncOptions(');
    expect(src).not.toMatch(/JWT_SECRET['"]?\s*\)?\s*(\|\||\?\?)/);
    expect(src).not.toMatch(/secret\s*:\s*process\.env/);
    expect(src).not.toMatch(/get(<string>)?\(\s*['"]JWT_SECRET['"]\s*,/);
  });
});
