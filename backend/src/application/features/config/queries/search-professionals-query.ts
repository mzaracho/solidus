import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { Professional } from '@prisma/client';

import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SearchProfessionalsQuery implements IRequest<Professional[]> {
  @ApiProperty()
  @IsString()
  cuit: string;
}

@RequestHandler(SearchProfessionalsQuery)
@Injectable()
export class SearchProfessionalsQueryHandler implements IRequestHandler<
  SearchProfessionalsQuery,
  Professional[]
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: SearchProfessionalsQuery): Promise<Professional[]> {
    if (!query.cuit) return [];
    return this.prisma.professional.findMany({
      where: { cuit: query.cuit },
    });
  }
}
