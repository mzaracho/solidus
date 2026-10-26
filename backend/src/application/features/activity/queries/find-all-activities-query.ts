import { PaginatedActivityResponseDto } from '../Dtos/paginated-activity-response.dto';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { Prisma, PaymentStatus, BeneficiaryType } from '@prisma/client';
import { isProfessionalMode, DEFAULT_ACTIVITY_PAGE_SIZE } from '@src/domain/constants/app.constants';
import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FindAllActivitiesQuery implements IRequest<PaginatedActivityResponseDto> {
  @ApiHideProperty()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  professionalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  queryType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsString()
  mode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

@RequestHandler(FindAllActivitiesQuery)
@Injectable()
export class FindAllActivitiesQueryHandler implements IRequestHandler<
  FindAllActivitiesQuery,
  PaginatedActivityResponseDto
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(query: FindAllActivitiesQuery): Promise<PaginatedActivityResponseDto> {
    const orgId = query.organizationId;
    if (!orgId) return { items: [], total: 0, page: 0, pageSize: 0, totalPages: 0 };

    const where: Prisma.WorkItemWhereInput = {};
    let proIds: string[] = [];

    if (isProfessionalMode(query.mode) && query.userId) {
      // Find ALL active Professional profiles for this user across all orgs
      const allPros = await this.prisma.professional.findMany({
        where: { userId: query.userId, status: 'ACTIVE' },
      });

      if (allPros.length === 0) {
        return { items: [], total: 0, page: 0, pageSize: 0, totalPages: 0 };
      }

      proIds = allPros.map((p) => p.id);

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
    
    if (query.status) {
      const validStatuses = Object.values(PaymentStatus);
      if (validStatuses.includes(query.status as PaymentStatus)) {
        where.paymentStatus = query.status as PaymentStatus;
      }
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
      commission: item.splits
        .filter((s) => s.beneficiaryType === BeneficiaryType.ORG)
        .reduce((sum, s) => sum + Number((s as any).amount), 0),
      netAmount: isProfessionalMode(query.mode) && proIds.length > 0
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
        if (isProfessionalMode(query.mode) && proIds.length > 0) {
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
