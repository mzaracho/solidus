import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { CreatePresetDto } from '../Dtos/create-preset.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { FeePreset } from '@prisma/client';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

// Create
export class CreatePresetCommand implements IRequest<FeePreset> {
  @ApiProperty()
  @IsOptional() // Injected by Controller
  @IsString()
  orgId: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNumber()
  baseValue: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cardValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkedType?: string;
}

@RequestHandler(CreatePresetCommand)
@Injectable()
export class CreatePresetCommandHandler implements IRequestHandler<
  CreatePresetCommand,
  FeePreset
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: CreatePresetCommand): Promise<FeePreset> {
    const preset = await this.prisma.feePreset.create({
      data: {
        organizationId: command.orgId,
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
  id: string; // From Param

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNumber()
  baseValue: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cardValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkedType?: string;
}

@RequestHandler(UpdatePresetCommand)
@Injectable()
export class UpdatePresetCommandHandler implements IRequestHandler<
  UpdatePresetCommand,
  FeePreset
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: UpdatePresetCommand): Promise<FeePreset> {
    const preset = await this.prisma.feePreset.update({
      where: { id: command.id },
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

  async execute(command: DeletePresetCommand): Promise<FeePreset> {
    return this.prisma.feePreset.delete({ where: { id: command.id } });
  }
}
