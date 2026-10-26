import { Module } from '@nestjs/common';
import { FeeEngineModule } from './features/fee-engine/fee-engine-module';
import { ActivityModule } from './features/activity/activity-module';
import { PrismaModule } from './features/prisma/prisma-module';
import { PatientsModule } from './features/patients/patients-module';
import { DashboardModule } from './features/dashboard/dashboard-module';
import { SettlementsModule } from './features/settlements/settlements-module';
import { AuthModule } from './features/auth/auth-module';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  AxiosFilterProvider,
  GlobalFilterProvider,
  HttpFilterProvider,
} from '../config/providers/filter-provider';
import { LoggerModule } from '../config/modules/logger-module';
import { VerifyTokenModule } from './features/auth/verify-token-module';

import { ConfigModule as FeatureConfigModule } from '../config/config-module';

@Module({
  imports: [
    FeeEngineModule,
    ActivityModule,
    PrismaModule,
    AuthModule,
    PatientsModule,
    DashboardModule,
    SettlementsModule,
    VerifyTokenModule,
    FeatureConfigModule, // Registering the missing module
    LoggerModule,
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '1d',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [GlobalFilterProvider, AxiosFilterProvider, HttpFilterProvider],
})
export class AppModule {}
