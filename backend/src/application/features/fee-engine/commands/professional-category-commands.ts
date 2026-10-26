import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { ProfessionalCategory } from '@prisma/client';

// Get
export class FindProfessionalCategoriesQuery implements IRequest<
  ProfessionalCategory[]
> {
  @ApiProperty()
  @IsString()
  organizationId: string;
}

@RequestHandler(FindProfessionalCategoriesQuery)
@Injectable()
export class FindProfessionalCategoriesQueryHandler implements IRequestHandler<
  FindProfessionalCategoriesQuery,
  ProfessionalCategory[]
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: FindProfessionalCategoriesQuery,
  ): Promise<ProfessionalCategory[]> {
    if (!query.organizationId) return [];
    return this.prisma.professionalCategory.findMany({
      where: { organizationId: query.organizationId },
    });
  }
}

// Create (Distinct from org-controller for now to match controller signature)
export class CreateFeeEngineCategoryCommand implements IRequest<ProfessionalCategory> {
  @ApiProperty()
  @IsString()
  organizationId: string;

  @ApiProperty()
  @IsString()
  name: string;
}

@RequestHandler(CreateFeeEngineCategoryCommand)
@Injectable()
export class CreateFeeEngineCategoryCommandHandler implements IRequestHandler<
  CreateFeeEngineCategoryCommand,
  ProfessionalCategory
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    command: CreateFeeEngineCategoryCommand,
  ): Promise<ProfessionalCategory> {
    return this.prisma.professionalCategory.create({
      data: {
        organizationId: command.organizationId,
        name: command.name,
      },
    });
  }
}

// Delete
export class DeleteFeeEngineCategoryCommand implements IRequest<ProfessionalCategory> {
  constructor(public readonly id: string) {}
}

@RequestHandler(DeleteFeeEngineCategoryCommand)
@Injectable()
export class DeleteFeeEngineCategoryCommandHandler implements IRequestHandler<
  DeleteFeeEngineCategoryCommand,
  ProfessionalCategory
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    command: DeleteFeeEngineCategoryCommand,
  ): Promise<ProfessionalCategory> {
    return this.prisma.professionalCategory.delete({
      where: { id: command.id },
    });
  }
}
