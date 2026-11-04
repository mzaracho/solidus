import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { BeneficiaryType } from '@prisma/client';
import { requireOrgScope, RequestContext, roleIn } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { foundOr404, inScope, requireId, resourceNotFound } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

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

    async execute(query: FindActivityByIdQuery, ctx: RequestContext): Promise<any> {
        const scope = requireOrgScope(ctx);
        const id = requireId(query.id);
        const activity = await foundOr404(this.prisma.workItem.findFirst({
            where: { id, ...inScope(scope) },
            include: {
                patient: true,
                professional: true, // Organization-Professional relation
                payer: true,
                preset: true,
                splits: true, // Includes Beneficiary ID
            },
        }));

        // Vinculo solo de Professional (sin membresia en la organizacion de la atencion): solo lee las atenciones
        // de su propio Professional, como profesional principal o como participante. Lo demas, el 404 generico.
        if (roleIn(scope, activity.organizationId) === null) {
            const own = await this.prisma.professional.findMany({
                where: {
                    userId: scope.userId,
                    organizationId: activity.organizationId,
                    status: 'ACTIVE',
                    deletedAt: null,
                },
                select: { id: true },
            });
            const ids = own.map((p) => p.id);
            let mine = !!activity.professionalId && ids.includes(activity.professionalId);
            if (!mine && ids.length > 0) {
                const participation = await this.prisma.workItemParticipant.findFirst({
                    where: { workItemId: activity.id, professionalId: { in: ids } },
                    select: { id: true },
                });
                mine = !!participation;
            }
            if (!mine) throw resourceNotFound();
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
