import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { CreatePayerDto } from '../Dtos/create-payer.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { Payer } from '@prisma/client';

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
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 12;
    const skip = (page - 1) * limit;

    let professionalId: string | undefined;

    // Resolve Professional if userId is provided
    if (query.userId) {
      const professional = await this.prisma.professional.findFirst({
        where: {
          userId: query.userId,
          organizationId: query.orgId
        }
      });
      professionalId = professional?.id;
    }

    // Filter Logic:
    // 1. Belong to Org
    // 2. AND (Managed by System OR Created by ME)
    const whereCondition: any = {
      organizationId: query.orgId,
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
  orgId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;

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

  async execute(command: CreatePayerCommand): Promise<Payer> {
    // Validate: if a CUIT is provided and it belongs to a registered Organization, block the creation
    if (command.cuit) {
      const existingOrg = await this.prisma.organization.findFirst({ where: { cuit: command.cuit } });
      if (existingOrg) {
        throw new Error(
          `La asociacion con ${existingOrg.name} tiene que gestionarla con ellos directamente. No puedes agregarla como pagador manualmente.`
        );
      }
    }

    let professionalId: string | undefined;

    if (command.userId) {
      const professional = await this.prisma.professional.findFirst({
        where: {
          userId: command.userId,
          organizationId: command.orgId
        }
      });
      professionalId = professional?.id;
    }

    return this.prisma.payer.create({
      data: {
        organizationId: command.orgId,
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

  async execute(command: UpdatePayerCommand): Promise<Payer> {
    return this.prisma.payer.update({
      where: { id: command.id },
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

  async execute(command: DeletePayerCommand): Promise<Payer> {
    return this.prisma.payer.delete({ where: { id: command.id } });
  }
}
