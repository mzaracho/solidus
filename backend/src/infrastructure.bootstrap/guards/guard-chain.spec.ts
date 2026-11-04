/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { OrgAccessService } from '@src/infrastructure/features/auth/services/org-access.service';
import { jwtModuleAsyncOptions } from '../config/app/jwt-config';
import { configureGlobalPrefix } from '../config/app/global-prefix-config';
import { CurrentUserId } from '../config/core/authentication/current-user-decorator';
import { OrgOptional } from '../config/core/authentication/org-optional-decorator';
import { Public } from '../config/core/authentication/public-decorator';
import { ILogger } from '../config/core/i-logger';
import { HttpFilter } from '../filters/http-filter';
import { HealthModule } from '../modules/features/health/health-module';
import { AppModule } from '../modules/app-module';
import {
  AuthenticationGuardProvider,
  OrgAccessGuardProvider,
  ViewModeGuardProvider,
} from '../config/providers/guard-provider';
import { AuthenticationGuard } from './authentication-guard';
import { OrgAccessGuard } from './org-access-guard';
import { OrgRoleGuard, RequireOrgRole } from './org-role-guard';
import { ViewModeGuard } from './view-mode-guard';

@Controller('v1/chain')
class ChainController {
  @Public()
  @Get('open')
  open() {
    return { open: true };
  }

  @Get('secure')
  secure(@CurrentUserId() userId: string) {
    return { userId };
  }

  @OrgOptional()
  @Get('optional')
  optional(@CurrentUserId() userId: string) {
    return { userId };
  }

  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  @Get('admin')
  admin() {
    return { admin: true };
  }
}

describe('Cadena de guards globales (integración)', () => {
  const SECRET = 'k'.repeat(40);
  const userId = randomUUID();
  const deletedUserId = randomUUID();
  const adminOrg = randomUUID();
  const memberOrg = randomUUID();
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        JwtModule.registerAsync({ global: true, ...jwtModuleAsyncOptions() }),
        HealthModule,
      ],
      controllers: [ChainController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: async ({ where }: any) =>
                where.id === deletedUserId
                  ? { id: where.id, deletedAt: new Date() }
                  : { id: where.id, deletedAt: null },
            },
          },
        },
        {
          provide: OrgAccessService,
          useValue: {
            getAccess: async (_user: string, org: string) => {
              if (org === adminOrg)
                return { allowed: true, memberRole: 'ADMIN' };
              if (org === memberOrg)
                return { allowed: true, memberRole: 'MEMBER' };
              return { allowed: false, memberRole: null };
            },
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
        { provide: APP_FILTER, useClass: HttpFilter },
        AuthenticationGuardProvider,
        OrgAccessGuardProvider,
        ViewModeGuardProvider,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureGlobalPrefix(app);
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  const token = () => jwt.sign({ sub: userId });
  const get = (path: string) => request(app.getHttpServer()).get(path);

  it('GET /health/liveness da 200 sin token y fuera de /api', async () => {
    const res = await get('/health/liveness');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect((await get('/api/health/liveness')).status).toBe(404);
  });

  it('ruta @Public pasa sin token', async () => {
    expect((await get('/api/v1/chain/open')).status).toBe(200);
  });

  it('sin token da 401 (y no 403) aunque falte la organización', async () => {
    const res = await get('/api/v1/chain/secure');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
    expect(JSON.stringify(res.body).toLowerCase()).not.toMatch(
      /jwt|signature|expired/,
    );
  });

  it('con token pero sin organización da 403 org-access-denied genérico', async () => {
    const res = await get('/api/v1/chain/secure').set(
      'Authorization',
      `Bearer ${token()}`,
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('org-access-denied');
  });

  it('organización ajena y "slug" dan el mismo 403', async () => {
    const other = await get('/api/v1/chain/secure')
      .set('Authorization', `Bearer ${token()}`)
      .set('x-org-id', randomUUID());
    const slug = await get('/api/v1/chain/secure')
      .set('Authorization', `Bearer ${token()}`)
      .set('x-org-id', 'psico-lsa');
    expect(other.status).toBe(403);
    expect(slug.status).toBe(403);
    expect(other.body.code).toBe(slug.body.code);
  });

  it('el controlador recibe sub como usuario aunque se mande otro x-user-id', async () => {
    const res = await get('/api/v1/chain/secure')
      .set('Authorization', `Bearer ${token()}`)
      .set('x-org-id', adminOrg)
      .set('x-user-id', randomUUID());
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userId);
  });

  it('@OrgOptional pasa sin organización', async () => {
    const res = await get('/api/v1/chain/optional').set(
      'Authorization',
      `Bearer ${token()}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userId);
  });

  it('token vigente de un usuario dado de baja da 401, también en @OrgOptional', async () => {
    const deletedToken = jwt.sign({ sub: deletedUserId });
    const secure = await get('/api/v1/chain/secure')
      .set('Authorization', `Bearer ${deletedToken}`)
      .set('x-org-id', adminOrg);
    const optional = await get('/api/v1/chain/optional').set(
      'Authorization',
      `Bearer ${deletedToken}`,
    );
    for (const res of [secure, optional]) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('unauthorized');
      expect(res.body.errors).toEqual([{ message: 'Unauthorized' }]);
    }
  });

  it('rol: ADMIN pasa y MEMBER recibe 403 forbidden', async () => {
    const ok = await get('/api/v1/chain/admin')
      .set('Authorization', `Bearer ${token()}`)
      .set('x-org-id', adminOrg);
    expect(ok.status).toBe(200);
    const denied = await get('/api/v1/chain/admin')
      .set('Authorization', `Bearer ${token()}`)
      .set('x-org-id', memberOrg);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('forbidden');
  });

  it('AppModule registra los tres APP_GUARD en orden: autenticación, pertenencia y modo', () => {
    const providers: any[] = Reflect.getMetadata('providers', AppModule);
    const guards = providers
      .filter((p) => p && p.provide === APP_GUARD)
      .map((p) => p.useClass);
    expect(guards).toEqual([
      AuthenticationGuard,
      OrgAccessGuard,
      ViewModeGuard,
    ]);
  });
});
