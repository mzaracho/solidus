/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  errorOf,
  FORBIDDEN_BODY,
  makeCtx,
  NOT_FOUND_BODY,
} from '../../../../test/helpers/scope';
import {
  FindActivityByIdQuery,
  FindActivityByIdQueryHandler,
} from './queries/find-activity-by-id-query';
import {
  UpdateActivityCommand,
  UpdateActivityCommandHandler,
} from './commands/update-activity-command';
import {
  DeleteActivityCommand,
  DeleteActivityCommandHandler,
} from './commands/delete-activity-command';
import { canModifyActivity } from './activity-ownership';

const orgA = randomUUID();
const orgB = randomUUID();

const baseItem = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  organizationId: orgA,
  createdByUserId: null as string | null,
  paymentStatus: 'UNPAID',
  paymentDate: null,
  professional: { userId: null as string | null },
  ...over,
});

describe('FindActivityByIdQueryHandler', () => {
  const full = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    organizationId: orgA,
    occurredAt: new Date('2026-01-02T12:00:00Z'),
    serviceType: 'session',
    patient: { firstName: 'Ana', lastName: 'Prueba' },
    professional: { displayName: 'Pro Uno' },
    payer: null,
    preset: null,
    splits: [],
    grossAmount: 10,
    professionalId: randomUUID(),
    ...over,
  });

  it('propia: 200 y el where filtra por las organizaciones del scope', async () => {
    const id = randomUUID();
    const findFirst = jest.fn().mockResolvedValue(full(id));
    const handler = new FindActivityByIdQueryHandler({
      workItem: { findFirst },
    } as any);
    const res = await handler.execute(
      new FindActivityByIdQuery(id),
      makeCtx({ roles: { [orgA]: 'MEMBER' } }),
    );
    expect(res.id).toBe(id);
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id,
      organizationId: { in: [orgA] },
    });
  });

  it('de otra organización o inexistente: mismo 404 genérico', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const handler = new FindActivityByIdQueryHandler({
      workItem: { findFirst },
    } as any);
    const ctx = makeCtx({ roles: { [orgA]: 'ADMIN' } });
    const e1 = await errorOf(() =>
      handler.execute(new FindActivityByIdQuery(randomUUID()), ctx),
    );
    const e2 = await errorOf(() =>
      handler.execute(new FindActivityByIdQuery(randomUUID()), ctx),
    );
    expect(e1).toBeInstanceOf(NotFoundException);
    expect(e1.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(e2.getResponse()).toEqual(e1.getResponse());
  });

  describe('vinculo solo de Professional (decision 7 del 009)', () => {
    const ME = randomUUID();
    const proCtx = makeCtx({ roles: { [orgA]: null } });
    const setup = (
      activity: Record<string, unknown>,
      own: string[],
      participates: boolean,
    ) => {
      const prisma: any = {
        workItem: { findFirst: jest.fn().mockResolvedValue(activity) },
        professional: {
          findMany: jest.fn().mockResolvedValue(own.map((id) => ({ id }))),
        },
        workItemParticipant: {
          findFirst: jest
            .fn()
            .mockResolvedValue(participates ? { id: randomUUID() } : null),
        },
      };
      return { prisma, handler: new FindActivityByIdQueryHandler(prisma) };
    };

    it('atencion de su Professional: 200', async () => {
      const id = randomUUID();
      const { prisma, handler } = setup(full(id, { professionalId: ME }), [ME], false);
      const res = await handler.execute(new FindActivityByIdQuery(id), proCtx);
      expect(res.id).toBe(id);
      expect(prisma.professional.findMany.mock.calls[0][0].where).toEqual({
        userId: proCtx.org!.userId,
        organizationId: orgA,
        status: 'ACTIVE',
        deletedAt: null,
      });
      expect(prisma.workItemParticipant.findFirst).not.toHaveBeenCalled();
    });

    it('atencion donde participa: 200', async () => {
      const id = randomUUID();
      const { prisma, handler } = setup(full(id), [ME], true);
      const res = await handler.execute(new FindActivityByIdQuery(id), proCtx);
      expect(res.id).toBe(id);
      expect(prisma.workItemParticipant.findFirst.mock.calls[0][0].where).toEqual({
        workItemId: id,
        professionalId: { in: [ME] },
      });
    });

    it('atencion ajena (otro profesional, sin participar): el mismo 404 generico', async () => {
      const id = randomUUID();
      const { handler } = setup(full(id), [ME], false);
      const e = await errorOf(() =>
        handler.execute(new FindActivityByIdQuery(id), proCtx),
      );
      expect(e).toBeInstanceOf(NotFoundException);
      expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    });

    it('sin Professional activo en la organizacion: 404 sin consultar participaciones', async () => {
      const id = randomUUID();
      const { prisma, handler } = setup(full(id), [], true);
      const e = await errorOf(() =>
        handler.execute(new FindActivityByIdQuery(id), proCtx),
      );
      expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
      expect(prisma.workItemParticipant.findFirst).not.toHaveBeenCalled();
    });

    it('con membresia: sin consultas extra', async () => {
      const id = randomUUID();
      const { prisma, handler } = setup(full(id), [], false);
      await handler.execute(
        new FindActivityByIdQuery(id),
        makeCtx({ roles: { [orgA]: 'MEMBER' } }),
      );
      expect(prisma.professional.findMany).not.toHaveBeenCalled();
    });
  });

  it('id que no es UUID: 404 sin llamar a Prisma', async () => {
    const findFirst = jest.fn();
    const handler = new FindActivityByIdQueryHandler({
      workItem: { findFirst },
    } as any);
    const e = await errorOf(() =>
      handler.execute(
        new FindActivityByIdQuery('abc'),
        makeCtx({ roles: { [orgA]: 'ADMIN' } }),
      ),
    );
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('sin scope de organización: 403', async () => {
    const handler = new FindActivityByIdQueryHandler({} as any);
    const e = await errorOf(() =>
      handler.execute(
        new FindActivityByIdQuery(randomUUID()),
        undefined as any,
      ),
    );
    expect(e).toBeInstanceOf(ForbiddenException);
  });
});

