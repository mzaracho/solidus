import { Controller, Get, Post, Body, Query, Inject } from '@nestjs/common';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import {
  FindFeeRulesQuery,
  CreateFeeRuleCommand,
  CreateFeeRuleDto,
} from '@src/application/features/fee-engine/commands/fee-rule-commands';
import { BaseController } from '../../base/base-controller';
import { CurrentUserId } from '@src/infrastructure.bootstrap/config/core/authentication/current-user-decorator';
import { CurrentOrgId } from '@src/infrastructure.bootstrap/config/core/authentication/current-org-decorator';

@Controller('fee-rules')
export class FeeRulesController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get()
  async findAll(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Query() query: FindFeeRulesQuery,
  ) {
    query.organizationId = orgId;
    query.userId = userId;
    return this.dispatcher.dispatch(query);
  }

  @Post()
  async create(@Body() data: CreateFeeRuleDto) {
    const command = new CreateFeeRuleCommand();
    command.data = data;
    return this.dispatcher.dispatch(command);
  }
}
