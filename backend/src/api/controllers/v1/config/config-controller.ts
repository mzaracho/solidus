import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  Param,
  Headers,
  Inject,
} from '@nestjs/common';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import {
  GetDictionariesQuery,
  GetOrgRulesQuery,
  GetProRulesQuery,
  UpdateOrgRulesCommand,
} from '@src/application/features/config/queries/config-general-queries';
import { GetActivityTypesQuery } from '@src/application/features/config/queries/get-activity-types-query';
import {
  CreateCategoryCommand,
  UpdateCategoryCommand,
  DeleteCategoryCommand,
} from '@src/application/features/config/commands/category-commands';
import {
  CreateActivityTypeCommand,
  UpdateActivityTypeCommand,
  DeleteActivityTypeCommand,
} from '@src/application/features/config/commands/activity-type-commands';
import { BaseController } from '../../base/base-controller';

@Controller('config')
export class ConfigController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get('dictionaries')
  getDictionaries() {
    return this.dispatcher.dispatch(new GetDictionariesQuery());
  }

  @Get('org-rules')
  async getOrgRules(@Query() query: GetOrgRulesQuery) {
    return this.dispatcher.dispatch(query);
  }

  @Put('org-rules')
  async updateOrgRules(
    @Headers('x-org-id') orgId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const command = new UpdateOrgRulesCommand();
    command.orgId = orgId;
    command.body = body;
    return this.dispatcher.dispatch(command);
  }

  @Get('pro-rules')
  async getProRules(@Query() query: GetProRulesQuery) {
    return this.dispatcher.dispatch(query);
  }

  @Get('activity-types')
  async getActivityTypes(
    @Headers('x-org-id') orgIdHeader?: string,
    @Query('orgId') orgIdQuery?: string,
  ) {
    // Prefer the x-org-id header (validated UUID) over the query param (may be a URL slug)
    const orgId = orgIdHeader || undefined;
    return this.dispatcher.dispatch(new GetActivityTypesQuery(orgId));
  }

  // --- Category CRUD ---

  @Post('categories')
  async createCategory(
    @Headers('x-org-id') orgId: string,
    @Body() body: { name: string; percentage?: number },
  ) {
    const command = new CreateCategoryCommand();
    command.orgId = orgId;
    command.name = body.name;
    command.percentage = body.percentage;
    return this.dispatcher.dispatch(command);
  }

  @Put('categories/:id')
  async updateCategory(
    @Param('id') id: string,
    @Body() body: { name: string; percentage?: number },
  ) {
    const command = new UpdateCategoryCommand();
    command.id = id;
    command.name = body.name;
    command.percentage = body.percentage;
    return this.dispatcher.dispatch(command);
  }

  @Delete('categories/:id')
  async deleteCategory(@Param('id') id: string) {
    return this.dispatcher.dispatch(new DeleteCategoryCommand(id));
  }

  // --- Activity Type CRUD ---

  @Post('activity-types')
  async createActivityType(
    @Headers('x-org-id') orgId: string,
    @Body() body: { code: string; name: string; baseValue?: number; cardValue?: number; roles?: any[] },
  ) {
    const command = new CreateActivityTypeCommand();
    command.orgId = orgId;
    command.code = body.code;
    command.name = body.name;
    command.baseValue = body.baseValue;
    command.cardValue = body.cardValue;
    command.roles = body.roles;
    return this.dispatcher.dispatch(command);
  }

  @Put('activity-types/:id')
  async updateActivityType(
    @Param('id') id: string,
    @Body() body: { name?: string; baseValue?: number; cardValue?: number; roles?: any[] },
  ) {
    const command = new UpdateActivityTypeCommand();
    command.id = id;
    command.name = body.name;
    command.baseValue = body.baseValue;
    command.cardValue = body.cardValue;
    command.roles = body.roles;
    return this.dispatcher.dispatch(command);
  }

  @Delete('activity-types/:id')
  async deleteActivityType(@Param('id') id: string) {
    return this.dispatcher.dispatch(new DeleteActivityTypeCommand(id));
  }
}
