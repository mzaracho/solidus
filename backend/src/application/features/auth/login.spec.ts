/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import {
  createLoginApp,
  FakeUser,
  makeFakeUser,
  makePrismaMock,
  TEST_ALLOWED_ORIGIN,
  TEST_JWT_SECRET,
} from '../../../../test/helpers/login-app';
import { LoginRateLimiter } from '@src/infrastructure/features/auth/services/login-rate-limiter';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '@src/infrastructure.bootstrap/config/app/jwt-config';

// bcrypt.compare real, pero espiable: el namespace de bcrypt no permite jest.spyOn.
jest.mock('bcrypt', () => {
  const actual = jest.requireActual('bcrypt');
  return { ...actual, compare: jest.fn(actual.compare) };
});

describe('POST /api/v1/auth/login', () => {
  let app: INestApplication;
  let user: FakeUser;
  let prisma: ReturnType<typeof makePrismaMock>;
  const compareSpy = bcrypt.compare as unknown as jest.Mock;

  beforeAll(async () => {
    user = makeFakeUser();
    prisma = makePrismaMock(user);
    app = await createLoginApp(prisma);
  });

  beforeEach(() => {
    // Los casos comparten IP: se reinicia el limitador (012) sin debilitar ninguna aserción.
    app.get(LoginRateLimiter).reset();
    compareSpy.mockClear();
    prisma.user.findUnique.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (body: unknown) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(body as any);

  it.each([
    ['cuerpo vacío', {}],
    ['sin user', { password: 'x' }],
    ['sin password', { user: 'a@example.test' }],
    ['user numérico', { user: 123, password: 'x' }],
    ['password objeto', { user: 'a@example.test', password: {} }],
    ['user array', { user: ['a'], password: 'x' }],
    ['user booleano', { user: true, password: 'x' }],
    ['user vacío', { user: '', password: 'x' }],
    // 014: campo no declarado (whitelist + forbidNonWhitelisted en bodies)
    [
      'campo sobrante',
      { user: 'a@example.test', password: 'x', remember: true },
    ],
    ['user demasiado largo', { user: 'a'.repeat(255), password: 'x' }],
    [
      'password demasiado larga',
      { user: 'a@example.test', password: 'x'.repeat(129) },
    ],
  ])('400: %s', async (_name, body) => {
    const res = await login(body);
    expect(res.status).toBe(400);
    // Un 400 no llega a la base ni a bcrypt.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it('401: usuario inexistente y contraseña errónea dan cuerpos idénticos y ambos comparan con bcrypt', async () => {
    const unknownUser = await login({
      user: 'nadie@example.test',
      password: 'cualquiera',
    });
    expect(compareSpy).toHaveBeenCalledTimes(1);

    const wrongPassword = await login({
      user: user.email,
      password: `${user.password}-mal`,
    });
    expect(compareSpy).toHaveBeenCalledTimes(2);

    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.body).toEqual(wrongPassword.body);
    expect(unknownUser.body.code).toBe('unauthorized');
  });

  it('401: usuario dado de baja, con contraseña correcta o errónea, da el mismo cuerpo que un inexistente y compara con bcrypt', async () => {
    const deleted = { ...makeFakeUser(), deletedAt: new Date() };
    const deletedApp = await createLoginApp(makePrismaMock(deleted));
    try {
      const post = (body: unknown) =>
        request(deletedApp.getHttpServer())
          .post('/api/v1/auth/login')
          .send(body as any);
      const unknown = await login({
        user: 'nadie@example.test',
        password: 'x',
      });
      compareSpy.mockClear();
      const good = await post({
        user: deleted.email,
        password: deleted.password,
      });
      expect(compareSpy).toHaveBeenCalledTimes(1);
      const bad = await post({ user: deleted.email, password: 'incorrecta' });
      expect(compareSpy).toHaveBeenCalledTimes(2);
      for (const res of [good, bad]) {
        expect(res.status).toBe(401);
        expect(res.body).toEqual(unknown.body);
      }
      expect(good.body.code).toBe('unauthorized');
      expect(good.body.token).toBeUndefined();
    } finally {
      await deletedApp.close();
    }
  });

  const cookieOf = (res: request.Response): string => {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(raw).toHaveLength(1);
    return raw![0];
  };

  const withEnv = async (
    vars: Record<string, string | undefined>,
    fn: () => Promise<void>,
  ) => {
    const before: Record<string, string | undefined> = {};
    for (const key of Object.keys(vars)) before[key] = process.env[key];
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      await fn();
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };

  it('201: el JWT sale solo en la cookie HttpOnly (HS256, iss, aud, 8 h = Max-Age) y no en el cuerpo', async () => {
    const res = await login({ user: user.email, password: user.password });
    expect(res.status).toBe(201);
    // El token no llega al cuerpo.
    expect(res.body.token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ/);
    expect(res.body.id).toBe(user.id);

    const cookie = cookieOf(res);
    const attrs = cookie.split('; ');
    expect(attrs[0].startsWith('solidus_session=')).toBe(true);
    expect(attrs).toContain('Max-Age=28800');
    expect(attrs).toContain('Path=/');
    expect(attrs).toContain('HttpOnly');
    expect(attrs).toContain('SameSite=Lax');
    expect(attrs.some((a) => /^Domain=/i.test(a))).toBe(false);
    // NODE_ENV=test y sin AUTH_COOKIE_SECURE: sin Secure.
    expect(attrs).not.toContain('Secure');

    const token = attrs[0].slice('solidus_session='.length);
    const header = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
    );
    expect(header.alg).toBe('HS256');
    const jwt = new JwtService({ secret: TEST_JWT_SECRET });
    const payload = jwt.verify<any>(token, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    expect(payload.sub).toBe(user.id);
    expect(payload.exp - payload.iat).toBe(28800);
    expect(payload.exp - payload.iat).toBe(Number(attrs[1].split('=')[1]));
  });

  it('201: AUTH_COOKIE_SECURE=true agrega Secure', async () => {
    await withEnv({ AUTH_COOKIE_SECURE: 'true' }, async () => {
      const res = await login({ user: user.email, password: user.password });
      expect(res.status).toBe(201);
      expect(cookieOf(res).split('; ')).toContain('Secure');
    });
  });

  it('201: un Origin https permitido agrega Secure aunque la variable diga false', async () => {
    await withEnv(
      {
        AUTH_COOKIE_SECURE: 'false',
        CORS_ORIGIN: 'https://app.example.test,http://localhost:3002',
      },
      async () => {
        const res = await login({
          user: user.email,
          password: user.password,
        }).set('Origin', 'https://app.example.test');
        expect(res.status).toBe(201);
        expect(cookieOf(res).split('; ')).toContain('Secure');
        const http = await login({
          user: user.email,
          password: user.password,
        }).set('Origin', 'http://localhost:3002');
        expect(http.status).toBe(201);
        expect(cookieOf(http).split('; ')).not.toContain('Secure');
      },
    );
  });

  it('201: con Origin permitido o sin Origin entra', async () => {
    const allowed = await login({
      user: user.email,
      password: user.password,
    }).set('Origin', TEST_ALLOWED_ORIGIN);
    expect(allowed.status).toBe(201);
    const none = await login({ user: user.email, password: user.password });
    expect(none.status).toBe(201);
  });

  it('403: un Origin ajeno (o null) no emite cookie ni consume intentos', async () => {
    for (const origin of [
      'http://evil.example',
      'null',
      'http://localhost:3000',
    ]) {
      const res = await login({
        user: user.email,
        password: user.password,
      }).set('Origin', origin);
      expect(res.status).toBe(403);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.body.code).toBe('forbidden');
      expect(res.body.errors).toHaveLength(1);
    }
    // Ni la base ni bcrypt ni el limitador vieron esos intentos.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(compareSpy).not.toHaveBeenCalled();
    // 5 intentos erróneos siguen dando 401 (el sexto sería 429 si los 403 hubieran contado).
    for (let i = 0; i < 5; i++) {
      const res = await login({ user: user.email, password: 'mala' });
      expect(res.status).toBe(401);
    }
  });

  it('403 con urlencoded desde otro sitio: no hay login CSRF', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://evil.example')
      .type('form')
      .send({ user: user.email, password: user.password });
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('el 401 no emite cookie', async () => {
    const res = await login({ user: user.email, password: 'mala' });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
