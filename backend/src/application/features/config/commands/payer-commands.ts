import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { CreatePayerDto } from '../Dtos/create-payer.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { Payer } from '@prisma/client';
import { requireOrgScope, requireOrgId, RequestContext, roleIn, OrgScope } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { forbiddenAction, foundOr404, inScope, requireId } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

/**
 * Pagador de la organización del request. Lo modifica el ADMIN de la organización del pagador
 * o el dueño del pagador (Payer.professionalId -> Professional.userId = sub). Si no existe o es de
 * otra organización: 404 genérico (antes de decidir el permiso).
 */
async function loadPayerForWrite(
  prisma: PrismaService,
  scope: OrgScope,
  rawId: string,
): Promise<{ id: string }> {
  const id = requireId(rawId);
  const payer = await foundOr404(
    prisma.payer.findFirst({
      where: { id, ...inScope(scope) },
      select: {
        id: true,
        organizationId: true,
        professional: { select: { userId: true } },
      },
    }),
  );
  const isAdmin = roleIn(scope, payer.organizationId) === 'ADMIN';
  const isOwner = !!payer.professional?.userId && payer.professional.userId === scope.userId;
  if (!isAdmin && !isOwner) throw forbiddenAction();
  return { id };
}

// Get
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

// Get
// Get
export class GetPayersQuery implements IRequest<{ items: Payer[]; total: number }> {
  @ApiProperty()
  @IsString()
  @IsOptional()
  orgId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;
}

@RequestHandler(GetPayersQuery)
@Injectable()
export class GetPayersQueryHandler implements IRequestHandler<
  GetPayersQuery,
  { items: Payer[]; total: number }
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(query: GetPayersQuery): Promise<{ items: Payer[]; total: number }> {
    const orgId = requireOrgId(query.orgId);
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 12;
    const skip = (page - 1) * limit;

    let professionalId: string | undefined;

    // Resolve Professional if userId is provided
    if (query.userId) {
      const professional = await this.prisma.professional.findFirst({
        where: {
          userId: query.userId,
          organizationId: orgId
        }
      });
      professionalId = professional?.id;
    }

    // Filter Logic:
    // 1. Belong to Org
    // 2. AND (Managed by System OR Created by ME)
    const whereCondition: any = {
      organizationId: orgId,
    };

    if (professionalId) {
      whereCondition.OR = [
        { isManagedBySystem: true },
        { professionalId: professionalId }
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.payer.findMany({
        where: whereCondition,
        skip,
        take: limit,
        orderBy: { name: 'asc' }
      }),
      this.prisma.payer.count({
        where: whereCondition,
      }),
    ]);

    return { items, total };
  }
}

// Create
export class CreatePayerCommand implements IRequest<Payer> {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orgId?: string; // Se ignora: la organización y el usuario salen del contexto validado

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cuit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  retentionPercentage?: number;
}

@RequestHandler(CreatePayerCommand)
@Injectable()
export class CreatePayerCommandHandler implements IRequestHandler<
  CreatePayerCommand,
  Payer
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: CreatePayerCommand, ctx: RequestContext): Promise<Payer> {
    const scope = requireOrgScope(ctx);
    const orgId = scope.primaryOrgId;

    // Validate: if a CUIT is provided and it belongs to a registered Organization, block the creation
    if (command.cuit) {
      const existingOrg = await this.prisma.organization.findFirst({ where: { cuit: command.cuit } });
      if (existingOrg) {
        throw new BadRequestException({
          code: 'bad-request',
          message:
            'Ese CUIT pertenece a una organización registrada: la asociación se gestiona con ella directamente.',
        });
      }
    }

    // El pagador es propio si el usuario tiene Professional en la organización; si no, es de la
    // organización y solo lo crea un ADMIN.
    const professional = await this.prisma.professional.findFirst({
      where: {
        userId: scope.userId,
        organizationId: orgId,
        deletedAt: null,
      }
    });
    const professionalId = professional?.id;
    if (!professionalId && roleIn(scope, orgId) !== 'ADMIN') {
      throw forbiddenAction();
    }

    return this.prisma.payer.create({
      data: {
        organizationId: orgId,
        name: command.name,
        cuit: command.cuit ?? null,
        retentionPercentage: command.retentionPercentage || 0,
        professionalId: professionalId,
        isManagedBySystem: !professionalId,
      },
    });
  }
}

// Update
export class UpdatePayerCommand implements IRequest<Payer> {
  id: string; // Param

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  retentionPercentage?: number;
}

@RequestHandler(UpdatePayerCommand)
@Injectable()
export class UpdatePayerCommandHandler implements IRequestHandler<
  UpdatePayerCommand,
  Payer
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: UpdatePayerCommand, ctx: RequestContext): Promise<Payer> {
    const scope = requireOrgScope(ctx);
    const { id } = await loadPayerForWrite(this.prisma, scope, command.id);
    return this.prisma.payer.update({
      where: { id },
      data: {
        name: command.name,
        retentionPercentage: command.retentionPercentage,
      },
    });
  }
}

// Delete
export class DeletePayerCommand implements IRequest<Payer> {
  constructor(public readonly id: string) { }
}

@RequestHandler(DeletePayerCommand)
@Injectable()
export class DeletePayerCommandHandler implements IRequestHandler<
  DeletePayerCommand,
  Payer
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: DeletePayerCommand, ctx: RequestContext): Promise<Payer> {
    const scope = requireOrgScope(ctx);
    const { id } = await loadPayerForWrite(this.prisma, scope, command.id);
    return this.prisma.payer.delete({ where: { id } });
  }
}
