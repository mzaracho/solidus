/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  Controller,
  Delete,
  Get,
  INestApplication,
  Post,
  Put,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import {
  createLoginApp,
  FakeUser,
  makeFakeUser,
  makePrismaMock,
  TEST_ALLOWED_ORIGIN,
  TEST_JWT_SECRET,
} from '../../../test/helpers/login-app';
import { LoginRateLimiter } from '@src/infrastructure/features/auth/services/login-rate-limiter';
import { JWT_AUDIENCE, JWT_ISSUER } from '../config/app/jwt-config';
import { CurrentUserId } from '../config/core/authentication/current-user-decorator';

// Rutas de prueba (no públicas): el guard global las protege igual que a las reales.
@Controller('probe')
class ProbeController {
  @Get()
  read(@CurrentUserId() userId: string) {
    return { userId };
  }
  @Post()
  create() {
    return { ok: true };
  }
  @Put()
  update() {
    return { ok: true };
  }
  @Delete()
  remove() {
    return { ok: true };
  }
}

describe('AuthenticationGuard con cookie de sesión (018)', () => {
  let app: INestApplication;
  let user: FakeUser;
  let prisma: ReturnType<typeof makePrismaMock>;
  let sessionCookie: string; // "solidus_session=<jwt>"
  const jwt = new JwtService({ secret: TEST_JWT_SECRET });

  beforeAll(async () => {
    user = makeFakeUser();
    prisma = makePrismaMock(user);
    app = await createLoginApp(prisma, undefined, [ProbeController]);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ user: user.email, password: user.password });
    expect(res.status).toBe(201);
    sessionCookie = (res.headers['set-cookie'] as unknown as string[])[0].split(
      ';',
    )[0];
  });

  beforeEach(() => {
    app.get(LoginRateLimiter).reset();
    prisma.user.findUnique.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  const csrf = { 'x-requested-with': 'solidus', Origin: TEST_ALLOWED_ORIGIN };
  const signed = (extra: object = {}) =>
    jwt.sign(
      { sub: user.id },
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 600, ...extra },
    );

  it('GET con la cookie válida pasa, sin header ni Origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(user.id);
  });

  it.each([
    ['POST', 'post'],
    ['PUT', 'put'],
    ['DELETE', 'delete'],
  ] as const)(
    '%s con la cookie y sin header propio da 403 sin consultar la base',
    async (_m, method) => {
      const res = await request(app.getHttpServer())
        [method]('/api/probe')
        .set('Cookie', sessionCookie)
        .set('Origin', TEST_ALLOWED_ORIGIN);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it('con header propio y sin Origin da 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe')
      .set('Cookie', sessionCookie)
      .set('x-requested-with', 'solidus');
    expect(res.status).toBe(403);
  });

  it('con header propio y Origin ajeno (o vecino same-site) da 403', async () => {
    for (const origin of [
      'http://evil.example',
      'http://localhost:3000',
      'null',
    ]) {
      const res = await request(app.getHttpServer())
        .post('/api/probe')
        .set('Cookie', sessionCookie)
        .set('x-requested-with', 'solidus')
        .set('Origin', origin);
      expect(res.status).toBe(403);
    }
  });

  it('con header de otro valor da 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe')
      .set('Cookie', sessionCookie)
      .set('x-requested-with', 'XMLHttpRequest')
      .set('Origin', TEST_ALLOWED_ORIGIN);
    expect(res.status).toBe(403);
  });

  it('con header propio y Origin permitido, POST pasa', async () => {
    for (const method of ['post', 'put', 'delete'] as const) {
      const res = await request(app.getHttpServer())
        [method]('/api/probe')
        .set('Cookie', sessionCookie)
        .set(csrf);
      expect(res.status).toBe(method === 'post' ? 201 : 200);
    }
  });

  it('POST con Bearer y sin header propio pasa (SSR, Swagger, scripts)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe')
      .set('Authorization', `Bearer ${signed()}`);
    expect(res.status).toBe(201);
  });

  it('Authorization mal formado con la cookie válida da 401: no cae a la cookie', async () => {
    for (const authorization of ['Bearer abc', 'Basic xyz', 'basura']) {
      const res = await request(app.getHttpServer())
        .get('/api/probe')
        .set('Authorization', authorization)
        .set('Cookie', sessionCookie);
      expect(res.status).toBe(401);
    }
  });

  it('cookie duplicada da 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe')
      .set('Cookie', `${sessionCookie}; ${sessionCookie}`);
    expect(res.status).toBe(401);
  });

  it('la cookie vieja auth_token con un JWT válido da 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe')
      .set('Cookie', `auth_token=${signed()}`);
    expect(res.status).toBe(401);
  });

  it('cookie con JWT vencido o firmado con otro secreto da 401', async () => {
    const expired = signed({ expiresIn: -10 });
    const other = new JwtService({ secret: 'z'.repeat(40) }).sign(
      { sub: user.id },
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 600 },
    );
    for (const token of [expired, other]) {
      const res = await request(app.getHttpServer())
        .get('/api/probe')
        .set('Cookie', `solidus_session=${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('usuario dado de baja con la cookie da 401', async () => {
    const deleted = { ...makeFakeUser(), deletedAt: new Date() };
    const deletedPrisma = makePrismaMock(deleted);
    const otherApp = await createLoginApp(deletedPrisma, undefined, [
      ProbeController,
    ]);
    try {
      const token = new JwtService({ secret: TEST_JWT_SECRET }).sign(
        { sub: deleted.id },
        { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 600 },
      );
      const res = await request(otherApp.getHttpServer())
        .get('/api/probe')
        .set('Cookie', `solidus_session=${token}`);
      expect(res.status).toBe(401);
    } finally {
      await otherApp.close();
    }
  });

  it('sin cookie ni Authorization da 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/probe');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout (018)', () => {
  let app: INestApplication;
  let user: FakeUser;
  let sessionCookie: string;

  beforeAll(async () => {
    user = makeFakeUser();
    app = await createLoginApp(makePrismaMock(user));
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ user: user.email, password: user.password });
    sessionCookie = (res.headers['set-cookie'] as unknown as string[])[0].split(
      ';',
    )[0];
  });

  afterAll(async () => {
    await app.close();
  });

  const csrf = { 'x-requested-with': 'solidus', Origin: TEST_ALLOWED_ORIGIN };

  it('con la cookie, header y Origin: 204 y borra la cookie con los mismos atributos', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', sessionCookie)
      .set(csrf);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const raw = res.headers['set-cookie'] as unknown as string[];
    expect(raw).toHaveLength(1);
    const attrs = raw[0].split('; ');
    expect(attrs[0]).toBe('solidus_session=');
    expect(attrs).toContain('Max-Age=0');
    expect(attrs).toContain('Path=/');
    expect(attrs).toContain('HttpOnly');
    expect(attrs).toContain('SameSite=Lax');
    expect(attrs.some((a) => /^Expires=/i.test(a))).toBe(true);
    expect(attrs.some((a) => /^Domain=/i.test(a))).toBe(false);
    expect(attrs).not.toContain('Secure');
  });

  it('con AUTH_COOKIE_SECURE=true el borrado también lleva Secure', async () => {
    const before = process.env.AUTH_COOKIE_SECURE;
    process.env.AUTH_COOKIE_SECURE = 'true';
    try {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', sessionCookie)
        .set(csrf);
      expect(res.status).toBe(204);
      expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(
        /; Secure/,
      );
    } finally {
      if (before === undefined) delete process.env.AUTH_COOKIE_SECURE;
      else process.env.AUTH_COOKIE_SECURE = before;
    }
  });

  it('con Bearer: 204 y borra la cookie', async () => {
    const token = sessionCookie.slice('solidus_session='.length);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('con la cookie y sin header propio: 403 y no borra', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', sessionCookie)
      .set('Origin', TEST_ALLOWED_ORIGIN);
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('sin sesión: 401', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
  });
});
