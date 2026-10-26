import { Module } from '@nestjs/common';
import { ActivityService } from '@src/infrastructure/features/activity/activity.service';
import { PrismaModule } from '../prisma/prisma-module';
import { FeeEngineModule } from '../fee-engine/fee-engine-module';
import { ActivityController } from '@src/api/controllers/v1/activity/activity-controller';
import { FindAllActivitiesQueryHandler } from '@src/application/features/activity/queries/find-all-activities-query';
import { FindActivityByIdQueryHandler } from '@src/application/features/activity/queries/find-activity-by-id-query';
import { CreateActivityCommandHandler } from '@src/application/features/activity/commands/create-activity-command';
import { UpdateActivityCommandHandler } from '@src/application/features/activity/commands/update-activity-command';
import { DeleteActivityCommandHandler } from '@src/application/features/activity/commands/delete-activity-command';
import { DispatcherProvider } from '@src/infrastructure.bootstrap/config/core/cqrs/dispatcher-provider';

@Module({
  imports: [PrismaModule, FeeEngineModule],
  controllers: [ActivityController],
  providers: [
    ActivityService,
    FindAllActivitiesQueryHandler,
    FindActivityByIdQueryHandler,
    CreateActivityCommandHandler,
    UpdateActivityCommandHandler,
    DeleteActivityCommandHandler,
    DispatcherProvider,
  ],
  exports: [ActivityService],
})
export class ActivityModule { }
