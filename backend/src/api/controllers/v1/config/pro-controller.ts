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
import {
  CreatePayerCommand,
  UpdatePayerCommand,
  DeletePayerCommand,
  GetPayersQuery,
} from '@src/application/features/config/commands/payer-commands';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { BaseController } from '../../base/base-controller';
import { AuthGuard } from '@src/infrastructure.bootstrap/config/providers/auth-guard-provider';

@UseGuards(AuthGuard)
@Controller('pro')
export class ProController extends BaseController {
  constructor(
    @Inject(IDispatcher) private readonly dispatcher: IDispatcher,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  /**
   * GET /pro/context
   * Returns the professional record for the currently authenticated user within the given org.
   * Used by the Pro UI to determine canLoadActivities and other permissions.
   */
  @Get('context')
  async getContext(
    @Headers('x-org-id') orgId: string,
    @Headers('x-user-id') userId: string,
  ) {
    if (!userId || !orgId) return null;

    const professional = await this.prisma.professional.findFirst({
      where: { userId, organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        displayName: true,
        cuit: true,
        phone: true,
        email: true,
        canLoadActivities: true,
        userId: true,
        categoryId: true,
        category: {
          select: { id: true, name: true, percentage: true },
        },
      },
    });

    return professional ?? null;
  }

  /**
   * GET /pro/memberships
   * Returns all organizations where the authenticated user has a Professional record,
   * along with their assigned category name and percentage.
   */
  @Get('memberships')
  async getMemberships(
    @Headers('x-user-id') userId: string,
  ) {
    if (!userId) return [];

    const professionals = await this.prisma.professional.findMany({
      where: { userId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        canLoadActivities: true,
        organization: {
          select: { id: true, name: true, type: true },
        },
        category: {
          select: { id: true, name: true, percentage: true },
        },
      },
    });

    // Exclude SOLO_PRACTICE orgs — those are the professional's own private org,
    // not an external organization managing their fees
    return professionals
      .filter((p) => p.organization.type !== 'SOLO_PRACTICE')
      .map((p) => ({
        orgId: p.organizationId,
        orgName: p.organization.name,
        professionalId: p.id,
        canLoadActivities: p.canLoadActivities,
        categoryId: p.category?.id ?? null,
        categoryName: p.category?.name ?? null,
        categoryPercentage: p.category?.percentage ?? null,
      }));
  }

  /**
   * PUT /pro/profile
   * Updates the professional's profile details.
   */
  @Put('profile')
  async updateProfile(
    @Headers('x-org-id') orgId: string,
    @Headers('x-user-id') userId: string,
    @Body() data: { displayName?: string; cuit?: string; phone?: string; email?: string },
  ) {
    if (!userId || !orgId) return null;

    const professional = await this.prisma.professional.findFirst({
      where: { userId, organizationId: orgId, deletedAt: null },
    });

    if (!professional) {
      return null;
    }

    return this.prisma.professional.update({
      where: { id: professional.id },
      data: {
        displayName: data.displayName,
        cuit: data.cuit,
        phone: data.phone,
        email: data.email,
      },
    });
  }

  @Get('payers/lookup')
  async lookupPayerByCuit(@Query('cuit') cuit: string) {
    if (!cuit) return { type: 'FREE' };

    // Check if the CUIT belongs to a registered Organization
    const org = await this.prisma.organization.findFirst({ where: { cuit } });
    if (org) {
      return { type: 'ORGANIZATION', name: org.name, id: org.id };
    }

    return { type: 'FREE' };
  }

  @Get('payers')
  async getPayers(
    @Headers('x-org-id') orgId: string,
    @Headers('x-user-id') userId: string,
    @Query() query: GetPayersQuery,
  ) {
    console.log('GET /pro/payers hit', { orgId, userId, query });
    query.orgId = orgId;
    query.userId = userId;
    const result = await this.dispatcher.dispatch(query);
    console.log('GET /pro/payers result count:', (result as any)?.length);
    return result;
  }

  @Post('payers')
  async createPayer(
    @Headers('x-org-id') orgId: string,
    @Headers('x-user-id') userId: string,
    @Body() command: CreatePayerCommand,
  ) {
    command.orgId = orgId;
    command.userId = userId;
    return this.dispatcher.dispatch(command);
  }
  @Put('payers/:id')
  async updatePayer(
    @Param('id') id: string,
    @Body() command: UpdatePayerCommand,
  ) {
    command.id = id;
    return this.dispatcher.dispatch(command);
  }

  @Delete('payers/:id')
  async deletePayer(@Param('id') id: string) {
    return this.dispatcher.dispatch(new DeletePayerCommand(id));
  }
}
