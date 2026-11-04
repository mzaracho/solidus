/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  Post,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { IsString } from 'class-validator';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { OrgAccessService } from '@src/infrastructure/features/auth/services/org-access.service';
import { CurrentUserId } from '../config/core/authentication/current-user-decorator';
import { resourceNotFound } from '../config/core/authentication/org-resource';
import { ILogger } from '../config/core/i-logger';
import { configureBodyParser } from '../config/app/body-parser-config';
import { configureGlobalPrefix } from '../config/app/global-prefix-config';
import { jwtModuleAsyncOptions } from '../config/app/jwt-config';
import { configurePipes } from '../config/app/pipes-config';
import {
  AuthenticationGuardProvider,
  OrgAccessGuardProvider,
  ViewModeGuardProvider,
} from '../config/providers/guard-provider';
import { GlobalFilter } from './global-filter';
import { HttpFilter } from './http-filter';
import { finalErrorHandler } from './final-error-handler';
import { GENERIC_ERRORS } from './error-contract';

class ProbeDto {
  @IsString()
  user!: string;

  @IsString()
  password!: string;
}

const SECRET_WHERE_VALUE = 'valor-where-ficticio';

@Controller('v1/probe')
class ProbeController {
  @Get('ok')
  ok(@CurrentUserId() userId: string) {
    return { userId };
  }

  @Post('validate')
  validate(@Body() dto: ProbeDto) {
    return { ok: !!dto };
  }

  @Post('echo')
  echo(@Body() body: unknown) {
    return { received: body !== undefined };
  }

  @Get('notfound')
  notFound(): never {
    throw resourceNotFound();
  }

  @Get('conflict')
  conflict(): never {
    throw new ConflictException({
      code: 'conflict',
      message: 'Ya existe un registro ficticio.',
    });
  }

  @Get('too-many')
  tooMany(): never {
    throw new HttpException(
      { code: 'too-many-requests', message: 'Demasiados intentos ficticios.' },
      429,
    );
  }

  @Get('prisma')
  prisma(): never {
    throw new Prisma.PrismaClientKnownRequestError(
      `Invalid prisma.thing.findUnique() where: { id: "${SECRET_WHERE_VALUE}" }`,
      {
        code: 'P2025',
        clientVersion: '5.22.0',
        meta: { cause: 'valor-meta' },
      },
    );
  }

  @Get('boom')
  boom(): never {
    throw new Error(`fallo interno con ${SECRET_WHERE_VALUE}`);
  }
}

