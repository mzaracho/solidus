import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ActivityType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { FEE_STRATEGY, MAX_ROLES_PER_ACTIVITY_TYPE } from '@src/domain/constants/app.constants';
import type { FeeStrategy } from '@src/domain/constants/app.constants';

// DTO for a single role configuration within an ActivityType
export class ActivityTypeRoleDto {
  @ApiProperty({ description: 'Role label, e.g. "Profesional", "Admisor", "Coadmisor"' })
  @IsString()
  roleLabel: string;

  @ApiProperty({ description: 'Whether this role is required when loading an activity' })
  @IsBoolean()
  isRequired: boolean;

  @ApiProperty({ enum: Object.values(FEE_STRATEGY) })
  @IsString()
  feeStrategy: FeeStrategy;

  @ApiPropertyOptional({ description: 'Percentage to assign (0-100) when feeStrategy is FIXED' })
  @IsOptional()
  @IsNumber()
  fixedPercentage?: number;
}

// ─── CREATE ────────────────────────────────────────────────────────────────────

export class CreateActivityTypeCommand implements IRequest<ActivityType> {
  @IsOptional()
  @IsString()
  orgId: string;

  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  baseValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cardValue?: number;

  @ApiPropertyOptional({ type: [ActivityTypeRoleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActivityTypeRoleDto)
  roles?: ActivityTypeRoleDto[];
}

@RequestHandler(CreateActivityTypeCommand)
@Injectable()
export class CreateActivityTypeCommandHandler implements IRequestHandler<CreateActivityTypeCommand, ActivityType> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: CreateActivityTypeCommand): Promise<ActivityType> {
    // Validate roles count (max MAX_ROLES_PER_ACTIVITY_TYPE)
    if (command.roles && command.roles.length > MAX_ROLES_PER_ACTIVITY_TYPE) {
      throw new BadRequestException(`An activity type can have at most ${MAX_ROLES_PER_ACTIVITY_TYPE} roles.`);
    }

    // Validate FIXED roles have a percentage
    if (command.roles) {
      for (const role of command.roles) {
        if (role.feeStrategy === FEE_STRATEGY.FIXED && (role.fixedPercentage === undefined || role.fixedPercentage === null)) {
          throw new BadRequestException(`Role "${role.roleLabel}" uses FIXED strategy but has no fixedPercentage.`);
        }
      }
    }

    return this.prisma.activityType.create({
      data: {
        organizationId: command.orgId,
        code: command.code.toLowerCase().replace(/\s+/g, '_'),
        name: command.name,
        baseValue: command.baseValue != null ? command.baseValue : undefined,
        cardValue: command.cardValue != null ? command.cardValue : undefined,
        roles: (command.roles ?? []) as any,
      },
    });
  }
}

// ─── UPDATE ────────────────────────────────────────────────────────────────────

export class UpdateActivityTypeCommand implements IRequest<ActivityType> {
  id: string; // From param

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  baseValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cardValue?: number;

  @ApiPropertyOptional({ type: [ActivityTypeRoleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActivityTypeRoleDto)
  roles?: ActivityTypeRoleDto[];
}

@RequestHandler(UpdateActivityTypeCommand)
@Injectable()
export class UpdateActivityTypeCommandHandler implements IRequestHandler<UpdateActivityTypeCommand, ActivityType> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: UpdateActivityTypeCommand): Promise<ActivityType> {
    if (command.roles && command.roles.length > MAX_ROLES_PER_ACTIVITY_TYPE) {
      throw new BadRequestException(`An activity type can have at most ${MAX_ROLES_PER_ACTIVITY_TYPE} roles.`);
    }

    const data: any = {};
    if (command.name !== undefined) data.name = command.name;
    if (command.baseValue !== undefined) data.baseValue = command.baseValue;
    if (command.cardValue !== undefined) data.cardValue = command.cardValue;
    if (command.roles !== undefined) data.roles = command.roles as any;

    return this.prisma.activityType.update({
      where: { id: command.id },
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

  async execute(command: DeleteActivityTypeCommand): Promise<ActivityType> {
    // Check for existing WorkItems using this ActivityType
    const usageCount = await this.prisma.workItem.count({
      where: { activityTypeId: command.id },
    });

    if (usageCount > 0) {
      throw new BadRequestException(
        `No se puede eliminar esta actividad porque tiene ${usageCount} registro(s) asociado(s).`
      );
    }

    return this.prisma.activityType.delete({ where: { id: command.id } });
  }
}
