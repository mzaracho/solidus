import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ApiProperty } from '@nestjs/swagger';

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

  async execute(command: MergePatientCommand): Promise<void> {
    const { sourceId, targetId } = command;

    const [source, target] = await Promise.all([
      this.prisma.patient.findUnique({ where: { id: sourceId } }),
      this.prisma.patient.findUnique({ where: { id: targetId } }),
    ]);

    if (!source) throw new NotFoundException(`Source patient ${sourceId} not found`);
    if (!target) throw new NotFoundException(`Target patient ${targetId} not found`);

    // Reassign all workItems from source to target
    await this.prisma.workItem.updateMany({
      where: { patientId: sourceId },
      data: { patientId: targetId },
    });

    // Delete source patient
    await this.prisma.patient.delete({ where: { id: sourceId } });
  }
}
