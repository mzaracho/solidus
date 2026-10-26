import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { CreateStaffDto } from '../Dtos/create-staff.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { Professional } from '@prisma/client';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

// Create
export class CreateStaffCommand implements IRequest<Professional> {
  @ApiProperty()
  @IsString()
  @IsOptional()
  orgId: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  surname: string;

  @ApiProperty({ description: 'CUIT/CUIL del profesional — identificador unico en el sistema' })
  @IsString()
  cuit: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  canLoadActivities?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;
}

@RequestHandler(CreateStaffCommand)
@Injectable()
export class CreateStaffCommandHandler implements IRequestHandler<
  CreateStaffCommand,
  Professional
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: CreateStaffCommand): Promise<Professional> {
    // Check if a professional with this CUIT already exists in this org
    if (command.cuit) {
      const existing = await this.prisma.professional.findFirst({
        where: { organizationId: command.orgId, cuit: command.cuit, deletedAt: null },
      });
      if (existing) {
        throw new Error('Ya existe un profesional con ese CUIT en esta organizacion.');
      }
    }

    // Try to link to a User by email (primary) or CUIT (future V2)
    let userId: string | null = null;
    if (command.email) {
      const user = await this.prisma.user.findUnique({ where: { email: command.email } });
      if (user && !user.deletedAt) {
        userId = user.id;
      }
    }

    return this.prisma.professional.create({
      data: {
        organizationId: command.orgId,
        displayName: `${command.name} ${command.surname}`,
        cuit: command.cuit ?? null,
        email: command.email ?? null,
        phone: command.phone ?? null,
        userId,
        canLoadActivities: command.canLoadActivities ?? false,
        categoryId: command.categoryId ?? null,
      },
    });
  }
}

// Update
export class UpdateStaffCommand implements IRequest<Professional> {
  id: string; // From Param

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  surname: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cuit?: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  canLoadActivities?: boolean;
}

@RequestHandler(UpdateStaffCommand)
@Injectable()
export class UpdateStaffCommandHandler implements IRequestHandler<
  UpdateStaffCommand,
  Professional
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: UpdateStaffCommand): Promise<Professional> {
    const data: any = {
      displayName: `${command.name} ${command.surname}`,
      cuit: command.cuit,
      email: command.email,
      phone: command.phone,
    };
    if (command.canLoadActivities !== undefined) {
      data.canLoadActivities = command.canLoadActivities;
    }
    return this.prisma.professional.update({
      where: { id: command.id },
      data,
    });
  }
}

// Delete
export class DeleteStaffCommand implements IRequest<Professional> {
  constructor(public readonly id: string) { }
}

@RequestHandler(DeleteStaffCommand)
@Injectable()
export class DeleteStaffCommandHandler implements IRequestHandler<
  DeleteStaffCommand,
  Professional
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: DeleteStaffCommand): Promise<Professional> {
    const professional = await this.prisma.professional.findUnique({
      where: { id: command.id },
      include: {
        workItems: { select: { id: true }, take: 1 },
      }
    });

    if (!professional) {
      throw new Error('Professional not found');
    }

    const hasWorkItems = professional.workItems.length > 0;
    const hasUser = !!professional.userId;

    // Rule 3: Has User -> Soft Delete Professional + Soft Delete User + Unlink Org
    if (professional.userId) {
      const userId = professional.userId; // Capture for closure safety
      return this.prisma.$transaction(async (tx) => {
        // Soft delete professional
        const updatedPro = await tx.professional.update({
          where: { id: command.id },
          data: { deletedAt: new Date() }
        });

        // Soft delete user
        await tx.user.update({
          where: { id: userId },
          data: { deletedAt: new Date() }
        });

        // Delete organization membership
        await tx.organizationMember.deleteMany({
          where: {
            organizationId: professional.organizationId,
            userId: userId
          }
        });

        return updatedPro;
      });
    }

    // Rule 2: No User but has WorkItems -> Soft Delete Professional
    if (hasWorkItems) {
      return this.prisma.professional.update({
        where: { id: command.id },
        data: { deletedAt: new Date() }
      });
    }

    // Rule 1: No User and No WorkItems -> Hard Delete
    return this.prisma.professional.delete({ where: { id: command.id } });
  }
}

// Assign Category
export class AssignStaffCategoryCommand implements IRequest<Professional> {
  id: string; // From Param

  @ApiProperty()
  @IsString()
  categoryId: string;
}

@RequestHandler(AssignStaffCategoryCommand)
@Injectable()
export class AssignStaffCategoryCommandHandler implements IRequestHandler<
  AssignStaffCategoryCommand,
  Professional
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: AssignStaffCategoryCommand): Promise<Professional> {
    return this.prisma.professional.update({
      where: { id: command.id },
      data: { categoryId: command.categoryId },
    });
  }
}
