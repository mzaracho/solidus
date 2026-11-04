/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { errorOf } from '../../../../test/helpers/scope';
import { FeeResolutionService } from './fee-resolution.service';

describe('FeeResolutionService.calculateSplits', () => {
  it('organización inexistente: 500 controlado, sin el id en el mensaje', async () => {
    const organizationId = randomUUID();
    const prisma: any = {
      organization: { findUnique: jest.fn().mockResolvedValue(null) },
      feeRule: { findMany: jest.fn() },
    };
    const service = new FeeResolutionService(prisma);
    const e = await errorOf(() =>
      service.calculateSplits({
        organizationId,
        payerId: randomUUID(),
        amount: 100,
      } as any),
    );
    expect(e).toBeInstanceOf(InternalServerErrorException);
    expect((e as Error).message).not.toContain(organizationId);
    expect(prisma.feeRule.findMany).not.toHaveBeenCalled();
  });
});