describe('canModifyActivity (política de ownership, sin x-mode)', () => {
  const me = randomUUID();
  const other = randomUUID();
  const scopeOf = (role: 'ADMIN' | 'MEMBER' | null) =>
    makeCtx({ userId: me, roles: { [orgA]: role } }).org!;

  // [nombre, rol, createdBy, dueño del Professional, edit esperado, delete esperado]
  const matrix: Array<
    [
      string,
      'ADMIN' | 'MEMBER' | null,
      string | null,
      string | null,
      boolean,
      boolean,
    ]
  > = [
    ['ADMIN con atención ajena', 'ADMIN', other, null, true, true],
    ['ADMIN con createdBy null', 'ADMIN', null, other, true, true],
    ['MEMBER propia', 'MEMBER', me, null, true, true],
    ['MEMBER ajena', 'MEMBER', other, null, true, false],
    ['MEMBER null con otro usuario', 'MEMBER', null, other, true, false],
    ['MEMBER null con dueño del Professional', 'MEMBER', null, me, true, true],
    ['profesional propia', null, me, null, true, true],
    ['profesional ajena', null, other, me, false, false],
    ['profesional null con dueño del Professional', null, null, me, true, true],
    ['profesional null con otro usuario', null, null, other, false, false],
    [
      'profesional null y Professional sin usuario',
      null,
      null,
      null,
      false,
      false,
    ],
  ];

  it.each(matrix)('%s', (_name, role, createdBy, proUser, edit, del) => {
    const item = baseItem({
      createdByUserId: createdBy,
      professional: { userId: proUser },
    }) as any;
    expect(canModifyActivity(item, scopeOf(role), 'edit')).toBe(edit);
    expect(canModifyActivity(item, scopeOf(role), 'delete')).toBe(del);
  });

  it('un rol en otra organización no vale para la de la atención', () => {
    const scope = makeCtx({
      userId: me,
      roles: { [orgA]: 'MEMBER', [orgB]: 'ADMIN' },
    }).org!;
    const item = baseItem({
      organizationId: orgA,
      createdByUserId: other,
    }) as any;
    expect(canModifyActivity(item, scope, 'delete')).toBe(false);
  });
});

