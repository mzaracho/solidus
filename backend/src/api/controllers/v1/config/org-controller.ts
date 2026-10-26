import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Headers,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { GetOrgConfigQuery } from '@src/application/features/config/queries/get-org-config-query';
import { GetOrganizationQuery } from '@src/application/features/config/queries/get-organization-query';
import { GetActivityTypesQuery } from '@src/application/features/config/queries/get-activity-types-query';
import { AuthGuard } from '@src/infrastructure.bootstrap/config/providers/auth-guard-provider';
import { OrgRoleGuard, RequireOrgRole } from '@src/infrastructure.bootstrap/guards/org-role-guard';
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
import { BaseController } from '../../base/base-controller';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';

@UseGuards(AuthGuard)
@Controller('org')
export class OrgController extends BaseController {
  constructor(
    @Inject(IDispatcher) private readonly dispatcher: IDispatcher,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  @Put()
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async updateOrganization(
    @Headers('x-org-id') id: string,
    @Body() command: UpdateOrganizationCommand,
  ) {
    command.id = id;
    return this.dispatcher.dispatch(command);
  }

  @Get()
  async getOrganization(@Headers('x-org-id') id: string) {
    return this.dispatcher.dispatch(new GetOrganizationQuery({ orgId: id }));
  }

  @Get('config')
  async getConfig(
    @Headers('x-org-id') orgId: string,
    @Query() query: GetOrgConfigQuery,
  ) {
    query.orgId = orgId;
    return this.dispatcher.dispatch(query);
  }

  // ─── CATEGORIES ──────────────────────────────────────────────────────────────

  @Post('categories')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async createCategory(
    @Headers('x-org-id') orgId: string,
    @Body() command: CreateCategoryCommand,
  ) {
    command.orgId = orgId;
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
  async createPreset(
    @Headers('x-org-id') orgId: string,
    @Body() command: CreatePresetCommand,
  ) {
    command.orgId = orgId;
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
  async addStaff(
    @Headers('x-org-id') orgId: string,
    @Body() command: CreateStaffCommand,
  ) {
    command.orgId = orgId;
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
   * Looks up whether a CUIT belongs to an existing Organization or Professional.
   * Used when adding a new staff member to warn/link automatically.
   */
  @Get('staff/lookup')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async lookupStaffByCuit(@Query('cuit') cuit: string) {
    if (!cuit) return { type: 'NOT_FOUND' };

    const org = await this.prisma.organization.findFirst({ where: { cuit } });
    if (org) {
      return { type: 'ORGANIZATION', id: org.id, name: org.name };
    }

    const pro = await this.prisma.professional.findFirst({
      where: { cuit, deletedAt: null },
      include: { organization: true },
    });
    if (pro) {
      return {
        type: 'PROFESSIONAL',
        id: pro.id,
        name: pro.displayName,
        email: pro.email,
        phone: pro.phone,
        hasUser: !!pro.userId,
      };
    }

    return { type: 'NOT_FOUND' };
  }

  // ─── ACTIVITY TYPES ──────────────────────────────────────────────────────────

  @Get('activity-types')
  async getActivityTypes(@Headers('x-org-id') orgId: string) {
    return this.dispatcher.dispatch(new GetActivityTypesQuery(orgId));
  }

  @Post('activity-types')
  @RequireOrgRole('ADMIN')
  @UseGuards(OrgRoleGuard)
  async createActivityType(
    @Headers('x-org-id') orgId: string,
    @Body() command: CreateActivityTypeCommand,
  ) {
    command.orgId = orgId;
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
