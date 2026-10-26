import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { BeneficiaryType } from '@prisma/client';

export class FindActivityByIdQuery implements IRequest<any> {
    constructor(public readonly id: string) { }
}

@RequestHandler(FindActivityByIdQuery)
@Injectable()
export class FindActivityByIdQueryHandler implements IRequestHandler<
    FindActivityByIdQuery,
    any
> {
    constructor(private readonly prisma: PrismaService) { }

    async execute(query: FindActivityByIdQuery): Promise<any> {
        const activity = await this.prisma.workItem.findUnique({
            where: { id: query.id },
            include: {
                patient: true,
                professional: true, // Organization-Professional relation
                payer: true,
                preset: true,
                splits: true, // Includes Beneficiary ID
            },
        });

        if (!activity) {
            throw new NotFoundException('Activity not found');
        }

        // Resolve Co-Professional Name if possible requires extra query or finding it in splits
        const coProSplit = activity.splits.find(s => s.beneficiaryType === BeneficiaryType.PROFESSIONAL && s.beneficiaryId !== activity.professionalId);

        return {
            id: activity.id,
            date: activity.occurredAt.toISOString().split('T')[0],
            month: activity.occurredAt.toISOString().slice(0, 7),
            type: activity.serviceType,

            patientId: activity.patientId,
            patientName: activity.patient ? `${activity.patient.firstName} ${activity.patient.lastName}` : 'Unknown',

            professionalId: activity.professionalId,
            // Fix: Use displayName, not name
            professionalName: activity.professional ? activity.professional.displayName : 'Unknown',

            coProfessionalId: coProSplit?.beneficiaryId,

            presetId: activity.presetId,
            presetName: activity.preset?.name,

            payerId: activity.payerId,
            payerName: activity.payer?.name,

            paymentStatus: activity.paymentStatus,
            paymentMethod: activity.paymentMethod,
            paymentDate: activity.paymentDate,
            attendance: activity.attendance,

            grossAmount: Number(activity.grossAmount),
            quantity: 1,

            // Breakdown for detail view
            admissionValue: Number(activity.grossAmount),
            distributions: activity.splits.map(s => ({
                beneficiary: s.beneficiaryType,
                amount: Number(s.amount),
                percentage: 0
            }))
        };
    }
}
