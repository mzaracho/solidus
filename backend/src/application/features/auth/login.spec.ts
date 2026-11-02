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
  TEST_JWT_SECRET,
} from '../../../../test/helpers/login-app';
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

  it('200: devuelve un token HS256 con iss, aud y 8 h de vida', async () => {
    const res = await login({ user: user.email, password: user.password });
    expect(res.status).toBe(201);
    const token: string = res.body.token;
    expect(typeof token).toBe('string');

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
  });
});
