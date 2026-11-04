import { Injectable } from '@nestjs/common';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { requireOrgScope, RequestContext } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import {
  assertPatientReadable,
  ownProfessionalsFilter,
} from '../patient-read-access';
import { foundOr404, inScope, requireId } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

export interface PatientSummaryItem {
  id: string;
  date: string;
  serviceType: string;
  grossAmount: number;
  paymentStatus: string;
  payerName: string;
  professionalName: string;
}

export interface PatientSummary {
  totalDebt: number;
  pendingItems: PatientSummaryItem[];
}

export class GetPatientSummaryQuery implements IRequest<PatientSummary> {
  constructor(public readonly patientId: string) {}
}

@RequestHandler(GetPatientSummaryQuery)
@Injectable()
export class GetPatientSummaryQueryHandler
  implements IRequestHandler<GetPatientSummaryQuery, PatientSummary>
{
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: GetPatientSummaryQuery,
    ctx: RequestContext,
  ): Promise<PatientSummary> {
    const scope = requireOrgScope(ctx);
    const patientId = requireId(query.patientId);
    const patient = await foundOr404(
      this.prisma.patient.findFirst({
        where: { id: patientId, ...inScope(scope) },
        select: { id: true, organizationId: true },
      }),
    );
    const ownIds = await assertPatientReadable(this.prisma, scope, patient);
    const items = await this.prisma.workItem.findMany({
      where: {
        patientId,
        paymentStatus: { not: 'PAID' },
        ...(ownIds ? ownProfessionalsFilter(ownIds) : {}),
      },
      include: {
        payer: true,
        professional: true,
      },
      orderBy: { occurredAt: 'desc' },
    });

    const totalDebt = items.reduce((acc, item) => acc + Number(item.grossAmount), 0);

    const pendingItems: PatientSummaryItem[] = items.map((item) => ({
      id: item.id,
      date: item.occurredAt.toISOString(),
      serviceType: item.serviceType,
      grossAmount: Number(item.grossAmount),
      paymentStatus: item.paymentStatus,
      payerName: item.payer?.name ?? '-',
      professionalName: item.professional?.displayName ?? '-',
    }));

    return { totalDebt, pendingItems };
  }
}
