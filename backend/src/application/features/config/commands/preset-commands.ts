import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { CreatePresetDto } from '../Dtos/create-preset.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { FeePreset } from '@prisma/client';
import { requireOrgScope, RequestContext } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { foundOr404, inScope, requireId } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsMoney } from '@src/infrastructure.bootstrap/config/core/validation/dto-validators';

// Create
export class CreatePresetCommand implements IRequest<FeePreset> {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty()
  @IsMoney()
  baseValue: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  cardValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  linkedType?: string;
}

@RequestHandler(CreatePresetCommand)
@Injectable()
export class CreatePresetCommandHandler implements IRequestHandler<
  CreatePresetCommand,
  FeePreset
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: CreatePresetCommand, ctx: RequestContext): Promise<FeePreset> {
    const scope = requireOrgScope(ctx);
    const preset = await this.prisma.feePreset.create({
      data: {
        organizationId: scope.primaryOrgId,
        name: command.name,
        value: command.baseValue,
        cardValue: command.cardValue ? command.cardValue : null,
        linkedType: command.linkedType || null,
        serviceType: 'session',
      },
    });

    // Sanitize response
    return {
      id: preset.id,
      organizationId: preset.organizationId,
      name: preset.name,
      value: preset.value,
      cardValue: preset.cardValue,
      serviceType: preset.serviceType,
      linkedType: preset.linkedType
    } as any;
  }
}

// Update
export class UpdatePresetCommand implements IRequest<FeePreset> {
  /** Lo asigna el controlador desde el path; el cliente no lo manda (400). */
  declare id: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty()
  @IsMoney()
  baseValue: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  cardValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  linkedType?: string;
}

@RequestHandler(UpdatePresetCommand)
@Injectable()
export class UpdatePresetCommandHandler implements IRequestHandler<
  UpdatePresetCommand,
  FeePreset
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: UpdatePresetCommand, ctx: RequestContext): Promise<FeePreset> {
    const scope = requireOrgScope(ctx);
    const id = requireId(command.id);
    await foundOr404(
      this.prisma.feePreset.findFirst({
        where: { id, ...inScope(scope) },
        select: { id: true },
      }),
    );
    const preset = await this.prisma.feePreset.update({
      where: { id },
      data: {
        name: command.name,
        value: command.baseValue,
        cardValue: command.cardValue ? command.cardValue : null,
        linkedType: command.linkedType || null,
      },
    });

    // Sanitize response
    return {
      id: preset.id,
      organizationId: preset.organizationId,
      name: preset.name,
      value: preset.value,
      cardValue: preset.cardValue,
      serviceType: preset.serviceType,
      linkedType: preset.linkedType
    } as any;
  }
}

// Delete
export class DeletePresetCommand implements IRequest<FeePreset> {
  constructor(public readonly id: string) { }
}

@RequestHandler(DeletePresetCommand)
@Injectable()
export class DeletePresetCommandHandler implements IRequestHandler<
  DeletePresetCommand,
  FeePreset
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: DeletePresetCommand, ctx: RequestContext): Promise<FeePreset> {
    const scope = requireOrgScope(ctx);
    const id = requireId(command.id);
    await foundOr404(
      this.prisma.feePreset.findFirst({
        where: { id, ...inScope(scope) },
        select: { id: true },
      }),
    );
    return this.prisma.feePreset.delete({ where: { id } });
  }
}
