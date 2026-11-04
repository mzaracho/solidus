import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { GetOrgConfigQuery } from '@src/application/features/config/queries/get-org-config-query';
import { GetOrganizationQuery } from '@src/application/features/config/queries/get-organization-query';
import { GetActivityTypesQuery } from '@src/application/features/config/queries/get-activity-types-query';
import {
  OrgRoleGuard,
  RequireOrgRole,
} from '@src/infrastructure.bootstrap/guards/org-role-guard';
import { CreateCategoryCommand } from '@src/application/features/config/commands/category-commands';
import { CreatePresetCommand } from '@src/application/features/config/commands/preset-commands';
import { CreateStaffCommand } from '@src/application/features/config/commands/staff-commands';
import {
  UpdateCategoryCommand,
  DeleteCategoryCommand,
} from '@src/application/features/config/commands/category-commands';
import {
  UpdatePresetCommand,
  DeletePresetCommand,
} from '@src/application/features/config/commands/preset-commands';
import {
  DeleteStaffCommand,
  AssignStaffCategoryCommand,
  UpdateStaffCommand,
} from '@src/application/features/config/commands/staff-commands';
import {
  CreateActivityTypeCommand,
  UpdateActivityTypeCommand,
  DeleteActivityTypeCommand,
} from '@src/application/features/config/commands/activity-type-commands';
import { UpdateOrganizationCommand } from '@src/application/features/config/commands/update-organization-command';
import { LookupStaffByCuitQuery } from '@src/application/features/config/queries/lookup-staff-by-cuit-query';
import { LookupStaffByCuitQueryDto } from '@src/application/features/config/Dtos/lookup-staff-by-cuit-query.dto';
import { BaseController } from '../../base/base-controller';
import { CurrentOrgId } from '@src/infrastructure.bootstrap/config/core/authentication/current-org-decorator';

@Controller('org')
export class OrgController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Put()
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async updateOrganization(
    @CurrentOrgId() id: string,
    @Body() command: UpdateOrganizationCommand,
  ) {
    command.id = id;
    return this.dispatcher.dispatch(command);
  }

  @Get()
  async getOrganization(@CurrentOrgId() id: string) {
    return this.dispatcher.dispatch(new GetOrganizationQuery({ orgId: id }));
  }

  @Get('config')
  async getConfig(@CurrentOrgId() orgId: string) {
    const query = new GetOrgConfigQuery();
    query.orgId = orgId;
    return this.dispatcher.dispatch(query);
  }

  // ─── CATEGORIES ──────────────────────────────────────────────────────────────

  @Post('categories')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async createCategory(@Body() command: CreateCategoryCommand) {
    return this.dispatcher.dispatch(command);
  }

  @Put('categories/:id')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async updateCategory(
    @Param('id') id: string,
    @Body() command: UpdateCategoryCommand,
  ) {
    command.id = id;
    return this.dispatcher.dispatch(command);
  }

  @Delete('categories/:id')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async deleteCategory(@Param('id') id: string) {
    return this.dispatcher.dispatch(new DeleteCategoryCommand(id));
  }

  // ─── PRESETS ─────────────────────────────────────────────────────────────────

  @Post('presets')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async createPreset(@Body() command: CreatePresetCommand) {
    return this.dispatcher.dispatch(command);
  }

  @Put('presets/:id')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async updatePreset(
    @Param('id') id: string,
    @Body() command: UpdatePresetCommand,
  ) {
    command.id = id;
    return this.dispatcher.dispatch(command);
  }

  @Delete('presets/:id')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async deletePreset(@Param('id') id: string) {
    return this.dispatcher.dispatch(new DeletePresetCommand(id));
  }

  // ─── STAFF ───────────────────────────────────────────────────────────────────

  @Post('staff')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async addStaff(@Body() command: CreateStaffCommand) {
    return this.dispatcher.dispatch(command);
  }

  @Put('staff/:id')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async updateStaff(
    @Param('id') id: string,
    @Body() command: UpdateStaffCommand,
  ) {
    command.id = id;
    return this.dispatcher.dispatch(command);
  }

  @Put('staff/:id/category')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async assignCategory(
    @Param('id') id: string,
    @Body() command: AssignStaffCategoryCommand,
  ) {
    command.id = id;
    return this.dispatcher.dispatch(command);
  }

  @Delete('staff/:id')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async removeStaff(@Param('id') id: string) {
    return this.dispatcher.dispatch(new DeleteStaffCommand(id));
  }

  /**
   * GET /org/staff/lookup?cuit=:cuit
   * Busca un profesional por CUIT solo dentro de la organización del request (respuesta mínima).
   */
  @Get('staff/lookup')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async lookupStaffByCuit(@Query() query: LookupStaffByCuitQueryDto) {
    return this.dispatcher.dispatch(new LookupStaffByCuitQuery(query.cuit));
  }

  // ─── ACTIVITY TYPES ──────────────────────────────────────────────────────────

  @Get('activity-types')
  async getActivityTypes(@CurrentOrgId() orgId: string) {
    return this.dispatcher.dispatch(new GetActivityTypesQuery(orgId));
  }

  @Post('activity-types')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async createActivityType(@Body() command: CreateActivityTypeCommand) {
    return this.dispatcher.dispatch(command);
  }

  @Put('activity-types/:id')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async updateActivityType(
    @Param('id') id: string,
    @Body() command: UpdateActivityTypeCommand,
  ) {
    command.id = id;
    return this.dispatcher.dispatch(command);
  }

  @Delete('activity-types/:id')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async deleteActivityType(@Param('id') id: string) {
    return this.dispatcher.dispatch(new DeleteActivityTypeCommand(id));
  }
}
