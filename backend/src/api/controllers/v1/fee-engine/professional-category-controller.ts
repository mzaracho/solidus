import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Delete,
  Param,
  Inject,
} from '@nestjs/common';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import {
  FindProfessionalCategoriesQuery,
  CreateFeeEngineCategoryCommand,
  DeleteFeeEngineCategoryCommand,
} from '@src/application/features/fee-engine/commands/professional-category-commands';
import { BaseController } from '../../base/base-controller';

@Controller('fee-engine/professional-categories')
export class ProfessionalCategoryController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Get()
  async findAll(@Query() query: FindProfessionalCategoriesQuery) {
    return this.dispatcher.dispatch(query);
  }

  @Post()
  async create(@Body() command: CreateFeeEngineCategoryCommand) {
    return this.dispatcher.dispatch(command);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.dispatcher.dispatch(new DeleteFeeEngineCategoryCommand(id));
  }
}
