/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import {
  errorOf,
  FORBIDDEN_BODY,
  makeCtx,
  NOT_FOUND_BODY,
} from '../../../../test/helpers/scope';
import {
  CreateFeeRuleCommand,
  CreateFeeRuleCommandHandler,
} from './commands/fee-rule-commands';

const orgA = randomUUID();
const orgB = randomUUID();
const me = randomUUID();
const ctxOf = (role: 'ADMIN' | 'MEMBER' | null) =>
  makeCtx({ userId: me, roles: { [orgA]: role } });

const command = (data: Record<string, any>) =>
  Object.assign(new CreateFeeRuleCommand(), { data });

const setup = (payer: any) => {
  const prisma: any = {
    payer: { findFirst: jest.fn().mockResolvedValue(payer) },
    feeRule: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  return { prisma, handler: new CreateFeeRuleCommandHandler(prisma) };
};

const splits = [
  { role: 'PROFESSIONAL', percentage: 70, beneficiaryType: 'PROFESSIONAL' },
];

describe('POST fee-rules (CreateFeeRuleCommandHandler)', () => {
  it('pagador de otra organización: 404 y sin escritura', async () => {
    const { prisma, handler } = setup(null);
    const e = await errorOf(() =>
      handler.execute(
        command({
          name: 'R',
          splits,
          payer: { connect: { id: randomUUID() } },
        }),
        ctxOf('ADMIN'),
      ),
    );
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(prisma.feeRule.create).not.toHaveBeenCalled();
    expect(prisma.feeRule.update).not.toHaveBeenCalled();
    expect(prisma.payer.findFirst.mock.calls[0][0].where.organizationId).toBe(
      orgA,
    );
  });

  it('ADMIN con un pagador de la organización: crea', async () => {
    const payerId = randomUUID();
    const { prisma, handler } = setup({ id: payerId, professional: null });
    await handler.execute(
      command({ name: 'R', splits, payer: { connect: { id: payerId } } }),
      ctxOf('ADMIN'),
    );
    expect(prisma.feeRule.create).toHaveBeenCalledTimes(1);
  });

  it('no ADMIN con un pagador propio: crea', async () => {
    const payerId = randomUUID();
    const { prisma, handler } = setup({
      id: payerId,
      professional: { userId: me },
    });
    await handler.execute(command({ name: 'R', splits, payerId }), ctxOf(null));
    expect(prisma.feeRule.create).toHaveBeenCalledTimes(1);
  });

  it('no ADMIN con un pagador ajeno: 403', async () => {
    const payerId = randomUUID();
    const { prisma, handler } = setup({
      id: payerId,
      professional: { userId: randomUUID() },
    });
    const e = await errorOf(() =>
      handler.execute(command({ name: 'R', splits, payerId }), ctxOf('MEMBER')),
    );
    expect(e.getResponse()).toEqual(FORBIDDEN_BODY);
    expect(prisma.feeRule.create).not.toHaveBeenCalled();
  });

  it('no ADMIN sin pagador, o con un pagador del sistema: 403', async () => {
    const a = setup(null);
    const e1 = await errorOf(() =>
      a.handler.execute(command({ name: 'R', splits }), ctxOf('MEMBER')),
    );
    expect(e1.getResponse()).toEqual(FORBIDDEN_BODY);
    const payerId = randomUUID();
    const b = setup({ id: payerId, professional: null });
    const e2 = await errorOf(() =>
      b.handler.execute(command({ name: 'R', splits, payerId }), ctxOf(null)),
    );
    expect(e2.getResponse()).toEqual(FORBIDDEN_BODY);
    expect(a.prisma.feeRule.create).not.toHaveBeenCalled();
    expect(b.prisma.feeRule.create).not.toHaveBeenCalled();
  });

  it('un body con payer.create y organization.connect a otra organización no llega a Prisma', async () => {
    const payerId = randomUUID();
    const { prisma, handler } = setup({ id: payerId, professional: null });
    await handler.execute(
      command({
        name: 'R',
        splits,
        payer: {
          connect: { id: payerId },
          create: { name: 'X', organization: { connect: { id: orgB } } },
        },
        organization: { connect: { id: orgB } },
        organizationId: orgB,
        id: randomUUID(),
      }),
      ctxOf('ADMIN'),
    );
    const data = prisma.feeRule.create.mock.calls[0][0].data;
    expect(data.organization).toEqual({ connect: { id: orgA } });
    expect(data.payer).toEqual({ connect: { id: payerId } });
    expect(JSON.stringify(data)).not.toContain(orgB);
    expect(Object.keys(data).sort()).toEqual([
      'name',
      'organization',
      'payer',
      'splits',
    ]);
  });

  it('regla existente del pagador: solo actualiza splits', async () => {
    const payerId = randomUUID();
    const { prisma, handler } = setup({ id: payerId, professional: null });
    prisma.feeRule.findFirst.mockResolvedValue({ id: 'r1' });
    await handler.execute(
      command({ name: 'R', splits, payerId, professionalCategory: 'all' }),
      ctxOf('ADMIN'),
    );
    expect(prisma.feeRule.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { splits },
    });
    expect(prisma.feeRule.create).not.toHaveBeenCalled();
    expect(prisma.feeRule.findFirst.mock.calls[0][0].where).toMatchObject({
      organizationId: orgA,
      payerId,
      professionalCategory: 'all',
    });
  });
});

describe('POST fee-rules: validación de splits', () => {
  const payerId = randomUUID();
  const run = async (splitsValue: any) => {
    const { prisma, handler } = setup({ id: payerId, professional: null });
    const e = await errorOf(() =>
      handler.execute(
        command({
          name: 'R',
          splits: splitsValue,
          payer: { connect: { id: payerId } },
        }),
        ctxOf('ADMIN'),
      ),
    );
    return { prisma, e };
  };

  it('splits inválidos: 400 genérico y sin escritura (crear)', async () => {
    for (const bad of [
      [
        {
          role: 'PROFESSIONAL',
          percentage: 150,
          beneficiaryType: 'PROFESSIONAL',
        },
      ],
      [
        {
          role: 'PROFESSIONAL',
          percentage: -5,
          beneficiaryType: 'PROFESSIONAL',
        },
      ],
      { professional: 70 },
    ]) {
      const { prisma, e } = await run(bad);
      expect(e.getStatus()).toBe(400);
      expect(prisma.feeRule.create).not.toHaveBeenCalled();
      expect(prisma.feeRule.update).not.toHaveBeenCalled();
    }
  });

  it('splits inválidos al editar la regla existente: 400 y sin update', async () => {
    const { prisma, handler } = setup({ id: payerId, professional: null });
    prisma.feeRule.findFirst.mockResolvedValue({ id: randomUUID() });
    const e = await errorOf(() =>
      handler.execute(
        command({
          name: 'R',
          splits: [
            { role: 'P', percentage: 101, beneficiaryType: 'PROFESSIONAL' },
          ],
          payer: { connect: { id: payerId } },
        }),
        ctxOf('ADMIN'),
      ),
    );
    expect(e.getStatus()).toBe(400);
    expect(prisma.feeRule.update).not.toHaveBeenCalled();
  });

  it('splits de la UI: crea', async () => {
    const { prisma, e } = await run([
      { role: 'PROFESSIONAL', percentage: 70, beneficiaryType: 'PROFESSIONAL' },
      { role: 'ORGANIZATION', percentage: 30, beneficiaryType: 'ORGANIZATION' },
    ]);
    expect(e).toBeUndefined();
    expect(prisma.feeRule.create).toHaveBeenCalledTimes(1);
  });
});
