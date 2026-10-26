import { Module } from '@nestjs/common';
import { SettlementsController } from '@src/api/controllers/v1/settlements/settlements-controller';
import { PrismaModule } from '../prisma/prisma-module';
import { DispatcherProvider } from '@src/infrastructure.bootstrap/config/core/cqrs/dispatcher-provider';
import { CalculateSettlementsQueryHandler } from '@src/application/features/settlements/queries/calculate-settlements-query';

@Module({
  imports: [PrismaModule],
  controllers: [SettlementsController],
  providers: [DispatcherProvider, CalculateSettlementsQueryHandler],
})
export class SettlementsModule { }
