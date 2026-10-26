import { Module } from '@nestjs/common';
import { FeeRulesController } from '@src/api/controllers/v1/fee-engine/fee-rules-controller';
import { ProfessionalCategoryController } from '@src/api/controllers/v1/fee-engine/professional-category-controller';
import { FeeResolutionService } from '@src/infrastructure/features/fee-engine/fee-resolution.service';
import { PrismaModule } from '../prisma/prisma-module';
import { DispatcherProvider } from '@src/infrastructure.bootstrap/config/core/cqrs/dispatcher-provider';
import {
  FindFeeRulesQueryHandler,
  CreateFeeRuleCommandHandler,
} from '@src/application/features/fee-engine/commands/fee-rule-commands';

@Module({
  imports: [PrismaModule],
  providers: [
    FeeResolutionService,
    DispatcherProvider,
    FindFeeRulesQueryHandler,
    CreateFeeRuleCommandHandler,
  ],
  controllers: [FeeRulesController, ProfessionalCategoryController],
  exports: [FeeResolutionService],
})
export class FeeEngineModule { }
