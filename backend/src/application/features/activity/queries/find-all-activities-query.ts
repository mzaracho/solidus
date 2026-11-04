import { PaginatedActivityResponseDto } from '../Dtos/paginated-activity-response.dto';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  IsOptionalDateString,
  IsOptionalEntityId,
} from '@src/infrastructure.bootstrap/config/core/validation/dto-validators';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { Prisma, PaymentStatus, BeneficiaryType } from '@prisma/client';
import {
  DEFAULT_ACTIVITY_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  MAX_PAGE_SIZE,
} from '@src/domain/constants/app.constants';
import {
  professionalIdsOf,
  RequestContext,
  requireViewScope,
} from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class FindAllActivitiesQuery implements IRequest<PaginatedActivityResponseDto> {
  /** La asigna el controlador desde @CurrentOrgId(); la query del cliente no la pisa. */
  declare organizationId?: string;

  @ApiPropertyOptional()
  @IsOptionalDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptionalDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptionalEntityId()
  patientId?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional()
  @IsOptionalEntityId()
  professionalId?: string;

  @ApiPropertyOptional()
  @IsOptionalEntityId()
  payerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  queryType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_NUMBER)
  page?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number = 20;
}

@RequestHandler(FindAllActivitiesQuery)
@Injectable()
export class FindAllActivitiesQueryHandler implements IRequestHandler<
  FindAllActivitiesQuery,
  PaginatedActivityResponseDto
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(
    query: FindAllActivitiesQuery,
    ctx: RequestContext,
  ): Promise<PaginatedActivityResponseDto> {
    // El modo y los Professional del usuario los resolvio ViewModeGuard (no el cliente).
    const view = requireViewScope(ctx);
    const isPro = view.mode === 'pro';
    const orgId = query.organizationId;
    if (!orgId) return { items: [], total: 0, page: 0, pageSize: 0, totalPages: 0 };

    const where: Prisma.WorkItemWhereInput = {};
    const proIds: string[] = isPro ? professionalIdsOf(view) : [];

    if (isPro) {
      // Professional ACTIVE del usuario en cualquier organizacion (vista multi-organizacion)
      if (proIds.length === 0) {
        return { items: [], total: 0, page: 0, pageSize: 0, totalPages: 0 };
      }

      // Cross-org: no organizationId restriction in PRO mode
      where.OR = [
        { professionalId: { in: proIds } },
        { participants: { some: { professionalId: { in: proIds } } } },
      ];
    } else {
      // Org mode: restrict to the current org
      where.organizationId = orgId;
    }

    if (query.startDate && query.endDate) {
      where.occurredAt = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }
    if (query.patientId) where.patientId = query.patientId;
    if (query.search) {
      where.patient = {
        OR: [
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
        ]
      };
    }
    
    // El pipe ya rechaza un estado fuera del enum (400); se conserva el chequeo por si el handler se usa sin pipe
    if (query.status && Object.values(PaymentStatus).includes(query.status)) {
      where.paymentStatus = query.status;
    }
    if (query.professionalId) where.professionalId = query.professionalId;
    if (query.payerId) where.payerId = query.payerId;

    const type = query.type || query.queryType;
    if (type) where.serviceType = type;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;

    const page = query.page || 1;
    const limit = query.limit || DEFAULT_ACTIVITY_PAGE_SIZE;
    const skip = (page - 1) * limit;

    const [total, activities] = await Promise.all([
      this.prisma.workItem.count({ where }),
      this.prisma.workItem.findMany({
        where,
        include: {
          patient: true,
          professional: true,
          payer: true,
          preset: true,
          splits: true,
          participants: true,
          organization: { select: { id: true, name: true } },
        },
        orderBy: { occurredAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const items = activities.map((item) => ({
      id: item.id,
      date: item.occurredAt.toISOString().split('T')[0],
      serviceType: item.serviceType,
      patientId: item.patientId,
      patientName: item.patient
        ? `${item.patient.firstName} ${item.patient.lastName}`
        : 'Unknown',
      professionalId: item.professionalId,
      professionalName: item.professional ? (item.professional as any).displayName : 'Unknown',
      presetId: item.presetId,
      payerId: item.payerId,
      payerName: item.payer?.name || 'Unknown',
      status: item.paymentStatus,
      paymentMethod: item.paymentMethod,
      paymentDate: item.paymentDate,
      attendance: item.attendance,
      createdByUserId: item.createdByUserId ?? null,
      commission: item.splits
        .filter((s) => s.beneficiaryType === BeneficiaryType.ORG)
        .reduce((sum, s) => sum + Number((s as any).amount), 0),
      netAmount: isPro
        // PRO mode: only the current professional's own splits
        ? item.splits
          .filter((s) => s.beneficiaryId != null && proIds.includes(s.beneficiaryId!))
          .reduce((sum, s) => sum + Number((s as any).amount), 0)
        // ORG mode: sum all professional splits
        : item.splits
          .filter((s) => s.beneficiaryType === BeneficiaryType.PROFESSIONAL)
          .reduce((sum, s) => sum + Number((s as any).amount), 0),
      grossAmount: Number((item as any).grossAmount),
      paidAmount: item.paymentStatus === PaymentStatus.PAID ? Number((item as any).grossAmount) : 0,
      payments: 0,
      organizationName: (item.organization as any)?.name || 'Desconocida',
      isExternal: item.organizationId !== orgId,
      isReadOnly: item.organizationId !== orgId,
      role: (() => {
        if (isPro) {
          const myParticipant = (item as any).participants?.find(
            (p: any) => proIds.includes(p.professionalId),
          );
          if (myParticipant) return myParticipant.roleLabel as string;
          // Main professional with no explicit participant entry
          if (item.professionalId && proIds.includes(item.professionalId)) {
            return 'Profesional';
          }
        }
        return null;
      })(),
    }));

    return {
      items,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
