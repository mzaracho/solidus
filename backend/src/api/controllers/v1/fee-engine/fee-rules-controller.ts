import { Controller, Get, Post, Body, Query, Inject, Headers, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import {
  FindFeeRulesQuery,
  CreateFeeRuleCommand,
} from '@src/application/features/fee-engine/commands/fee-rule-commands';
import { BaseController } from '../../base/base-controller';
import { AuthGuard } from '@src/infrastructure.bootstrap/config/providers/auth-guard-provider';

@UseGuards(AuthGuard)
@Controller('fee-rules')
export class FeeRulesController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get()
  async findAll(
    @Headers('x-org-id') orgId: string,
    @Headers('x-user-id') userId: string,
    @Query() query: FindFeeRulesQuery,
  ) {
    query.organizationId = orgId;
    query.userId = userId;
    return this.dispatcher.dispatch(query);
  }

  @Post()
  async create(
    @Headers('x-org-id') orgId: string,
    @Body() data: Prisma.FeeRuleCreateInput,
  ) {
    const command = new CreateFeeRuleCommand();
    command.data = {
      ...data,
      organization: { connect: { id: orgId } },
    };
    return this.dispatcher.dispatch(command);
  }
}
