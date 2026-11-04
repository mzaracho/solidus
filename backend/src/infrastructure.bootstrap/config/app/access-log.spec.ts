/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { OrgAccessService } from '@src/infrastructure/features/auth/services/org-access.service';
import { CurrentUserId } from '../core/authentication/current-user-decorator';
import { ILogger } from '../core/i-logger';
import { GlobalFilter } from '../../filters/global-filter';
import { HttpFilter } from '../../filters/http-filter';
import {
  AuthenticationGuardProvider,
  OrgAccessGuardProvider,
  ViewModeGuardProvider,
} from '../providers/guard-provider';
import { configureBodyParser } from './body-parser-config';
import { configureGlobalPrefix } from './global-prefix-config';
import { jwtModuleAsyncOptions } from './jwt-config';
import {
  createAccessLogMiddleware,
  neutralizeUnsafeChars,
  sanitizeAccessPath,
} from './access-log';

@Controller('v1/probe')
class ProbeController {
  @Get('ok')
  ok(@CurrentUserId() userId: string) {
    return { userId };
  }

  @Post('echo')
  echo(@Body() body: unknown) {
    return { received: body !== undefined };
  }

  @Get('boom')
  boom(): never {
    throw new Error('fallo interno ficticio');
  }
}

describe('Línea de acceso (middleware)', () => {
  const SECRET = 'k'.repeat(40);
  const userId = randomUUID();
  const adminOrg = randomUUID();
  let app: NestExpressApplication;
  let jwt: JwtService;
  const lines: Array<{ level: 'log' | 'warn'; message: string }> = [];

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        JwtModule.registerAsync({ global: true, ...jwtModuleAsyncOptions() }),
      ],
      controllers: [ProbeController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: async ({ where }: any) => ({
                id: where.id,
                deletedAt: null,
              }),
            },
          },
        },
        {
          provide: OrgAccessService,
          useValue: {
            getAccess: async (_u: string, org: string) =>
              org === adminOrg
                ? { allowed: true, memberRole: 'ADMIN' }
                : { allowed: false, memberRole: null },
            getActiveProfessionals: async () => [],
            getOrgType: async () => 'CLINIC',
          },
        },
        {
          provide: ILogger,
          useValue: {
            logInfo: jest.fn(),
            logDebug: jest.fn(),
            logError: jest.fn(),
            logWarning: jest.fn(),
          },
        },
        { provide: APP_FILTER, useClass: GlobalFilter },
        { provide: APP_FILTER, useClass: HttpFilter },
        AuthenticationGuardProvider,
        OrgAccessGuardProvider,
        ViewModeGuardProvider,
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Mismo orden que bootstrap.ts: acceso, body parser, prefijo.
    app.use(
      createAccessLogMiddleware({
        log: (message) => lines.push({ level: 'log', message }),
        warn: (message) => lines.push({ level: 'warn', message }),
      }),
    );
    configureBodyParser(app, {
      get: (key: string) => (key === 'BODY_SIZE_LIMIT' ? '1kb' : undefined),
    } as unknown as ConfigService);
    configureGlobalPrefix(app);
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    lines.length = 0;
  });

  const token = () => jwt.sign({ sub: userId });
  const only = () => {
    expect(lines).toHaveLength(1);
    return lines[0];
  };

  it('200: una línea con nivel log, método, ruta sin query, status y duración', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe/ok?secreto=valor-query&email=a@example.test')
      .set('Authorization', `Bearer ${token()}`)
      .set('x-org-id', adminOrg);
    expect(res.status).toBe(200);
    const line = only();
    expect(line.level).toBe('log');
    expect(line.message).toMatch(/^GET \/api\/v1\/probe\/ok 200 \d+ms$/);
  });

  it('401 sin token: una línea warn', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/probe/ok');
    expect(res.status).toBe(401);
    const line = only();
    expect(line.level).toBe('warn');
    expect(line.message).toMatch(/^GET \/api\/v1\/probe\/ok 401 \d+ms$/);
  });

  it('403 por organización ajena: una línea warn', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe/ok')
      .set('Authorization', `Bearer ${token()}`)
      .set('x-org-id', randomUUID());
    expect(res.status).toBe(403);
    const line = only();
    expect(line.level).toBe('warn');
    expect(line.message).toMatch(/^GET \/api\/v1\/probe\/ok 403 \d+ms$/);
  });

  it('404 de ruta inexistente: una línea warn', async () => {
    const res = await request(app.getHttpServer()).get('/api/no-existe');
    expect(res.status).toBe(404);
    const line = only();
    expect(line.level).toBe('warn');
    expect(line.message).toMatch(/^GET \/api\/no-existe 404 \d+ms$/);
  });

  it('413 por body mayor al límite: cuerpo de error genérico y una línea warn', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/echo')
      .set('Authorization', `Bearer ${token()}`)
      .set('x-org-id', adminOrg)
      .send({ relleno: 'x'.repeat(4096) });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('payload-too-large');
    expect(Array.isArray(res.body.errors)).toBe(true);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/stack|node_modules|limit|length/i);
    const line = only();
    expect(line.level).toBe('warn');
    expect(line.message).toMatch(/^POST \/api\/v1\/probe\/echo 413 \d+ms$/);
  });

  it('400 por JSON inválido: respuesta genérica y una línea warn', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/echo')
      .set('Content-Type', 'application/json')
      .send('{"roto":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('bad-request');
    expect(JSON.stringify(res.body)).not.toMatch(/Unexpected|position|stack/i);
    expect(only().message).toMatch(/^POST \/api\/v1\/probe\/echo 400 \d+ms$/);
  });

  it('415 por Content-Encoding no soportado: respuesta genérica y una línea warn', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/echo')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'foo')
      .send('{"a":1}');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported-media-type');
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules|foo/i);
    const line = only();
    expect(line.level).toBe('warn');
    expect(line.message).toMatch(/^POST \/api\/v1\/probe\/echo 415 \d+ms$/);
  });

  it('415 por charset no soportado: respuesta genérica y una línea warn', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/echo')
      .set('Content-Type', 'application/json; charset=utf-32')
      .send('{"a":1}');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported-media-type');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules|utf-32/i);
    expect(only().message).toMatch(/^POST \/api\/v1\/probe\/echo 415 \d+ms$/);
  });

  it('500 de un handler: una línea warn', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe/boom')
      .set('Authorization', `Bearer ${token()}`)
      .set('x-org-id', adminOrg);
    expect(res.status).toBe(500);
    const line = only();
    expect(line.level).toBe('warn');
    expect(line.message).toMatch(/^GET \/api\/v1\/probe\/boom 500 \d+ms$/);
  });

  it('no incluye tokens, ids de usuario, emails, headers ni query', async () => {
    const t = token();
    await request(app.getHttpServer())
      .get('/api/v1/probe/ok?password=pw-ficticia&mail=a@example.test')
      .set('Authorization', `Bearer ${t}`)
      .set('Cookie', 'auth_token=cookie-ficticia')
      .set('x-org-id', adminOrg);
    await request(app.getHttpServer())
      .post('/api/v1/probe/echo')
      .set('Authorization', `Bearer ${t}`)
      .set('x-org-id', adminOrg)
      .send({ user: 'a@example.test', password: 'pw-ficticia' });
    const out = lines.map((l) => l.message).join('\n');
    expect(lines).toHaveLength(2);
    for (const forbidden of [
      t,
      t.split('.')[2],
      userId,
      adminOrg,
      'pw-ficticia',
      'a@example.test',
      'cookie-ficticia',
      'Bearer',
      'password=',
    ]) {
      expect(out).not.toContain(forbidden);
    }
  });
});

describe('sanitizeAccessPath', () => {
  it('quita query y fragmento, acota el largo y tolera valores no string', () => {
    expect(sanitizeAccessPath('/api/a?x=1#y')).toBe('/api/a');
    expect(sanitizeAccessPath('/' + 'a'.repeat(500))).toHaveLength(200);
    expect(sanitizeAccessPath(undefined)).toBe('');
  });
});

describe('sanitizeAccessPath: caracteres no imprimibles', () => {
  it('reemplaza por ? el byte 0x85, controles, espacios y saltos de línea', () => {
    const out = sanitizeAccessPath('/api/a\u0085FAKE 200 1ms\r\n\t\x00\x7f b');
    expect(out).toBe('/api/a?FAKE?200?1ms??????b');
    expect(out).toMatch(/^[\x21-\x7E]*$/);
  });

  it('neutralizeUnsafeChars deja intacto el ASCII imprimible y sanea el método', () => {
    expect(neutralizeUnsafeChars('GET')).toBe('GET');
    expect(neutralizeUnsafeChars('GE\nT\u0085')).toBe('GE?T?');
  });
});
