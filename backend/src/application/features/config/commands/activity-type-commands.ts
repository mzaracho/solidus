import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ActivityType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import {
  IsMoney,
  IsOptionalNotNull,
  IsPercentage,
} from '@src/infrastructure.bootstrap/config/core/validation/dto-validators';
import { Type } from 'class-transformer';
import { requireOrgScope, RequestContext } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { foundOr404, inScope, requireId } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';
import { FEE_STRATEGY, MAX_ACTIVITY_TYPE_ROLES_INPUT, MAX_ROLES_PER_ACTIVITY_TYPE } from '@src/domain/constants/app.constants';
import type { FeeStrategy } from '@src/domain/constants/app.constants';

// DTO for a single role configuration within an ActivityType
export class ActivityTypeRoleDto {
  @ApiProperty({ description: 'Role label, e.g. "Profesional", "Admisor", "Coadmisor"' })
  @IsString()
  @MaxLength(100)
  roleLabel: string;

  /** Roles guardados antes del 014 pueden no traerlo: si falta, el handler guarda `false`. */
  @ApiPropertyOptional({ description: 'Whether this role is required when loading an activity (default false)' })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  /** Si falta, el handler guarda CATEGORY (el valor por defecto de la UI). */
  @ApiPropertyOptional({ enum: Object.values(FEE_STRATEGY) })
  @IsOptional()
  @IsEnum(FEE_STRATEGY)
  feeStrategy?: FeeStrategy;

  @ApiPropertyOptional({ description: 'Percentage to assign (0-100) when feeStrategy is FIXED' })
  @IsOptional()
  @IsPercentage()
  fixedPercentage?: number;
}

/**
 * Forma guardada de cada rol (ActivityType.roles es Json): { roleLabel, isRequired, feeStrategy, fixedPercentage? }.
 * Guarda solo esas 4 claves. Los defaults replican la lectura actual de ActivityService (no cambian montos):
 * `isRequired` ausente = true (`isRequired ?? true`, igual que EMPTY_ROLE de la UI) y `feeStrategy` ausente se
 * guarda SIN la clave (ActivityService calcula honorario 0 en ese caso).
 */
export function normalizeActivityTypeRoles(roles: ActivityTypeRoleDto[]) {
  return roles.map((role) => ({
    roleLabel: role.roleLabel,
    isRequired: role.isRequired ?? true,
    ...(role.feeStrategy != null && { feeStrategy: role.feeStrategy }),
    ...(role.fixedPercentage != null && {
      fixedPercentage: role.fixedPercentage,
    }),
  }));
}

// ─── CREATE ────────────────────────────────────────────────────────────────────

export class CreateActivityTypeCommand implements IRequest<ActivityType> {
  @ApiProperty()
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  baseValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  cardValue?: number;

  @ApiPropertyOptional({ type: [ActivityTypeRoleDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ACTIVITY_TYPE_ROLES_INPUT)
  @ValidateNested({ each: true })
  @Type(() => ActivityTypeRoleDto)
  roles?: ActivityTypeRoleDto[];
}

@RequestHandler(CreateActivityTypeCommand)
@Injectable()
export class CreateActivityTypeCommandHandler implements IRequestHandler<CreateActivityTypeCommand, ActivityType> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: CreateActivityTypeCommand, ctx: RequestContext): Promise<ActivityType> {
    const scope = requireOrgScope(ctx);
    // Validate roles count (max MAX_ROLES_PER_ACTIVITY_TYPE)
    if (command.roles && command.roles.length > MAX_ROLES_PER_ACTIVITY_TYPE) {
      throw new BadRequestException({
        code: 'bad-request',
        message: `Una prestación puede tener como máximo ${MAX_ROLES_PER_ACTIVITY_TYPE} roles.`,
      });
    }

    // Validate FIXED roles have a percentage
    if (command.roles) {
      for (const role of command.roles) {
        if (role.feeStrategy === FEE_STRATEGY.FIXED && (role.fixedPercentage === undefined || role.fixedPercentage === null)) {
          throw new BadRequestException({
            code: 'bad-request',
            message: 'Un rol con porcentaje fijo no tiene porcentaje definido.',
          });
        }
      }
    }

    return this.prisma.activityType.create({
      data: {
        organizationId: scope.primaryOrgId,
        code: command.code.toLowerCase().replace(/\s+/g, '_'),
        name: command.name,
        baseValue: command.baseValue != null ? command.baseValue : undefined,
        cardValue: command.cardValue != null ? command.cardValue : undefined,
        roles: normalizeActivityTypeRoles(command.roles ?? []) as any,
      },
    });
  }
}

// ─── UPDATE ────────────────────────────────────────────────────────────────────

export class UpdateActivityTypeCommand implements IRequest<ActivityType> {
  /** Lo asigna el controlador desde el path; el cliente no lo manda (400). */
  declare id: string;

  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  baseValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  cardValue?: number;

  @ApiPropertyOptional({ type: [ActivityTypeRoleDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ACTIVITY_TYPE_ROLES_INPUT)
  @ValidateNested({ each: true })
  @Type(() => ActivityTypeRoleDto)
  roles?: ActivityTypeRoleDto[];
}

@RequestHandler(UpdateActivityTypeCommand)
@Injectable()
export class UpdateActivityTypeCommandHandler implements IRequestHandler<UpdateActivityTypeCommand, ActivityType> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: UpdateActivityTypeCommand, ctx: RequestContext): Promise<ActivityType> {
    const scope = requireOrgScope(ctx);
    const id = requireId(command.id);
    // Los tipos por defecto del sistema (organizationId null) no entran en el scope: 404
    await foundOr404(
      this.prisma.activityType.findFirst({
        where: { id, ...inScope(scope) },
        select: { id: true },
      }),
    );
    if (command.roles && command.roles.length > MAX_ROLES_PER_ACTIVITY_TYPE) {
      throw new BadRequestException({
        code: 'bad-request',
        message: `Una prestación puede tener como máximo ${MAX_ROLES_PER_ACTIVITY_TYPE} roles.`,
      });
    }

    const data: any = {};
    if (command.name !== undefined) data.name = command.name;
    if (command.baseValue !== undefined) data.baseValue = command.baseValue;
    if (command.cardValue !== undefined) data.cardValue = command.cardValue;
    if (command.roles !== undefined) data.roles = normalizeActivityTypeRoles(command.roles) as any;

    return this.prisma.activityType.update({
      where: { id },
      data,
    });
  }
}

// ─── DELETE ────────────────────────────────────────────────────────────────────

export class DeleteActivityTypeCommand implements IRequest<ActivityType> {
  constructor(public readonly id: string) {}
}

@RequestHandler(DeleteActivityTypeCommand)
@Injectable()
export class DeleteActivityTypeCommandHandler implements IRequestHandler<DeleteActivityTypeCommand, ActivityType> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: DeleteActivityTypeCommand, ctx: RequestContext): Promise<ActivityType> {
    const scope = requireOrgScope(ctx);
    const id = requireId(command.id);
    // El control de pertenencia va antes del conteo: no se revelan usos de otra organización
    await foundOr404(
      this.prisma.activityType.findFirst({
        where: { id, ...inScope(scope) },
        select: { id: true },
      }),
    );

    // Check for existing WorkItems using this ActivityType
    const usageCount = await this.prisma.workItem.count({
      where: { activityTypeId: id },
    });

    if (usageCount > 0) {
      throw new ConflictException({
        code: 'conflict',
        message: `No se puede eliminar esta actividad porque tiene ${usageCount} registro(s) asociado(s).`,
      });
    }

    return this.prisma.activityType.delete({ where: { id } });
  }
}
