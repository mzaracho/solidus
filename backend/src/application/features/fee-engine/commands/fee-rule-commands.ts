import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsString, IsOptional } from 'class-validator';
import { FeeRule, Prisma } from '@prisma/client';

// Get
export class FindFeeRulesQuery implements IRequest<FeeRule[]> {
  @ApiProperty()
  @IsString()
  @IsOptional()
  organizationId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;
}

@RequestHandler(FindFeeRulesQuery)
@Injectable()
export class FindFeeRulesQueryHandler implements IRequestHandler<
  FindFeeRulesQuery,
  FeeRule[]
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(query: FindFeeRulesQuery): Promise<FeeRule[]> {
    if (!query.organizationId) return [];

    let categoryFilter: any = undefined;

    // If userId provided (Professional Context), find their category
    if (query.userId) {
      const professional = await this.prisma.professional.findFirst({
        where: {
          userId: query.userId,
          organizationId: query.organizationId
        },
        include: { category: true }
      });

      if (professional) {
        // Filter rules that match this category OR are general (null)
        // Matching by NAME as per schema comment
        const categoryName = professional.category?.name;

        categoryFilter = {
          OR: [
            { professionalCategory: categoryName },
            { professionalCategory: null },
            { professionalCategory: 'all' } // Explicitly match 'all' for general rules
          ]
        };
      }
    }

    const where: any = {
      organizationId: query.organizationId,
      ...(categoryFilter ? categoryFilter : {})
    };

    return this.prisma.feeRule.findMany({
      where // splits is a JSON field, no need to include locally
    });
  }
}

// Create
export class CreateFeeRuleCommand implements IRequest<FeeRule> {
  @ApiProperty()
  @IsObject()
  data: Prisma.FeeRuleCreateInput;
}

@RequestHandler(CreateFeeRuleCommand)
@Injectable()
export class CreateFeeRuleCommandHandler implements IRequestHandler<
  CreateFeeRuleCommand,
  FeeRule
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: CreateFeeRuleCommand): Promise<FeeRule> {
    const { organization, payer, professionalCategory, splits } = command.data as any;

    // 1. Try to find existing rule for this Payer in this Org
    // We assume 1 Rule per Payer for the MVP Simple Settings
    const existingRule = await this.prisma.feeRule.findFirst({
      where: {
        organizationId: organization?.connect?.id,
        payerId: payer?.connect?.id,
        // Assuming we are only dealing with Professional Category 'null' (General) or specific passed one
        // specific mismatch might occur if we get stricter, but for now:
        professionalCategory: professionalCategory
      }
    });

    if (existingRule) {
      // Update
      return this.prisma.feeRule.update({
        where: { id: existingRule.id },
        data: {
          splits: splits
        }
      });
    }

    // Create
    return this.prisma.feeRule.create({
      data: command.data,
    });
  }
}
