import { Module } from '@nestjs/common';
import { FeeEngineModule } from './features/fee-engine/fee-engine-module';
import { ActivityModule } from './features/activity/activity-module';
import { PrismaModule } from './features/prisma/prisma-module';
import { PatientsModule } from './features/patients/patients-module';
import { DashboardModule } from './features/dashboard/dashboard-module';
import { SettlementsModule } from './features/settlements/settlements-module';
import { AuthModule } from './features/auth/auth-module';
import { HealthModule } from './features/health/health-module';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { jwtModuleAsyncOptions } from '../config/app/jwt-config';
import {
  AxiosFilterProvider,
  GlobalFilterProvider,
  HttpFilterProvider,
} from '../config/providers/filter-provider';
import {
  AuthenticationGuardProvider,
  OrgAccessGuardProvider,
} from '../config/providers/guard-provider';
import { LoggerModule } from '../config/modules/logger-module';
import { OrgAccessService } from '@src/infrastructure/features/auth/services/org-access.service';

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
    HealthModule,
    FeatureConfigModule, // Registering the missing module
    LoggerModule,
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      ...jwtModuleAsyncOptions(),
    }),
  ],
  providers: [
    GlobalFilterProvider,
    AxiosFilterProvider,
    HttpFilterProvider,
    OrgAccessService,
    // El orden es el de ejecución: autenticación primero, pertenencia después.
    AuthenticationGuardProvider,
    OrgAccessGuardProvider,
  ],
})
export class AppModule {}
