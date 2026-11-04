/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import {
  createLoginApp,
  makeFakeUser,
  makePrismaMock,
} from '../../../test/helpers/login-app';
import { NestLoggerAdapter } from '../config/core/nest-logger-adapter';
import { createAccessLogMiddleware } from '../config/app/access-log';
import { LoggingInterceptor } from './logging.interceptor';

type Spies = jest.SpyInstance[];

const captureOutput = (): { spies: Spies; text: () => string } => {
  const chunks: string[] = [];
  const push = (...args: unknown[]) => {
    chunks.push(
      args
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' '),
    );
  };
  const spies: Spies = [
    jest.spyOn(console, 'log').mockImplementation(push),
    jest.spyOn(console, 'info').mockImplementation(push),
    jest.spyOn(console, 'warn').mockImplementation(push),
    jest.spyOn(console, 'error').mockImplementation(push),
    jest.spyOn(console, 'debug').mockImplementation(push),
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: any) => {
      push(String(chunk));
      return true;
    }) as any),
    jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: any) => {
      push(String(chunk));
      return true;
    }) as any),
  ];
  return { spies, text: () => chunks.join('\n') };
};

describe('LoggingInterceptor', () => {
  const originalEnv = { ...process.env };
  let app: INestApplication | undefined;
  let spies: Spies = [];

  const start = async (nodeEnv: string, debugEnabled: boolean) => {
    process.env.NODE_ENV = nodeEnv;
    process.env.APP_NAME = 'healthops-test';
    const user = makeFakeUser();
    const prisma = makePrismaMock(user);
    app = await createLoginApp(prisma, (a) => {
      a.use(createAccessLogMiddleware());
      a.useGlobalInterceptors(new LoggingInterceptor({ debugEnabled }));
      a.useLogger(new NestLoggerAdapter(a.get(ConfigService)));
    });
    return user;
  };

  afterEach(async () => {
    spies.forEach((s) => s.mockRestore());
    spies = [];
    await app?.close();
    app = undefined;
    process.env = { ...originalEnv };
  });

  it('criterio 11: el login no deja la contraseña ni el token (ni su firma) en la salida, y sí [REDACTED]', async () => {
    const user = await start('development', true);
    const capture = captureOutput();
    spies = capture.spies;

    const res = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Authorization', 'Bearer cabecera.ficticia.solo-para-test')
      .set('Cookie', 'auth_token=cookie-ficticia')
      .send({ user: user.email, password: user.password });
    expect(res.status).toBe(201);

    const token: string = res.body.token;
    const signature = token.split('.')[2];
    const out = capture.text();
    expect(out).not.toContain(user.password);
    expect(out).not.toContain(token);
    expect(out).not.toContain(signature);
    expect(out).not.toContain('cookie-ficticia');
    expect(out).not.toContain('cabecera.ficticia');
    expect(out).toContain('[REDACTED]');
    // Una línea por request, con ruta y status.
    expect(out).toMatch(/POST \/api\/v1\/auth\/login 201 \d+ms/);
    // El interceptor ya no escribe la línea de acceso: aparece una sola vez (la del middleware).
    expect(out.match(/POST \/api\/v1\/auth\/login 201/g)).toHaveLength(1);
  });

  it('un body anidado sale redactado en debug y los headers y las respuestas no se loguean', async () => {
    await start('development', true);
    const capture = captureOutput();
    spies = capture.spies;

    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        user: 'a@example.test',
        a: { b: [{ accessToken: 'valor-token' }] },
        secret: 'valor-secret',
        JWT: 'valor-jwt',
        password: 'x',
      });
    const out = capture.text();
    expect(out).not.toContain('valor-token');
    expect(out).not.toContain('valor-secret');
    expect(out).not.toContain('valor-jwt');
    expect(out).toContain('"accessToken":"[REDACTED]"');
    // Nunca se vuelcan cuerpos de respuesta.
    expect(out).not.toContain('unhandled-exception"');
    expect(out).not.toContain('"errors":');
    expect(out).not.toContain('"code":');
  });

  it('con debug desactivado (producción) no hay líneas de params, query ni body', async () => {
    await start('production', false);
    const capture = captureOutput();
    spies = capture.spies;

    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ user: 'a@example.test', password: 'x' });
    const out = capture.text();
    expect(out).not.toMatch(/Body:|Query:|Params:/);
    expect(out).not.toContain('[REDACTED]');
  });
});
