/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { AuthController } from '@src/api/controllers/v1/auth/auth-controller';
import { LoginQueryHandler } from '@src/application/features/auth/login-query-handler';
import { jwtModuleAsyncOptions } from '@src/infrastructure.bootstrap/config/app/jwt-config';
import { configurePipes } from '@src/infrastructure.bootstrap/config/app/pipes-config';
import { configureGlobalPrefix } from '@src/infrastructure.bootstrap/config/app/global-prefix-config';
import { DispatcherProvider } from '@src/infrastructure.bootstrap/config/core/cqrs/dispatcher-provider';
import { ILogger } from '@src/infrastructure.bootstrap/config/core/i-logger';
import { HttpFilter } from '@src/infrastructure.bootstrap/filters/http-filter';
import { AuthenticationGuard } from '@src/infrastructure.bootstrap/guards/authentication-guard';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';

/** Secreto ficticio armado en ejecución (no se lee ningún .env). */
export const TEST_JWT_SECRET = 'k'.repeat(40);

export interface FakeUser {
  id: string;
  email: string;
  password: string;
}

/** Usuario y contraseña ficticios generados en el test (bcrypt cost 4 para que sea rápido). */
export const makeFakeUser = (): FakeUser => ({
  id: randomUUID(),
  email: `${randomUUID().slice(0, 8)}@example.test`,
  password: `pw-${randomUUID()}`,
});

export const makePrismaMock = (user: FakeUser) => {
  const passwordHash = bcrypt.hashSync(user.password, 4);
  const orgId = randomUUID();
  return {
    user: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.email === user.email
          ? {
              id: user.id,
              name: 'Usuario Ficticio',
              email: user.email,
              passwordHash,
              userRoles: [],
              memberships: [{ role: 'ADMIN', organizationId: orgId }],
            }
          : null,
      ),
    },
    professional: { findFirst: jest.fn(async () => null) },
  };
};

/** App con el login real (controlador, DTO, handler, pipes y filtro) y Prisma mockeado. */
export async function createLoginApp(
  prisma: ReturnType<typeof makePrismaMock>,
  configure?: (app: INestApplication) => void,
): Promise<INestApplication> {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      JwtModule.registerAsync({ global: true, ...jwtModuleAsyncOptions() }),
    ],
    controllers: [AuthController],
    providers: [
      DispatcherProvider,
      LoginQueryHandler,
      { provide: PrismaService, useValue: prisma },
      { provide: ILogger, useValue: noopLogger },
      { provide: APP_FILTER, useClass: HttpFilter },
      { provide: APP_GUARD, useClass: AuthenticationGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureGlobalPrefix(app);
  configurePipes(app);
  configure?.(app);
  await app.init();
  return app;
}

export const noopLogger = {
  logInfo: jest.fn(),
  logDebug: jest.fn(),
  logError: jest.fn(),
  logWarning: jest.fn(),
};
