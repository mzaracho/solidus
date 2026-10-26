import { Module } from '@nestjs/common';
import { ConfigController } from '../../api/controllers/v1/config/config-controller';
import { OrgController } from '../../api/controllers/v1/config/org-controller';
import { ProController } from '../../api/controllers/v1/config/pro-controller';
import { SystemController } from '../../api/controllers/v1/config/system-controller';
import { ProfileController } from '../../api/controllers/v1/config/profile-controller';
import { PrismaModule } from '../modules/features/prisma/prisma-module';
import { GetOrgConfigQueryHandler } from '@src/application/features/config/queries/get-org-config-query';
import { GetOrganizationQueryHandler } from '@src/application/features/config/queries/get-organization-query';
import { GetActivityTypesQueryHandler } from '@src/application/features/config/queries/get-activity-types-query';
import {
  CreateCategoryCommandHandler,
  UpdateCategoryCommandHandler,
  DeleteCategoryCommandHandler,
} from '@src/application/features/config/commands/category-commands';
import {
  CreatePresetCommandHandler,
  UpdatePresetCommandHandler,
  DeletePresetCommandHandler,
} from '@src/application/features/config/commands/preset-commands';
import {
  CreateStaffCommandHandler,
  DeleteStaffCommandHandler,
  AssignStaffCategoryCommandHandler,
  UpdateStaffCommandHandler,
} from '@src/application/features/config/commands/staff-commands';
import {
  GetPayersQueryHandler,
  CreatePayerCommandHandler,
  UpdatePayerCommandHandler,
  DeletePayerCommandHandler,
} from '@src/application/features/config/commands/payer-commands';
import { SearchProfessionalsQueryHandler } from '@src/application/features/config/queries/search-professionals-query';
import { UpdateOrganizationCommandHandler } from '@src/application/features/config/commands/update-organization-command';
import {
  CreateActivityTypeCommandHandler,
  UpdateActivityTypeCommandHandler,
  DeleteActivityTypeCommandHandler,
} from '@src/application/features/config/commands/activity-type-commands';
import { DispatcherProvider } from './core/cqrs/dispatcher-provider';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    ConfigController,
    OrgController,
    ProController,
    SystemController,
    ProfileController,
  ],
  providers: [
    GetOrgConfigQueryHandler,
    GetOrganizationQueryHandler,
    CreateCategoryCommandHandler,
    UpdateCategoryCommandHandler,
    DeleteCategoryCommandHandler,
    CreatePresetCommandHandler,
    UpdatePresetCommandHandler,
    DeletePresetCommandHandler,
    UpdateOrganizationCommandHandler,
    CreateStaffCommandHandler,
    DeleteStaffCommandHandler,
    AssignStaffCategoryCommandHandler,
    UpdateStaffCommandHandler,
    GetPayersQueryHandler,
    CreatePayerCommandHandler,
    UpdatePayerCommandHandler,
    DeletePayerCommandHandler,
    SearchProfessionalsQueryHandler,
    DispatcherProvider,
    GetActivityTypesQueryHandler,
    CreateActivityTypeCommandHandler,
    UpdateActivityTypeCommandHandler,
    DeleteActivityTypeCommandHandler,
    PrismaService,
  ],
})
export class ConfigModule { }