describe('Update y Delete de atenciones', () => {
  const me = randomUUID();
  const other = randomUUID();

  const setup = (found: any) => {
    const prisma: any = {
      workItem: {
        findFirst: jest.fn().mockResolvedValue(found),
        update: jest.fn().mockResolvedValue({ id: 'upd' }),
        delete: jest.fn().mockResolvedValue({ id: 'del' }),
      },
    };
    return {
      prisma,
      update: new UpdateActivityCommandHandler(prisma),
      del: new DeleteActivityCommandHandler(prisma),
    };
  };
  const upd = (id: string) =>
    Object.assign(new UpdateActivityCommand(), { id, attendance: 'PRESENT' });
  const ctxOf = (role: 'ADMIN' | 'MEMBER' | null) =>
    makeCtx({ userId: me, roles: { [orgA]: role } });

  it('otra organización o inexistente: 404 genérico y sin update ni delete', async () => {
    const { prisma, update, del } = setup(null);
    const ctx = ctxOf('ADMIN');
    const e1 = await errorOf(() => update.execute(upd(randomUUID()), ctx));
    const e2 = await errorOf(() =>
      del.execute(new DeleteActivityCommand(randomUUID()), ctx),
    );
    expect(e1).toBeInstanceOf(NotFoundException);
    expect(e1.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(e2.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(prisma.workItem.update).not.toHaveBeenCalled();
    expect(prisma.workItem.delete).not.toHaveBeenCalled();
    expect(
      prisma.workItem.findFirst.mock.calls[0][0].where.organizationId,
    ).toEqual({
      in: [orgA],
    });
  });

  it('update: ADMIN y MEMBER (decisión 1) editan una atención ajena', async () => {
    for (const role of ['ADMIN', 'MEMBER'] as const) {
      const { prisma, update } = setup(baseItem({ createdByUserId: other }));
      await update.execute(upd(randomUUID()), ctxOf(role));
      expect(prisma.workItem.update).toHaveBeenCalledTimes(1);
    }
  });

  it('update: profesional con atención ajena, 403 forbidden y sin update', async () => {
    const { prisma, update } = setup(baseItem({ createdByUserId: other }));
    const e = await errorOf(() =>
      update.execute(upd(randomUUID()), ctxOf(null)),
    );
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(e.getResponse()).toEqual(FORBIDDEN_BODY);
    expect(prisma.workItem.update).not.toHaveBeenCalled();
  });

  it('update: profesional con null y dueño del Professional pasa; con null y otro usuario, 403', async () => {
    const ok = setup(baseItem({ professional: { userId: me } }));
    await ok.update.execute(upd(randomUUID()), ctxOf(null));
    expect(ok.prisma.workItem.update).toHaveBeenCalled();
    const no = setup(baseItem({ professional: { userId: other } }));
    const e = await errorOf(() =>
      no.update.execute(upd(randomUUID()), ctxOf(null)),
    );
    expect(e.getResponse()).toEqual(FORBIDDEN_BODY);
    expect(no.prisma.workItem.update).not.toHaveBeenCalled();
  });

  it('update: el where usa el id normalizado de la ruta', async () => {
    const { prisma, update } = setup(baseItem({ createdByUserId: me }));
    const id = randomUUID();
    await update.execute(upd(id.toUpperCase()), ctxOf(null));
    expect(prisma.workItem.update.mock.calls[0][0].where).toEqual({ id });
  });

  it('delete: MEMBER propia pasa; MEMBER ajena, 403 sin delete', async () => {
    const own = setup(baseItem({ createdByUserId: me }));
    await own.del.execute(
      new DeleteActivityCommand(randomUUID()),
      ctxOf('MEMBER'),
    );
    expect(own.prisma.workItem.delete).toHaveBeenCalledTimes(1);
    const foreign = setup(baseItem({ createdByUserId: other }));
    const e = await errorOf(() =>
      foreign.del.execute(
        new DeleteActivityCommand(randomUUID()),
        ctxOf('MEMBER'),
      ),
    );
    expect(e.getResponse()).toEqual(FORBIDDEN_BODY);
    expect(foreign.prisma.workItem.delete).not.toHaveBeenCalled();
  });

  it('delete: ADMIN borra una ajena; null con dueño del Professional pasa; null con otro, 403', async () => {
    const admin = setup(baseItem({ createdByUserId: other }));
    await admin.del.execute(
      new DeleteActivityCommand(randomUUID()),
      ctxOf('ADMIN'),
    );
    expect(admin.prisma.workItem.delete).toHaveBeenCalled();
    const owner = setup(baseItem({ professional: { userId: me } }));
    await owner.del.execute(
      new DeleteActivityCommand(randomUUID()),
      ctxOf(null),
    );
    expect(owner.prisma.workItem.delete).toHaveBeenCalled();
    const stranger = setup(baseItem({ professional: { userId: other } }));
    const e = await errorOf(() =>
      stranger.del.execute(
        new DeleteActivityCommand(randomUUID()),
        ctxOf(null),
      ),
    );
    expect(e.getResponse()).toEqual(FORBIDDEN_BODY);
    expect(stranger.prisma.workItem.delete).not.toHaveBeenCalled();
  });

  it('delete: cobrada con fecha de pago, 403 aun para ADMIN; el no dueño recibe primero el 403 de ownership', async () => {
    const paid = {
      paymentStatus: 'PAID',
      paymentDate: new Date(),
      createdByUserId: me,
    };
    const { prisma, del } = setup(baseItem(paid));
    const e = await errorOf(() =>
      del.execute(new DeleteActivityCommand(randomUUID()), ctxOf('ADMIN')),
    );
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(String(e.message)).toContain('cobrada');
    expect(prisma.workItem.delete).not.toHaveBeenCalled();

    const notOwner = setup(baseItem({ ...paid, createdByUserId: other }));
    const e2 = await errorOf(() =>
      notOwner.del.execute(
        new DeleteActivityCommand(randomUUID()),
        ctxOf(null),
      ),
    );
    expect(e2.getResponse()).toEqual(FORBIDDEN_BODY);
  });

  describe('delete: salvaguarda en el where (carrera con un cobro, 015)', () => {
    const p2025 = () =>
      new Prisma.PrismaClientKnownRequestError('no existe', {
        code: 'P2025',
        clientVersion: 'test',
      });
    const run = (setupResult: ReturnType<typeof setup>) =>
      errorOf(() =>
        setupResult.del.execute(
          new DeleteActivityCommand(randomUUID()),
          ctxOf('ADMIN'),
        ),
      );

    it('el where del delete incluye la condición NOT de cobrada con fecha de pago', async () => {
      const s = setup(baseItem({ createdByUserId: me }));
      const id = randomUUID();
      await s.del.execute(new DeleteActivityCommand(id), ctxOf('ADMIN'));
      expect(s.prisma.workItem.delete).toHaveBeenCalledWith({
        where: {
          id,
          NOT: { paymentStatus: 'PAID', paymentDate: { not: null } },
        },
      });
    });

    it('P2025 y la fila sigue en el scope (la cobraron en el medio): 403 con el mensaje de hoy', async () => {
      const s = setup(baseItem({ createdByUserId: me }));
      s.prisma.workItem.delete.mockRejectedValue(p2025());
      s.prisma.workItem.findFirst
        .mockResolvedValueOnce(baseItem({ createdByUserId: me }))
        .mockResolvedValueOnce({ id: 'w1' });
      const e = await run(s);
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(e.getResponse()).toEqual({
        code: 'forbidden',
        message:
          'No se puede eliminar una actividad ya cobrada con fecha de pago.',
      });
      // la segunda lectura filtra por el scope
      expect(
        s.prisma.workItem.findFirst.mock.calls[1][0].where.organizationId,
      ).toEqual({ in: [orgA] });
    });

    it('P2025 y la fila ya no existe: 404 genérico', async () => {
      const s = setup(baseItem({ createdByUserId: me }));
      s.prisma.workItem.delete.mockRejectedValue(p2025());
      s.prisma.workItem.findFirst
        .mockResolvedValueOnce(baseItem({ createdByUserId: me }))
        .mockResolvedValueOnce(null);
      const e = await run(s);
      expect(e).toBeInstanceOf(NotFoundException);
      expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    });

    it('otro error se propaga tal cual y sin segunda lectura', async () => {
      const s = setup(baseItem({ createdByUserId: me }));
      const boom = new Error('boom');
      s.prisma.workItem.delete.mockRejectedValue(boom);
      const e = await run(s);
      expect(e).toBe(boom);
      expect(s.prisma.workItem.findFirst).toHaveBeenCalledTimes(1);
    });
  });
});
