/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { REQUEST_HANDLER_METADATA_KEY } from '@src/infrastructure.bootstrap/config/core/cqrs/constant';
import {
  errorOf,
  makeCtx,
  NOT_FOUND_BODY,
} from '../../../../test/helpers/scope';
import { GetDebtQuery, GetDebtQueryHandler } from './queries/get-debt-query';
import {
  GetPatientSummaryQuery,
  GetPatientSummaryQueryHandler,
} from './queries/get-patient-summary-query';
import {
  UpdatePatientCommand,
  UpdatePatientCommandHandler,
} from './commands/update-patient-command';
import {
  MergePatientCommand,
  MergePatientCommandHandler,
} from './commands/merge-patient-command';

const orgA = randomUUID();
const orgB = randomUUID();
const ctx = makeCtx({ roles: { [orgA]: 'MEMBER' } });
const ctxTwoOrgs = makeCtx({ roles: { [orgA]: 'MEMBER', [orgB]: null } });

describe('GetDebtQueryHandler / GetPatientSummaryQueryHandler', () => {
  it('debt propio: calcula; ajeno o inexistente: 404 genérico sin calcular', async () => {
    const id = randomUUID();
    const patientService: any = { getDebt: jest.fn().mockResolvedValue(42) };
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id })
      .mockResolvedValueOnce(null);
    const handler = new GetDebtQueryHandler(patientService, {
      patient: { findFirst },
    } as any);
    await expect(handler.execute(new GetDebtQuery(id), ctx)).resolves.toBe(42);
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id,
      organizationId: { in: [orgA] },
    });
    patientService.getDebt.mockClear();
    const e = await errorOf(() =>
      handler.execute(new GetDebtQuery(randomUUID()), ctx),
    );
    expect(e).toBeInstanceOf(NotFoundException);
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(patientService.getDebt).not.toHaveBeenCalled();
  });

  it('summary propio: lista; ajeno: 404 genérico sin listar', async () => {
    const id = randomUUID();
    const findMany = jest.fn().mockResolvedValue([]);
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id })
      .mockResolvedValueOnce(null);
    const handler = new GetPatientSummaryQueryHandler({
      patient: { findFirst },
      workItem: { findMany },
    } as any);
    await expect(
      handler.execute(new GetPatientSummaryQuery(id), ctx),
    ).resolves.toEqual({
      totalDebt: 0,
      pendingItems: [],
    });
    findMany.mockClear();
    const e = await errorOf(() =>
      handler.execute(new GetPatientSummaryQuery(randomUUID()), ctx),
    );
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('UpdatePatientCommandHandler', () => {
  const cmd = (id: string) => new UpdatePatientCommand(id, 'Ana', 'Prueba');

  it('propio: actualiza; ajeno: 404 y sin update', async () => {
    const id = randomUUID();
    const update = jest.fn().mockResolvedValue({
      id,
      organizationId: orgA,
      firstName: 'Ana',
      lastName: 'Prueba',
      email: null,
      phone: null,
    });
    const patientService: any = { update };
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id })
      .mockResolvedValueOnce(null);
    const handler = new UpdatePatientCommandHandler(patientService, {
      patient: { findFirst },
    } as any);
    const res = await handler.execute(cmd(id), ctx);
    expect(res.id).toBe(id);
    expect(update).toHaveBeenCalledWith(id, expect.anything());
    update.mockClear();
    const e = await errorOf(() => handler.execute(cmd(randomUUID()), ctx));
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(update).not.toHaveBeenCalled();
  });

  it('el handler está registrado (decoradores)', () => {
    expect(
      Reflect.getMetadata(REQUEST_HANDLER_METADATA_KEY, UpdatePatientCommand),
    ).toBe(UpdatePatientCommandHandler);
  });
});

describe('MergePatientCommandHandler', () => {
  const cmd = (sourceId: string, targetId: string) =>
    Object.assign(new MergePatientCommand(), { sourceId, targetId });

  const setup = (rows: Record<string, any>) => {
    const tx = {
      workItem: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      patient: { delete: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      patient: {
        findFirst: jest
          .fn()
          .mockImplementation(async (a: any) => rows[a.where.id] ?? null),
      },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
    };
    return { prisma, tx, handler: new MergePatientCommandHandler(prisma) };
  };

  it.each([undefined, null, '', 5, {}, ['x']])(
    'targetId %p: 400 y ninguna consulta ni escritura',
    async (targetId) => {
      const { prisma, handler } = setup({});
      let e: any;
      try {
        await handler.execute(cmd(randomUUID(), targetId as any), ctx);
      } catch (err) {
        e = err;
      }
      expect(e.getStatus()).toBe(400);
      expect(prisma.patient.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('legítimo: updateMany y delete dentro de $transaction', async () => {
    const s = randomUUID();
    const t = randomUUID();
    const { prisma, tx, handler } = setup({
      [s]: { id: s, organizationId: orgA },
      [t]: { id: t, organizationId: orgA },
    });
    await handler.execute(cmd(s, t), ctx);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.workItem.updateMany).toHaveBeenCalledWith({
      where: { patientId: s },
      data: { patientId: t },
    });
    expect(tx.patient.delete).toHaveBeenCalledWith({ where: { id: s } });
  });

  it('destino de otra organización (no está en el scope): 404 y sin escrituras', async () => {
    const s = randomUUID();
    const t = randomUUID();
    const { prisma, tx, handler } = setup({
      [s]: { id: s, organizationId: orgA },
    });
    const e = await errorOf(() => handler.execute(cmd(s, t), ctx));
    expect(e).toBeInstanceOf(NotFoundException);
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.workItem.updateMany).not.toHaveBeenCalled();
    expect(tx.patient.delete).not.toHaveBeenCalled();
  });

  it('origen ajeno: 404 y sin escrituras', async () => {
    const s = randomUUID();
    const t = randomUUID();
    const { prisma, handler } = setup({ [t]: { id: t, organizationId: orgA } });
    const e = await errorOf(() => handler.execute(cmd(s, t), ctx));
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('dos organizaciones distintas dentro del scope: 404 y sin escrituras', async () => {
    const s = randomUUID();
    const t = randomUUID();
    const { prisma, handler } = setup({
      [s]: { id: s, organizationId: orgA },
      [t]: { id: t, organizationId: orgB },
    });
    const e = await errorOf(() => handler.execute(cmd(s, t), ctxTwoOrgs));
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fusionar un paciente consigo mismo: 400 sin consultar ni escribir', async () => {
    const s = randomUUID();
    const { prisma, handler } = setup({});
    const e = await errorOf(() =>
      handler.execute(cmd(s, s.toUpperCase()), ctx),
    );
    expect(e).toBeInstanceOf(BadRequestException);
    expect(prisma.patient.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ids que no son UUID: 404 sin consultar', async () => {
    const { prisma, handler } = setup({});
    const e = await errorOf(() =>
      handler.execute(cmd('abc', randomUUID()), ctx),
    );
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(prisma.patient.findFirst).not.toHaveBeenCalled();
  });
});
