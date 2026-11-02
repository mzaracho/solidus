import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { CreateStaffDto } from '../Dtos/create-staff.dto';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { Professional } from '@prisma/client';
import { requireOrgScope, RequestContext } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { foundOr404, inOrg, inScope, optionalId, requireId } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

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

  async execute(command: CreateStaffCommand, ctx: RequestContext): Promise<Professional> {
    const scope = requireOrgScope(ctx);
    const orgId = scope.primaryOrgId;

    // La categoría, si viene, tiene que ser de esta organización ('' cuenta como ausente)
    const categoryId = optionalId(command.categoryId);
    if (categoryId) {
      await foundOr404(
        this.prisma.professionalCategory.findFirst({
          where: { id: categoryId, ...inOrg(orgId) },
          select: { id: true },
        }),
      );
    }

    // Check if a professional with this CUIT already exists in this org
    if (command.cuit) {
      const existing = await this.prisma.professional.findFirst({
        where: { organizationId: orgId, cuit: command.cuit, deletedAt: null },
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
        organizationId: orgId,
        displayName: `${command.name} ${command.surname}`,
        cuit: command.cuit ?? null,
        email: command.email ?? null,
        phone: command.phone ?? null,
        userId,
        canLoadActivities: command.canLoadActivities ?? false,
        categoryId,
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

  async execute(command: UpdateStaffCommand, ctx: RequestContext): Promise<Professional> {
    const scope = requireOrgScope(ctx);
    const id = requireId(command.id);
    await foundOr404(
      this.prisma.professional.findFirst({
        where: { id, ...inScope(scope) },
        select: { id: true },
      }),
    );
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
      where: { id },
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

  async execute(command: DeleteStaffCommand, ctx: RequestContext): Promise<Professional> {
    const scope = requireOrgScope(ctx);
    const id = requireId(command.id);
    const professional = await foundOr404(
      this.prisma.professional.findFirst({
        where: { id, ...inScope(scope) },
        include: {
          workItems: { select: { id: true }, take: 1 },
        },
      }),
    );

    const hasWorkItems = professional.workItems.length > 0;

    // Rule 3: Has User -> Soft Delete Professional + Unlink Org (+ Soft Delete User only if no other links)
    if (professional.userId) {
      const userId = professional.userId; // Capture for closure safety
      return this.prisma.$transaction(async (tx) => {
        // Soft delete professional
        const updatedPro = await tx.professional.update({
          where: { id },
          data: { deletedAt: new Date() }
        });

        // Delete organization membership (only of this organization)
        await tx.organizationMember.deleteMany({
          where: {
            organizationId: professional.organizationId,
            userId: userId
          }
        });

        // The global User is deactivated only if no other active link remains
        const otherProfessionals = await tx.professional.count({
          where: { userId, deletedAt: null, id: { not: id } },
        });
        const otherMemberships = await tx.organizationMember.count({
          where: { userId, organizationId: { not: professional.organizationId } },
        });
        if (otherProfessionals === 0 && otherMemberships === 0) {
          await tx.user.update({
            where: { id: userId },
            data: { deletedAt: new Date() }
          });
        }

        return updatedPro;
      });
    }

    // Rule 2: No User but has WorkItems -> Soft Delete Professional
    if (hasWorkItems) {
      return this.prisma.professional.update({
        where: { id },
        data: { deletedAt: new Date() }
      });
    }

    // Rule 1: No User and No WorkItems -> Hard Delete
    return this.prisma.professional.delete({ where: { id } });
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

  async execute(command: AssignStaffCategoryCommand, ctx: RequestContext): Promise<Professional> {
    const scope = requireOrgScope(ctx);
    const id = requireId(command.id);
    const categoryId = requireId(command.categoryId);
    const professional = await foundOr404(
      this.prisma.professional.findFirst({
        where: { id, ...inScope(scope) },
        select: { id: true, organizationId: true },
      }),
    );
    // La categoría tiene que ser de la misma organización que el profesional
    await foundOr404(
      this.prisma.professionalCategory.findFirst({
        where: { id: categoryId, ...inOrg(professional.organizationId) },
        select: { id: true },
      }),
    );
    return this.prisma.professional.update({
      where: { id },
      data: { categoryId },
    });
  }
}
