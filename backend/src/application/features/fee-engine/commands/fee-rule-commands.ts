import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsObject, IsString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { FeeRule, Prisma } from '@prisma/client';
import { requireOrgScope, RequestContext, roleIn } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { validateFeeRuleSplits } from '../fee-rule-splits';
import { forbiddenAction, foundOr404, inOrg, optionalId } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

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

class FeeRulePayerConnectDto {
  @ApiProperty()
  @IsString()
  id: string;
}

class FeeRulePayerRefDto {
  @ApiPropertyOptional({ type: FeeRulePayerConnectDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FeeRulePayerConnectDto)
  connect?: FeeRulePayerConnectDto;
}

/** Body de POST fee-rules. Solo estos campos llegan a Prisma: cualquier otra clave se ignora. */
export class CreateFeeRuleDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Alternativa a payer.connect.id' })
  @IsOptional()
  @IsString()
  payerId?: string;

  @ApiPropertyOptional({ type: FeeRulePayerRefDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FeeRulePayerRefDto)
  payer?: FeeRulePayerRefDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  professionalCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serviceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conditionProfessionalRole?: string;

  @ApiProperty({ description: 'Definición de splits (JSON)' })
  @IsDefined()
  splits: Prisma.InputJsonValue;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  validTo?: string;
}

export class CreateFeeRuleCommand implements IRequest<FeeRule> {
  @ApiProperty()
  @IsObject()
  data: CreateFeeRuleDto;
}

@RequestHandler(CreateFeeRuleCommand)
@Injectable()
export class CreateFeeRuleCommandHandler implements IRequestHandler<
  CreateFeeRuleCommand,
  FeeRule
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: CreateFeeRuleCommand, ctx: RequestContext): Promise<FeeRule> {
    const scope = requireOrgScope(ctx);
    const orgId = scope.primaryOrgId;
    const dto = command.data;

    // 1. Pagador referenciado: tiene que ser de la organización del request
    const payerId = optionalId(dto.payer?.connect?.id ?? dto.payerId);
    let payerOwnerUserId: string | null = null;
    if (payerId) {
      const payer = await foundOr404(
        this.prisma.payer.findFirst({
          where: { id: payerId, ...inOrg(orgId) },
          select: { id: true, professional: { select: { userId: true } } },
        }),
      );
      payerOwnerUserId = payer.professional?.userId ?? null;
    }

    // 2. Permiso: ADMIN de la organización, o el dueño del pagador (pagador propio)
    const isAdmin = roleIn(scope, orgId) === 'ADMIN';
    const isPayerOwner = !!payerId && payerOwnerUserId !== null && payerOwnerUserId === scope.userId;
    if (!isAdmin && !isPayerOwner) throw forbiddenAction();

    // 2b. Esquema de splits (crear y editar la regla existente)
    validateFeeRuleSplits(dto.splits);

    // 3. Regla: 1 por pagador en esta organización (MVP de ajustes simples)
    const existingRule = await this.prisma.feeRule.findFirst({
      where: {
        organizationId: orgId,
        payerId: payerId,
        professionalCategory: dto.professionalCategory ?? null,
      }
    });

    if (existingRule) {
      // Update
      return this.prisma.feeRule.update({
        where: { id: existingRule.id },
        data: {
          splits: dto.splits,
        }
      });
    }

    // Create: el data de Prisma se arma con lista blanca
    const data: Prisma.FeeRuleCreateInput = {
      name: dto.name,
      splits: dto.splits,
      organization: { connect: { id: orgId } },
      ...(payerId && { payer: { connect: { id: payerId } } }),
      ...(dto.professionalCategory !== undefined && { professionalCategory: dto.professionalCategory }),
      ...(dto.serviceType !== undefined && { serviceType: dto.serviceType }),
      ...(dto.conditionProfessionalRole !== undefined && { conditionProfessionalRole: dto.conditionProfessionalRole }),
      ...(dto.validFrom && { validFrom: new Date(dto.validFrom) }),
      ...(dto.validTo && { validTo: new Date(dto.validTo) }),
    };
    return this.prisma.feeRule.create({ data });
  }
}
