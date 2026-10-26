import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Get Dictionaries
export class GetDictionariesQuery implements IRequest<any> {}

@RequestHandler(GetDictionariesQuery)
@Injectable()
export class GetDictionariesQueryHandler implements IRequestHandler<
  GetDictionariesQuery,
  any
> {
  async execute(): Promise<any> {
    return {
      activityTypes: [
        { id: 'session', label: 'Sesión Terapia' },
        { id: 'admission', label: 'Admisión' },
        { id: 'at', label: 'Acompañamiento T.' },
        { id: 'workshop', label: 'Taller Grupal' },
      ],
      paymentStatuses: [
        { id: 'pending', label: 'Pendiente', color: 'warning' },
        { id: 'paid', label: 'Pagado', color: 'success' },
        { id: 'debt', label: 'Deudor', color: 'danger' },
      ],
    };
  }
}

// Get Org Rules
export class GetOrgRulesQuery implements IRequest<any> {
  @ApiProperty()
  @IsString()
  orgId: string;
}

@RequestHandler(GetOrgRulesQuery)
@Injectable()
export class GetOrgRulesQueryHandler implements IRequestHandler<
  GetOrgRulesQuery,
  any
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetOrgRulesQuery): Promise<any> {
    if (!query.orgId) return { error: 'x-org-id header required' };

    const categories = await this.prisma.professionalCategory.findMany({
      where: { organizationId: query.orgId },
    });

    const roles = [
      { id: 'TITULAR', name: 'Titular', percent: 100 },
      { id: 'ADMISOR', name: 'Admisor', percent: 50 },
      { id: 'COADMISOR', name: 'Coadmisor', percent: 50 },
    ];

    const presets = await this.prisma.feePreset.findMany({
      where: { organizationId: query.orgId },
    });

    return {
      categories,
      roles,
      presets,
    };
  }
}

// Update Org Rules
export class UpdateOrgRulesCommand implements IRequest<any> {
  @ApiProperty()
  @IsString()
  orgId: string;

  @ApiPropertyOptional()
  @IsOptional()
  body?: Record<string, unknown>;
}

@RequestHandler(UpdateOrgRulesCommand)
@Injectable()
export class UpdateOrgRulesCommandHandler implements IRequestHandler<
  UpdateOrgRulesCommand,
  any
> {
  async execute(command: UpdateOrgRulesCommand): Promise<any> {
    return { success: true, message: 'Rules updated' };
  }
}

// Get Pro Rules
export class GetProRulesQuery implements IRequest<any> {
  @ApiProperty()
  @IsString()
  orgId: string;
}

@RequestHandler(GetProRulesQuery)
@Injectable()
export class GetProRulesQueryHandler implements IRequestHandler<
  GetProRulesQuery,
  any
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetProRulesQuery): Promise<any> {
    if (!query.orgId) return { error: 'x-org-id header required' };

    return this.prisma.payer.findMany({
      where: { organizationId: query.orgId },
    });
  }
}
