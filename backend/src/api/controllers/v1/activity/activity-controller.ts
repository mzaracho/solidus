import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
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

import { CurrentUserId } from '@src/infrastructure.bootstrap/config/core/authentication/current-user-decorator';

@Controller('activity')
export class ActivityController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.dispatcher.dispatch(new FindActivityByIdQuery(id));
  }

  @Get()
  async findAll(
    @Query() query: FindAllActivitiesQuery,
    @Headers('x-org-id') orgId: string,
    @CurrentUserId() userId: string,
    @Query('mode') modeQuery: string
  ): Promise<any> { // Using any for partial migration or PaginatedActivityResponseDto if verified
    // Or better, import the new DTO
    query.organizationId = orgId || query.organizationId;
    query.userId = userId;
    query.mode = modeQuery; // Frontend sends mode as query param
    return this.dispatcher.dispatch(query);
  }

  @Post()
  async create(
    @Body() command: CreateActivityCommand,
    @Headers('x-mode') mode: string,
    @Headers('x-org-id') orgId: string,
    @CurrentUserId() userId: string,
  ) {
    command.mode = mode; // Manually attach header if needed by logic
    command.organizationId = command.organizationId || orgId;
    command.userId = userId; // Verified `sub` of the token
    return this.dispatcher.dispatch(command);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() command: UpdateActivityCommand,
    @Headers('x-mode') modeHeader: string,
    @CurrentUserId() userId: string,
  ) {
    command.id = id;
    command.userId = userId;
    command.mode = modeHeader;
    return this.dispatcher.dispatch(command);
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Headers('x-mode') modeHeader: string,
    @CurrentUserId() userId: string,
  ) {
    return this.dispatcher.dispatch(new DeleteActivityCommand(id, userId, modeHeader));
  }
}
