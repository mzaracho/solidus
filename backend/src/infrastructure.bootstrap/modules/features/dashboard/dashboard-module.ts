import { Module } from '@nestjs/common';
import { DashboardController } from '@src/api/controllers/v1/dashboard/dashboard-controller';
import { GetDashboardKpisQueryHandler } from '@src/application/features/dashboard/queries/get-dashboard-kpis-query';
import { GetDashboardChartQueryHandler } from '@src/application/features/dashboard/queries/get-dashboard-chart-query';
import { GetDashboardPayerDistributionQueryHandler } from '@src/application/features/dashboard/queries/get-dashboard-payer-dist-query';
import { DashboardService } from '@src/infrastructure/features/dashboard/dashboard.service';
import { PrismaModule } from '../prisma/prisma-module';
import { DispatcherProvider } from '@src/infrastructure.bootstrap/config/core/cqrs/dispatcher-provider';

@Module({
  imports: [PrismaModule],
  controllers: [DashboardController],
  providers: [
    DashboardService,
    GetDashboardKpisQueryHandler,
    GetDashboardChartQueryHandler,
    GetDashboardPayerDistributionQueryHandler,
    DispatcherProvider,
  ],
  exports: [DashboardService],
})
export class DashboardModule { }
