import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ApiProperty } from '@nestjs/swagger';
import { requireOrgScope, RequestContext } from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { foundOr404, inScope, requireId, resourceNotFound } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

export class MergePatientCommand implements IRequest<void> {
  @ApiProperty({ description: 'Source patient ID (will be deleted)' })
  sourceId!: string;

  @ApiProperty({ description: 'Target patient ID (will keep all work items)' })
  targetId!: string;
}

@Injectable()
@RequestHandler(MergePatientCommand)
export class MergePatientCommandHandler implements IRequestHandler<MergePatientCommand, void> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: MergePatientCommand, ctx: RequestContext): Promise<void> {
    const scope = requireOrgScope(ctx);
    if (typeof command.targetId !== 'string' || command.targetId === '') {
      throw new BadRequestException('Invalid request');
    }
    const sourceId = requireId(command.sourceId);
    const targetId = requireId(command.targetId);

    if (sourceId === targetId) {
      throw new BadRequestException('Source and target patients must be different');
    }

    // Verificación (sin escribir): los dos pacientes en el scope y de la misma organización
    const [source, target] = await Promise.all([
      foundOr404(
        this.prisma.patient.findFirst({
          where: { id: sourceId, ...inScope(scope) },
          select: { id: true, organizationId: true },
        }),
      ),
      foundOr404(
        this.prisma.patient.findFirst({
          where: { id: targetId, ...inScope(scope) },
          select: { id: true, organizationId: true },
        }),
      ),
    ]);
    if (source.organizationId !== target.organizationId) throw resourceNotFound();

    await this.prisma.$transaction(async (tx) => {
      // Reassign all workItems from source to target
      await tx.workItem.updateMany({
        where: { patientId: sourceId },
        data: { patientId: targetId },
      });

      // Delete source patient
      await tx.patient.delete({ where: { id: sourceId } });
    });
  }
}
