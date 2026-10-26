import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from '@src/api/controllers/v1/auth/auth-controller';
import { DispatcherProvider } from '@src/infrastructure.bootstrap/config/core/cqrs/dispatcher-provider';
import { LoginQueryHandler } from '@src/application/features/auth/login-query-handler';
import { PrismaModule } from '../prisma/prisma-module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || '<REDACTED_JWT_SECRET>',
      signOptions: { expiresIn: '8h' },
    }),
    PrismaModule,
  ],
  controllers: [AuthController],
  providers: [DispatcherProvider, LoginQueryHandler],
})
export class AuthModule {}
