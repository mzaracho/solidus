import { Module } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/Prisma/prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
