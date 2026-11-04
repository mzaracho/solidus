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
  FindAllPatientsQuery,
  FindAllPatientsQueryHandler,
} from './queries/find-all-patients-query';
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
      .mockResolvedValueOnce({ id, organizationId: orgA })
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
      .mockResolvedValueOnce({ id, organizationId: orgA })
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

describe('Lecturas por id de un profesional sin membresia (decision 7 del 009)', () => {
  const pid = randomUUID();
  const proCtx = makeCtx({ roles: { [orgA]: null } });
  const ME = randomUUID();

  const prismaFor = (opts: {
    own: Array<{ id: string; canLoadActivities: boolean }>;
    attended?: boolean;
  }) => {
    const prisma: any = {
      patient: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: pid, organizationId: orgA }),
      },
      professional: { findMany: jest.fn().mockResolvedValue(opts.own) },
      workItem: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.attended ? { id: randomUUID() } : null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    return prisma;
  };
  const handlers = (prisma: any) => ({
    debt: new GetDebtQueryHandler(
      { getDebt: jest.fn().mockResolvedValue(7) } as any,
      prisma,
    ),
    summary: new GetPatientSummaryQueryHandler(prisma),
  });

  it('con membresia: sin consultas extra (como antes)', async () => {
    const prisma = prismaFor({ own: [] });
    const { debt, summary } = handlers(prisma);
    await expect(debt.execute(new GetDebtQuery(pid), ctx)).resolves.toBe(7);
    await summary.execute(new GetPatientSummaryQuery(pid), ctx);
    expect(prisma.professional.findMany).not.toHaveBeenCalled();
    expect(prisma.workItem.findFirst).not.toHaveBeenCalled();
  });

  it('paciente que atendio (propio o participante): 200, consulta acotada a sus Professional', async () => {
    const prisma = prismaFor({
      own: [{ id: ME, canLoadActivities: false }],
      attended: true,
    });
    const { debt, summary } = handlers(prisma);
    await expect(debt.execute(new GetDebtQuery(pid), proCtx)).resolves.toBe(7);
    await expect(
      summary.execute(new GetPatientSummaryQuery(pid), proCtx),
    ).resolves.toEqual({ totalDebt: 0, pendingItems: [] });
    expect(prisma.professional.findMany.mock.calls[0][0].where).toEqual({
      userId: proCtx.org!.userId,
      organizationId: orgA,
      status: 'ACTIVE',
      deletedAt: null,
    });
    expect(prisma.workItem.findFirst.mock.calls[0][0].where).toEqual({
      patientId: pid,
      OR: [
        { professionalId: { in: [ME] } },
        { participants: { some: { professionalId: { in: [ME] } } } },
      ],
    });
  });

  it('MEDIA-1: sin membresia, la deuda y el resumen se acotan a sus Professional (aun con permiso de carga)', async () => {
    const OTHER_PRO = randomUUID();
    for (const canLoad of [false, true]) {
      const prisma = prismaFor({
        own: [{ id: ME, canLoadActivities: canLoad }],
        attended: true,
      });
      // el "backend" devuelve solo lo que el filtro permite: atenciones de ME
      prisma.workItem.findMany.mockImplementation(async (a: any) => {
        const ids = a.where.OR?.[0]?.professionalId?.in ?? [];
        const all = [
          { id: 'w1', professionalId: ME, grossAmount: 10 },
          { id: 'w2', professionalId: OTHER_PRO, grossAmount: 99 },
        ].filter((w) => ids.includes(w.professionalId));
        return all.map((w) => ({
          ...w,
          occurredAt: new Date(),
          serviceType: 'S',
          paymentStatus: 'PENDING',
          payer: { name: 'P' },
          professional: { displayName: 'Yo' },
        }));
      });
      const getDebt = jest.fn().mockResolvedValue(10);
      const debt = new GetDebtQueryHandler({ getDebt } as any, prisma);
      await debt.execute(new GetDebtQuery(pid), proCtx);
      expect(getDebt).toHaveBeenCalledWith(pid, [ME]);
      const res = await new GetPatientSummaryQueryHandler(prisma).execute(
        new GetPatientSummaryQuery(pid),
        proCtx,
      );
      expect(res.totalDebt).toBe(10);
      expect(res.pendingItems.map((i) => i.id)).toEqual(['w1']);
    }
  });

  it('miembro: sin acotar (getDebt sin professionalIds)', async () => {
    const prisma = prismaFor({ own: [] });
    const getDebt = jest.fn().mockResolvedValue(7);
    await new GetDebtQueryHandler({ getDebt } as any, prisma).execute(
      new GetDebtQuery(pid),
      ctx,
    );
    expect(getDebt).toHaveBeenCalledWith(pid, undefined);
    await new GetPatientSummaryQueryHandler(prisma).execute(
      new GetPatientSummaryQuery(pid),
      ctx,
    );
    expect(prisma.workItem.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });

  it('paciente que no atendio y sin permiso de carga: el mismo 404 generico, sin calcular ni listar', async () => {
    const prisma = prismaFor({
      own: [{ id: ME, canLoadActivities: false }],
      attended: false,
    });
    const getDebt = jest.fn();
    const debt = new GetDebtQueryHandler({ getDebt } as any, prisma);
    const summary = new GetPatientSummaryQueryHandler(prisma);
    for (const run of [
      () => debt.execute(new GetDebtQuery(pid), proCtx),
      () => summary.execute(new GetPatientSummaryQuery(pid), proCtx),
    ]) {
      const e = await errorOf(run);
      expect(e).toBeInstanceOf(NotFoundException);
      expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    }
    expect(getDebt).not.toHaveBeenCalled();
    expect(prisma.workItem.findMany).not.toHaveBeenCalled();
  });

  it('con permiso de carga en la organizacion: cualquier paciente de ella', async () => {
    const prisma = prismaFor({
      own: [{ id: ME, canLoadActivities: true }],
      attended: false,
    });
    const { debt } = handlers(prisma);
    await expect(debt.execute(new GetDebtQuery(pid), proCtx)).resolves.toBe(7);
    expect(prisma.workItem.findFirst).not.toHaveBeenCalled();
  });

  it('sin Professional activo en la organizacion: 404', async () => {
    const prisma = prismaFor({ own: [] });
    const { summary } = handlers(prisma);
    const e = await errorOf(() =>
      summary.execute(new GetPatientSummaryQuery(pid), proCtx),
    );
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
  });
});

