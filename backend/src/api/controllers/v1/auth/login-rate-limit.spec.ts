/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import {
  createLoginApp,
  FakeUser,
  makeFakeUser,
  makePrismaMock,
} from '../../../../../test/helpers/login-app';
import { LoginRateLimiter } from '@src/infrastructure/features/auth/services/login-rate-limiter';

jest.mock('bcrypt', () => {
  const actual = jest.requireActual('bcrypt');
  return { ...actual, compare: jest.fn(actual.compare) };
});

describe('POST /api/v1/auth/login: rate limiting (012)', () => {
  let app: INestApplication;
  let user: FakeUser;
  let prisma: ReturnType<typeof makePrismaMock>;
  const compareSpy = bcrypt.compare as unknown as jest.Mock;
  const GENERIC =
    'Demasiados intentos. Esperá unos minutos antes de volver a intentar.';

  beforeAll(async () => {
    user = makeFakeUser();
    prisma = makePrismaMock(user);
    app = await createLoginApp(prisma);
  });

  beforeEach(() => {
    app.get(LoginRateLimiter).reset();
    compareSpy.mockClear();
    prisma.user.findUnique.mockClear();
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app.close();
  });

  const login = (body: unknown, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set(headers)
      .send(body as any);

  const failures = async (email: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const res = await login({ user: email, password: 'incorrecta' });
      expect(res.status).toBe(401);
    }
  };

  it('5 fallidos dan 401 y el sexto 429 genérico con Retry-After, sin bcrypt ni base', async () => {
    await failures('nadie@example.test', 5);
    compareSpy.mockClear();
    prisma.user.findUnique.mockClear();

    const res = await login({ user: 'nadie@example.test', password: 'x' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('too-many-requests');
    expect(res.body.errors).toEqual([{ message: GENERIC }]);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(900);
    expect(compareSpy).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('usuario existente e inexistente dan el mismo 429', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.now());
    await failures(user.email, 5);
    await failures('nadie@example.test', 5);
    const a = await login({ user: user.email, password: user.password });
    const b = await login({ user: 'nadie@example.test', password: 'x' });
    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    expect(a.body).toEqual(b.body);
    expect(a.headers['retry-after']).toBe(b.headers['retry-after']);
    expect(a.body.token).toBeUndefined();
  });

  it('otro usuario desde la misma IP sigue dando 401 hasta el límite por IP (20)', async () => {
    await failures('a@example.test', 5);
    expect(
      (await login({ user: 'a@example.test', password: 'x' })).status,
    ).toBe(429);
    for (let i = 0; i < 15; i++) {
      const res = await login({ user: `u${i}@example.test`, password: 'x' });
      expect(res.status).toBe(401);
    }
    const res = await login({ user: 'otro@example.test', password: 'x' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('un login exitoso reinicia la combinación', async () => {
    await failures(user.email, 4);
    const ok = await login({ user: user.email, password: user.password });
    expect(ok.status).toBe(201);
    await failures(user.email, 5);
    expect((await login({ user: user.email, password: 'x' })).status).toBe(429);
  });

  it('los 400 de validación no consumen intentos', async () => {
    for (let i = 0; i < 30; i++) {
      expect((await login({ user: 123, password: 'x' })).status).toBe(400);
    }
    expect(
      (await login({ user: 'a@example.test', password: 'x' })).status,
    ).toBe(401);
  });

  it('ignora X-Forwarded-For: rotarlo no evita el límite', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await login(
        { user: 'nadie@example.test', password: 'x' },
        { 'X-Forwarded-For': `203.0.113.${i + 1}` },
      );
      expect(res.status).toBe(401);
    }
    const res = await login(
      { user: 'nadie@example.test', password: 'x' },
      { 'X-Forwarded-For': '198.51.100.7' },
    );
    expect(res.status).toBe(429);
  });

  it('el usuario se normaliza (mayúsculas y espacios) para el contador', async () => {
    await failures('nadie@example.test', 5);
    const res = await login({ user: '  NADIE@Example.test ', password: 'x' });
    expect(res.status).toBe(429);
  });

  it('vence la ventana con el reloj simulado y vuelve a permitir', async () => {
    const t0 = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await failures('nadie@example.test', 5);
    expect(
      (await login({ user: 'nadie@example.test', password: 'x' })).status,
    ).toBe(429);
    spy.mockReturnValue(t0 + 15 * 60 * 1000 + 1000);
    expect(
      (await login({ user: 'nadie@example.test', password: 'x' })).status,
    ).toBe(401);
  });

  it('no afecta a otras rutas (logout sin token sigue dando 401, no 429)', async () => {
    await failures('nadie@example.test', 5);
    const res = await request(app.getHttpServer()).post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
  });
});
