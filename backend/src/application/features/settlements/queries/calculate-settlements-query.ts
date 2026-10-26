import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { parseOrgSettings } from '@src/domain/features/organization/org-settings';

export class CalculateSettlementsQuery implements IRequest<any[]> {
    @ApiProperty({ example: '2026-02' })
    @IsString()
    @Matches(/^\d{4}-\d{2}$/, { message: 'Month must be in YYYY-MM format' })
    month: string;

    @ApiProperty()
    @IsString()
    organizationId: string;
}

@RequestHandler(CalculateSettlementsQuery)
@Injectable()
export class CalculateSettlementsQueryHandler implements IRequestHandler<CalculateSettlementsQuery, any[]> {
    constructor(private readonly prisma: PrismaService) { }

    async execute(query: CalculateSettlementsQuery): Promise<any[]> {
        const { month, organizationId } = query;
        const [year, monthNum] = month.split('-').map(Number);

        // Current month date range
        const startDate = new Date(year, monthNum - 1, 1);
        const endDate = new Date(year, monthNum, 0);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        // Load org settings for configurable business rules
        const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
        const orgSettings = parseOrgSettings(org?.settings);

        // Filter by paymentDate when set, fall back to occurredAt when not.
        const workItems = await this.prisma.workItem.findMany({
            where: {
                organizationId,
                OR: [
                    { paymentDate: { gte: startDate, lte: endDate } },
                    { paymentDate: null, occurredAt: { gte: startDate, lte: endDate } },
                ],
            },
            include: {
                professional: {
                    include: { category: true },
                },
                participants: {
                    include: {
                        professional: {
                            include: { category: true },
                        },
                    },
                },
                patient: true,
                payer: true,
            },
            orderBy: {
                occurredAt: 'asc',
            },
        });

        // Dynamic Category Percentages
        const specialCategoryNames = ['Admisor', 'Coadmisor', 'Acompañante Terapeutico', 'Coordinacion AT'];
        const categories = await this.prisma.professionalCategory.findMany({
            where: { organizationId, name: { in: specialCategoryNames } }
        });

        const admisorPct = categories.find(c => c.name === 'Admisor')?.percentage ?? 50;
        const coadmisorPct = categories.find(c => c.name === 'Coadmisor')?.percentage ?? 20;
        const atPct = categories.find(c => c.name === 'Acompañante Terapeutico')?.percentage ?? 70;
        const coordPct = categories.find(c => c.name === 'Coordinacion AT')?.percentage ?? 10;

        const summary: Record<string, any> = {};

        const getOrCreateSummary = (proId: string, proName: string) => {
            if (!summary[proId]) {
                summary[proId] = {
                    professionalId: proId,
                    name: proName,
                    count: 0,
                    grossBase: 0,
                    payout: 0,
                    details: []
                };
            }
            return summary[proId];
        };

        for (const itemRaw of workItems) {
            const item = itemRaw as any;
            if (!item.professional) continue;

            const calculationBase = Number(item.amountBase ?? item.grossAmount) || 0;

            // If the WorkItem has participants defined, use them (new multi-professional model)
            if (item.participants && item.participants.length > 0) {
                for (const participant of item.participants) {
                    const pro = participant.professional;
                    if (!pro) continue;

                    const proEntry = getOrCreateSummary(pro.id, pro.displayName || 'Desconocido');
                    const payoutAmount = Number(participant.feeAmount) || 0;

                    proEntry.count++;
                    proEntry.grossBase += calculationBase;
                    proEntry.payout += payoutAmount;
                    proEntry.details.push({
                        date: item.occurredAt.toISOString(),
                        patient: item.patient ? `${item.patient.firstName} ${item.patient.lastName}` : 'Sin Paciente',
                        type: `${item.serviceType} (${participant.roleLabel})`,
                        calculationBase,
                        payoutAmount,
                        percent: calculationBase > 0 ? Math.round((payoutAmount / calculationBase) * 100) : 0,
                    });
                }
            } else {
                // Legacy fallback: calculate from professional category
                const proEntry = getOrCreateSummary(item.professional.id, item.professional.displayName || 'Desconocido');
                const percent = item.professional.category?.percentage ?? 0;
                const payoutAmount = calculationBase * (percent / 100);

                proEntry.count++;
                proEntry.grossBase += calculationBase;
                proEntry.payout += payoutAmount;
                proEntry.details.push({
                    date: item.occurredAt.toISOString(),
                    patient: item.patient ? `${item.patient.firstName} ${item.patient.lastName}` : 'Sin Paciente',
                    type: item.serviceType,
                    calculationBase,
                    payoutAmount,
                    percent,
                });
            }
        }

        return Object.values(summary);
    }
}
