import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../Prisma/prisma.service';
import { Prisma, PaymentStatus } from '@prisma/client';
import { Patient } from '@src/domain/features/patients/Patient.entity';
import {
  FindAllPatientsOptions,
  IPatientService,
} from '@src/domain/features/patients/service/i-patient-service';
import { FindAllPatientsFilter } from '@src/domain/features/patients/find-all-patients-filter';
import { ownProfessionalsFilter } from '@src/application/features/patients/patient-read-access';
import { CreatePatientRequest } from '@src/domain/features/patients/create-patient-request';
import {
  professionalIdsOf,
  ViewScope,
} from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';

function toTitleCase(name: string): string {
  return name
    .trim()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

@Injectable()
export class PatientsService implements IPatientService {
  constructor(private prisma: PrismaService) { }

  getDebt(id: string, professionalIds?: string[]): Promise<number> {
    return this.calcDebt(id, professionalIds);
  }

  async findAll(
    query: FindAllPatientsFilter,
    view: ViewScope,
    options: FindAllPatientsOptions,
  ): Promise<{ items: Patient[]; total: number }> {
    if (!query.organizationId) return { items: [], total: 0 };

    const where: Prisma.PatientWhereInput = {
      organizationId: query.organizationId,
    };

    // Filter by Professional (if Mode = PROFESSIONAL)
    const andFilters: Prisma.PatientWhereInput[] = [];
    // Vista pro: sin membresia en la organizacion del paciente, deuda y ultima visita cuentan solo las
    // atenciones de los Professional del usuario (nada de montos ajenos).
    let memberOrgIds = new Set<string>();
    let restrictedIds: string[] | null = null;

    if (view.mode === 'pro') {
      // Los Professional ACTIVE del usuario (cualquier organizacion) los resolvio ViewModeGuard.
      const proIds = professionalIdsOf(view);

      if (proIds.length === 0) {
        return { items: [], total: 0 };
      }

      // Cross-org: remove org restriction, filter patients by activity participation or ownership
      const originalOrgId = where.organizationId as string | undefined;
      delete where.organizationId;

      // Membresias del usuario: las practicas propias se ven enteras solo como ADMIN (igual que el
      // ViewModeGuard); y la deuda solo se calcula completa en organizaciones donde es miembro.
      const memberships = query.userId
        ? await this.prisma.organizationMember.findMany({
            where: { userId: query.userId },
            select: {
              organizationId: true,
              role: true,
              organization: { select: { type: true } },
            },
          })
        : [];
      memberOrgIds = new Set(memberships.map((m) => m.organizationId));
      restrictedIds = proIds;
      const soloOrgIds = memberships
        .filter(
          (m) => m.organization?.type === 'SOLO_PRACTICE' && m.role === 'ADMIN',
        )
        .map((m) => m.organizationId);

      const proOrConditions: Prisma.PatientWhereInput[] = [
        {
          workItems: {
            some: {
              OR: [
                { professionalId: { in: proIds } },
                { participants: { some: { professionalId: { in: proIds } } } },
              ],
            },
          },
        }
      ];

      // Toda la organizacion de la URL solo con membresia o permiso de carga (009)
      if (originalOrgId && options.includeCurrentOrg) {
        proOrConditions.push({ organizationId: originalOrgId });
      }

      if (soloOrgIds.length > 0) {
        proOrConditions.push({ organizationId: { in: soloOrgIds } });
      }

      andFilters.push({ OR: proOrConditions });
    }

    if (query.search) {
      andFilters.push({
        OR: [
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    if (andFilters.length > 0) {
      where.AND = andFilters;
    }

    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // Debtors first (have unpaid workItems), then non-debtors — both sorted alphabetically
    const debtorWhere = { ...where, workItems: { some: { paymentStatus: { not: PaymentStatus.PAID } } } };
    const nonDebtorWhere = { ...where, NOT: { workItems: { some: { paymentStatus: { not: PaymentStatus.PAID } } } } };

    const [debtorPatients, nonDebtorPatients] = await Promise.all([
      this.prisma.patient.findMany({ where: debtorWhere, orderBy: { lastName: 'asc' } }),
      this.prisma.patient.findMany({ where: nonDebtorWhere, orderBy: { lastName: 'asc' } }),
    ]);

    const allSorted = [...debtorPatients, ...nonDebtorPatients];
    const total = allSorted.length;
    const paginated = allSorted.slice(skip, skip + Number(limit));

    // Map to response with debt
    const results: Patient[] = [];
    for (const p of paginated) {
      const ownIds =
        restrictedIds && !memberOrgIds.has(p.organizationId)
          ? restrictedIds
          : undefined;
      const debt = await this.calcDebt(p.id, ownIds);
      const last = await this.prisma.workItem.findFirst({
        where: {
          patientId: p.id,
          ...(ownIds ? ownProfessionalsFilter(ownIds) : {}),
        },
        orderBy: { occurredAt: 'desc' },
      });

      results.push({
        ...p,
        debt,
        lastVisit: last?.occurredAt || null,
        fullName: `${p.firstName} ${p.lastName}`,
      });
    }
    return { items: results, total };
  }

  async create(patient: CreatePatientRequest): Promise<Patient> {
    const result = await this.prisma.patient.create({
      data: {
        organizationId: patient.organizationId,
        firstName: toTitleCase(patient.firstName),
        lastName: toTitleCase(patient.lastName),
        email: patient.email,
        phone: patient.phone,
      },
    });
    return new Patient(result);
  }

  async update(
    id: string,
    patient: Partial<CreatePatientRequest>,
  ): Promise<Patient> {
    const result = await this.prisma.patient.update({
      where: { id },
      data: {
        firstName: patient.firstName ? toTitleCase(patient.firstName) : undefined,
        lastName: patient.lastName ? toTitleCase(patient.lastName) : undefined,
        email: patient.email,
        phone: patient.phone,
      },
    });
    return new Patient(result);
  }

  async calcDebt(patientId: string, professionalIds?: string[]): Promise<number> {
    const items = await this.prisma.workItem.findMany({
      where: {
        patientId,
        paymentStatus: { not: 'PAID' },
        ...(professionalIds ? ownProfessionalsFilter(professionalIds) : {}),
      },
    });
    return items.reduce((acc, item) => acc + Number(item.grossAmount), 0);
  }
}
