import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Inject,
} from '@nestjs/common';
import { ActivityResponseDto } from '@src/application/features/activity/Dtos/activity-response.dto';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { FindAllActivitiesQuery } from '@src/application/features/activity/queries/find-all-activities-query';
import { FindActivityByIdQuery } from '@src/application/features/activity/queries/find-activity-by-id-query';
import { CreateActivityCommand } from '@src/application/features/activity/commands/create-activity-command';
import { UpdateActivityCommand } from '@src/application/features/activity/commands/update-activity-command';
import { DeleteActivityCommand } from '@src/application/features/activity/commands/delete-activity-command';
import { BaseController } from '../../base/base-controller';

import { UsesViewMode } from '@src/infrastructure.bootstrap/config/core/authentication/view-mode-decorator';
import { CurrentOrgId } from '@src/infrastructure.bootstrap/config/core/authentication/current-org-decorator';

@Controller('activity')
export class ActivityController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.dispatcher.dispatch(new FindActivityByIdQuery(id));
  }

  // El modo (org/pro) lo resuelve ViewModeGuard desde los vinculos del usuario: llega en ctx.view.
  @UsesViewMode()
  @Get()
  async findAll(
    @Query() query: FindAllActivitiesQuery,
    @CurrentOrgId() orgId: string,
  ): Promise<any> {
    query.organizationId = orgId;
    return this.dispatcher.dispatch(query);
  }

  @UsesViewMode()
  @Post()
  async create(
    @Body() command: CreateActivityCommand,
    @CurrentOrgId() orgId: string,
  ) {
    command.organizationId = command.organizationId || orgId;
    return this.dispatcher.dispatch(command);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() command: UpdateActivityCommand,
  ) {
    command.id = id;
    return this.dispatcher.dispatch(command);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.dispatcher.dispatch(new DeleteActivityCommand(id));
  }
}