describe('FindAllPatientsQueryHandler: includeCurrentOrg y vista (009)', () => {
  const other = randomUUID();
  const pro = (organizationId: string, canLoadActivities: boolean) => ({
    id: randomUUID(),
    organizationId,
    canLoadActivities,
  });
  const run = async (
    role: 'ADMIN' | 'MEMBER' | null,
    view: Parameters<typeof makeCtx>[0]['view'],
  ) => {
    const findAll = jest.fn().mockResolvedValue({ items: [], total: 0 });
    const handler = new FindAllPatientsQueryHandler({ findAll } as any);
    const query = new FindAllPatientsQuery();
    query.organizationId = orgA;
    await handler.execute(query, makeCtx({ roles: { [orgA]: role }, view }));
    return findAll.mock.calls[0];
  };

  it('miembro: true', async () => {
    const [, view, opts] = await run('MEMBER', { mode: 'pro', professionals: [pro(orgA, false)] });
    expect(view.mode).toBe('pro');
    expect(opts).toEqual({ includeCurrentOrg: true });
  });
  it('miembro en org: true', async () => {
    const [, , opts] = await run('ADMIN', { mode: 'org' });
    expect(opts).toEqual({ includeCurrentOrg: true });
  });
  it('profesional con permiso de carga en la organizacion: true', async () => {
    const [, , opts] = await run(null, { mode: 'pro', professionals: [pro(orgA, true)] });
    expect(opts).toEqual({ includeCurrentOrg: true });
  });
  it('profesional sin permiso de carga: false', async () => {
    const [, , opts] = await run(null, { mode: 'pro', professionals: [pro(orgA, false)] });
    expect(opts).toEqual({ includeCurrentOrg: false });
  });
  it('permiso de carga solo en otra organizacion: false', async () => {
    const [, , opts] = await run(null, {
      mode: 'pro',
      professionals: [pro(orgA, false), pro(other, true)],
    });
    expect(opts).toEqual({ includeCurrentOrg: false });
  });
  it('sin ctx.view: 403 forbidden', async () => {
    const handler = new FindAllPatientsQueryHandler({ findAll: jest.fn() } as any);
    const query = new FindAllPatientsQuery();
    query.organizationId = orgA;
    const e = await errorOf(() =>
      handler.execute(query, makeCtx({ roles: { [orgA]: 'ADMIN' } })),
    );
    expect(e.getStatus()).toBe(403);
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
