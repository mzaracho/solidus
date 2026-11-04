import { Module } from '@nestjs/common';

import { AuthController } from '@src/api/controllers/v1/auth/auth-controller';
import { DispatcherProvider } from '@src/infrastructure.bootstrap/config/core/cqrs/dispatcher-provider';
import { LoginQueryHandler } from '@src/application/features/auth/login-query-handler';
import { LoginRateLimiterProvider } from '@src/infrastructure.bootstrap/config/app/login-rate-limit-config';
import { PrismaModule } from '../prisma/prisma-module';

// JwtService viene del JwtModule global registrado una sola vez en AppModule.
@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [DispatcherProvider, LoginQueryHandler, LoginRateLimiterProvider],
})
export class AuthModule {}