describe('Contrato de error en la app (filtros + manejador final)', () => {
  const SECRET = 'k'.repeat(40);
  const userId = randomUUID();
  const adminOrg = randomUUID();
  let app: NestExpressApplication;
  let jwt: JwtService;
  let dbFails = false;
  const logger = {
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarning: jest.fn(),
  };

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
              findUnique: async ({ where }: any) => {
                if (dbFails) {
                  throw new Prisma.PrismaClientInitializationError(
                    `no se puede conectar ${SECRET_WHERE_VALUE}`,
                    '5.22.0',
                  );
                }
                return { id: where.id, deletedAt: null };
              },
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
        { provide: ILogger, useValue: logger },
        { provide: APP_FILTER, useClass: GlobalFilter },
        { provide: APP_FILTER, useClass: HttpFilter },
        AuthenticationGuardProvider,
        OrgAccessGuardProvider,
        ViewModeGuardProvider,
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Simula un middleware que falla con un error de Express sin `type` (I-4 del 010).
    app.use('/mw-error', (_req: any, _res: any, next: (e?: unknown) => void) =>
      next(
        Object.assign(new Error(`falla de middleware ${SECRET_WHERE_VALUE}`), {
          status: 502,
        }),
      ),
    );
    configureBodyParser(app, {
      get: (key: string) => (key === 'BODY_SIZE_LIMIT' ? '1kb' : undefined),
    } as unknown as ConfigService);
    configureGlobalPrefix(app);
    configurePipes(app);
    await app.init();
    app.use(finalErrorHandler);
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    dbFails = false;
    jest.clearAllMocks();
  });

  /** Primer argumento (el mensaje) de todas las llamadas al logger; el request es circular. */
  const loggedText = () =>
    [logger.logError, logger.logDebug, logger.logWarning, logger.logInfo]
      .flatMap((fn) => fn.mock.calls.map((c) => String(c[0])))
      .join(' | ');

  const auth = (r: request.Test) =>
    r
      .set('Authorization', `Bearer ${jwt.sign({ sub: userId })}`)
      .set('x-org-id', adminOrg);

  /** Verifica el contrato y que no haya rastros internos en el body. */
  const expectContract = (res: request.Response, status: number) => {
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'errors']);
    expect(
      res.body.errors.every((e: any) => Object.keys(e).join() === 'message'),
    ).toBe(true);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(
      /details|stack|node_modules|clientVersion|meta|Prisma|valor-where|valor-meta|<html/i,
    );
  };

  it('400 de validación: validation-failed con los mensajes de class-validator', async () => {
    const res = await auth(
      request(app.getHttpServer()).post('/api/v1/probe/validate'),
    ).send({ otro: 'valor-enviado' });
    expectContract(res, 400);
    expect(res.body.code).toBe('validation-failed');
    const messages = res.body.errors.map((e: any) => e.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'user must be a string',
        'password must be a string',
      ]),
    );
    expect(messages.join()).not.toContain('valor-enviado');
  });

  it('401 sin token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/probe/ok');
    expectContract(res, 401);
    expect(res.body).toEqual({
      code: 'unauthorized',
      errors: [{ message: GENERIC_ERRORS[401][1] }],
    });
  });

  it('403 org-access-denied', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe/ok')
      .set('Authorization', `Bearer ${jwt.sign({ sub: userId })}`)
      .set('x-org-id', randomUUID());
    expectContract(res, 403);
    expect(res.body).toEqual({
      code: 'org-access-denied',
      errors: [{ message: GENERIC_ERRORS[403][1] }],
    });
  });

  it('404 de recurso y de ruta inexistente: mismo body', async () => {
    const a = await auth(
      request(app.getHttpServer()).get('/api/v1/probe/notfound'),
    );
    const b = await request(app.getHttpServer()).get('/api/no-existe');
    expectContract(a, 404);
    expectContract(b, 404);
    expect(a.body).toEqual(b.body);
    expect(a.body.code).toBe('not-found');
  });

  it('409 explícito: pasa el mensaje de negocio', async () => {
    const res = await auth(
      request(app.getHttpServer()).get('/api/v1/probe/conflict'),
    );
    expectContract(res, 409);
    expect(res.body).toEqual({
      code: 'conflict',
      errors: [{ message: 'Ya existe un registro ficticio.' }],
    });
  });

  it('413 del body parser', async () => {
    const res = await auth(
      request(app.getHttpServer()).post('/api/v1/probe/echo'),
    ).send({ relleno: 'x'.repeat(4096) });
    expectContract(res, 413);
    expect(res.body.code).toBe('payload-too-large');
  });

  it('429 explícito (como el del login)', async () => {
    const res = await auth(
      request(app.getHttpServer()).get('/api/v1/probe/too-many'),
    );
    expectContract(res, 429);
    expect(res.body).toEqual({
      code: 'too-many-requests',
      errors: [{ message: 'Demasiados intentos ficticios.' }],
    });
  });

  it('500 de Prisma: genérico, X-Error-Id y log sin valores', async () => {
    const res = await auth(
      request(app.getHttpServer()).get('/api/v1/probe/prisma'),
    );
    expectContract(res, 500);
    expect(res.body).toEqual({
      code: 'unhandled-exception',
      errors: [{ message: GENERIC_ERRORS[500][1] }],
    });
    const id = res.headers['x-error-id'];
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(logger.logError).toHaveBeenCalledTimes(1);
    const line: string = logger.logError.mock.calls[0][0];
    expect(line).toContain(`id=${id}`);
    expect(line).toContain('GET /api/v1/probe/prisma 500');
    expect(line).toContain('PrismaClientKnownRequestError prisma=P2025');
    expect(line).not.toMatch(/valor-where|valor-meta|clientVersion/);
    // Ningún log (ni el de debug con stack) contiene los valores de la consulta.
    const all = loggedText();
    expect(all).not.toMatch(/valor-where|valor-meta|clientVersion/);
  });

  it('500 de Error común: genérico, con X-Error-Id; el mensaje solo va al log', async () => {
    const res = await auth(
      request(app.getHttpServer()).get('/api/v1/probe/boom'),
    );
    expectContract(res, 500);
    expect(res.headers['x-error-id']).toBeDefined();
    expect(logger.logError).toHaveBeenCalledTimes(1);
    expect(logger.logError.mock.calls[0][0]).toContain('Error: fallo interno');
  });

  it('un 4xx no genera log de error ni X-Error-Id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/probe/ok');
    expect(res.headers['x-error-id']).toBeUndefined();
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it('I-4: un error de middleware sin type responde el contrato, no HTML ni stack', async () => {
    const res = await request(app.getHttpServer()).get('/mw-error');
    expectContract(res, 500);
    expect(res.body.code).toBe('unhandled-exception');
    expect(res.headers['content-type']).not.toMatch(/html/);
    expect(logger.logError).toHaveBeenCalledTimes(1);
  });

  it('B-1: falla de la base en el guard da 500 genérico (no 401) sin valores', async () => {
    dbFails = true;
    const res = await auth(
      request(app.getHttpServer()).get('/api/v1/probe/ok'),
    );
    expectContract(res, 500);
    expect(res.body.code).toBe('unhandled-exception');
    expect(res.headers['x-error-id']).toBeDefined();
    expect(logger.logError).toHaveBeenCalledTimes(1);
    const all = loggedText();
    expect(all).toContain('PrismaClientInitializationError');
    expect(all).not.toContain(SECRET_WHERE_VALUE);
  });
});
