import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { CreateCategoryDto } from '../Dtos/create-category.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ProfessionalCategory } from '@prisma/client';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

// Create
export class CreateCategoryCommand implements IRequest<ProfessionalCategory> {
  @ApiProperty()
  @IsString()
  orgId: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  percentage?: number;
}

@RequestHandler(CreateCategoryCommand)
@Injectable()
export class CreateCategoryCommandHandler implements IRequestHandler<
  CreateCategoryCommand,
  ProfessionalCategory
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: CreateCategoryCommand): Promise<ProfessionalCategory> {
    return this.prisma.professionalCategory.create({
      data: {
        organizationId: command.orgId,
        name: command.name,
        percentage: command.percentage ?? 100,
      },
    });
  }
}

// Update
export class UpdateCategoryCommand implements IRequest<ProfessionalCategory> {
  id: string; // From Param

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  percentage?: number;
}

@RequestHandler(UpdateCategoryCommand)
@Injectable()
export class UpdateCategoryCommandHandler implements IRequestHandler<
  UpdateCategoryCommand,
  ProfessionalCategory
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: UpdateCategoryCommand): Promise<ProfessionalCategory> {
    return this.prisma.professionalCategory.update({
      where: { id: command.id },
      data: { name: command.name, percentage: command.percentage },
    });
  }
}

// Delete
export class DeleteCategoryCommand implements IRequest<ProfessionalCategory> {
  constructor(public readonly id: string) {}
}

@RequestHandler(DeleteCategoryCommand)
@Injectable()
export class DeleteCategoryCommandHandler implements IRequestHandler<
  DeleteCategoryCommand,
  ProfessionalCategory
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: DeleteCategoryCommand): Promise<ProfessionalCategory> {
    return this.prisma.professionalCategory.delete({
      where: { id: command.id },
    });
  }
}
