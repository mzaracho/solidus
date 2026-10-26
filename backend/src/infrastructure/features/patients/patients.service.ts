import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../Prisma/prisma.service';
import { Prisma, PaymentStatus } from '@prisma/client';
import { Patient } from '@src/domain/features/patients/Patient.entity';
import { IPatientService } from '@src/domain/features/patients/service/i-patient-service';
import { FindAllPatientsFilter } from '@src/domain/features/patients/find-all-patients-filter';
import { CreatePatientRequest } from '@src/domain/features/patients/create-patient-request';
import { isProfessionalMode } from '@src/domain/constants/app.constants';

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

  getDebt(id: string): Promise<number> {
    return this.calcDebt(id);
  }

  async findAll(query: FindAllPatientsFilter): Promise<{ items: Patient[]; total: number }> {
    if (!query.organizationId) return { items: [], total: 0 };

    const where: Prisma.PatientWhereInput = {
      organizationId: query.organizationId,
    };

    // Filter by Professional (if Mode = PROFESSIONAL)
    const andFilters: Prisma.PatientWhereInput[] = [];

    if (isProfessionalMode(query.mode) && query.userId) {
      // Find ALL active Professional profiles for this user across all orgs
      const allPros = await this.prisma.professional.findMany({
        where: { userId: query.userId, status: 'ACTIVE' },
      });

      if (allPros.length === 0) {
        return { items: [], total: 0 };
      }

      const proIds = allPros.map((p) => p.id);

      // Cross-org: remove org restriction, filter patients by activity participation or ownership
      const originalOrgId = where.organizationId as string | undefined;
      delete where.organizationId;

      const soloOrgs = await this.prisma.organizationMember.findMany({
        where: { userId: query.userId, organization: { type: 'SOLO_PRACTICE' } },
        select: { organizationId: true },
      });
      const soloOrgIds = soloOrgs.map(m => m.organizationId);

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

      if (originalOrgId) {
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
      const debt = await this.calcDebt(p.id);
      const last = await this.prisma.workItem.findFirst({
        where: { patientId: p.id },
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

  async calcDebt(patientId: string): Promise<number> {
    const items = await this.prisma.workItem.findMany({
      where: {
        patientId,
        paymentStatus: { not: 'PAID' },
      },
    });
    return items.reduce((acc, item) => acc + Number(item.grossAmount), 0);
  }
}
