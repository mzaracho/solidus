/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  errorOf,
  FORBIDDEN_BODY,
  makeCtx,
  NOT_FOUND_BODY,
} from '../../../../test/helpers/scope';
import {
  CreateCategoryCommand,
  CreateCategoryCommandHandler,
  DeleteCategoryCommand,
  DeleteCategoryCommandHandler,
  UpdateCategoryCommand,
  UpdateCategoryCommandHandler,
} from './commands/category-commands';
import {
  CreatePresetCommand,
  CreatePresetCommandHandler,
  DeletePresetCommand,
  DeletePresetCommandHandler,
  UpdatePresetCommand,
  UpdatePresetCommandHandler,
} from './commands/preset-commands';
import {
  CreateActivityTypeCommand,
  CreateActivityTypeCommandHandler,
  DeleteActivityTypeCommand,
  DeleteActivityTypeCommandHandler,
  UpdateActivityTypeCommand,
  UpdateActivityTypeCommandHandler,
} from './commands/activity-type-commands';
import {
  AssignStaffCategoryCommand,
  AssignStaffCategoryCommandHandler,
  CreateStaffCommand,
  CreateStaffCommandHandler,
  DeleteStaffCommand,
  DeleteStaffCommandHandler,
  UpdateStaffCommand,
  UpdateStaffCommandHandler,
} from './commands/staff-commands';
import {
  CreatePayerCommand,
  CreatePayerCommandHandler,
  GetPayersQuery,
  GetPayersQueryHandler,
  DeletePayerCommand,
  DeletePayerCommandHandler,
  UpdatePayerCommand,
  UpdatePayerCommandHandler,
} from './commands/payer-commands';
import {
  LookupStaffByCuitQuery,
  LookupStaffByCuitQueryHandler,
} from './queries/lookup-staff-by-cuit-query';

const orgA = randomUUID();
const me = randomUUID();
const other = randomUUID();
const admin = makeCtx({ userId: me, roles: { [orgA]: 'ADMIN' } });

const assign = <T extends object>(
  cls: new () => T,
  props: Record<string, any>,
): T => Object.assign(new cls(), props);

/** Verifica un par propio / ajeno para update o delete: ajeno = 404 genérico y sin escritura. */
async function ownAndForeign(opts: {
  model: string;
  write: 'update' | 'delete';
  make: (prisma: any) => { execute: (c: any, ctx: any) => Promise<any> };
  command: (id: string) => any;
}) {
  const id = randomUUID();
  const writeFn = jest.fn().mockResolvedValue({ id });
  const findFirst = jest
    .fn()
    .mockResolvedValueOnce({ id })
    .mockResolvedValueOnce(null);
  const prisma: any = {
    [opts.model]: { findFirst, [opts.write]: writeFn },
    workItem: { count: jest.fn().mockResolvedValue(0) },
  };
  const handler = opts.make(prisma);

  await handler.execute(opts.command(id), admin);
  expect(writeFn).toHaveBeenCalledTimes(1);
  expect(findFirst.mock.calls[0][0].where).toEqual({
    id,
    organizationId: { in: [orgA] },
  });
  expect(writeFn.mock.calls[0][0].where).toEqual({ id });

  writeFn.mockClear();
  prisma.workItem.count.mockClear();
  const foreign = randomUUID();
  const e = await errorOf(() => handler.execute(opts.command(foreign), admin));
  expect(e.getStatus()).toBe(404);
  expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
  expect(writeFn).not.toHaveBeenCalled();
  expect(prisma.workItem.count).not.toHaveBeenCalled();
}

describe('categorías', () => {
  it('create usa la organización del scope y no la del body', async () => {
    const create = jest.fn().mockResolvedValue({});
    const handler = new CreateCategoryCommandHandler({
      professionalCategory: { create },
    } as any);
    await handler.execute(
      assign(CreateCategoryCommand, {
        name: 'Senior',
        percentage: 70,
      }),
      admin,
    );
    expect(create.mock.calls[0][0].data.organizationId).toBe(orgA);
  });

  it('update propio y ajeno', () =>
    ownAndForeign({
      model: 'professionalCategory',
      write: 'update',
      make: (p) => new UpdateCategoryCommandHandler(p),
      command: (id) => assign(UpdateCategoryCommand, { id, name: 'N' }),
    }));

  it('delete propio y ajeno', () =>
    ownAndForeign({
      model: 'professionalCategory',
      write: 'delete',
      make: (p) => new DeleteCategoryCommandHandler(p),
      command: (id) => new DeleteCategoryCommand(id),
    }));
});

describe('presets', () => {
  it('create usa la organización del scope', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'x', value: 1 });
    const handler = new CreatePresetCommandHandler({
      feePreset: { create },
    } as any);
    await handler.execute(
      assign(CreatePresetCommand, {
        name: 'P',
        baseValue: 1,
      }),
      admin,
    );
    expect(create.mock.calls[0][0].data.organizationId).toBe(orgA);
  });

  it('update propio y ajeno', () =>
    ownAndForeign({
      model: 'feePreset',
      write: 'update',
      make: (p) => new UpdatePresetCommandHandler(p),
      command: (id) =>
        assign(UpdatePresetCommand, { id, name: 'N', baseValue: 2 }),
    }));

  it('delete propio y ajeno', () =>
    ownAndForeign({
      model: 'feePreset',
      write: 'delete',
      make: (p) => new DeletePresetCommandHandler(p),
      command: (id) => new DeletePresetCommand(id),
    }));
});

describe('tipos de actividad', () => {
  it('create usa la organización del scope', async () => {
    const create = jest.fn().mockResolvedValue({});
    const handler = new CreateActivityTypeCommandHandler({
      activityType: { create },
    } as any);
    await handler.execute(
      assign(CreateActivityTypeCommand, {
        code: 'Una Cosa',
        name: 'N',
      }),
      admin,
    );
    expect(create.mock.calls[0][0].data.organizationId).toBe(orgA);
    expect(create.mock.calls[0][0].data.code).toBe('una_cosa');
  });

  it('update propio y ajeno', () =>
    ownAndForeign({
      model: 'activityType',
      write: 'update',
      make: (p) => new UpdateActivityTypeCommandHandler(p),
      command: (id) => assign(UpdateActivityTypeCommand, { id, name: 'N' }),
    }));

  it('delete propio y ajeno (el ajeno no cuenta usos)', () =>
    ownAndForeign({
      model: 'activityType',
      write: 'delete',
      make: (p) => new DeleteActivityTypeCommandHandler(p),
      command: (id) => new DeleteActivityTypeCommand(id),
    }));

  it('default del sistema (organizationId null) no está en el scope: 404 en update y delete', async () => {
    const update = jest.fn();
    const del = jest.fn();
    const prisma: any = {
      activityType: {
        findFirst: jest.fn().mockResolvedValue(null),
        update,
        delete: del,
      },
      workItem: { count: jest.fn() },
    };
    const id = randomUUID();
    const e1 = await errorOf(() =>
      new UpdateActivityTypeCommandHandler(prisma).execute(
        assign(UpdateActivityTypeCommand, { id, name: 'x' }),
        admin,
      ),
    );
    const e2 = await errorOf(() =>
      new DeleteActivityTypeCommandHandler(prisma).execute(
        new DeleteActivityTypeCommand(id),
        admin,
      ),
    );
    expect(e1.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(e2.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(prisma.workItem.count).not.toHaveBeenCalled();
  });

  it('delete propio con usos: 400 con el conteo', async () => {
    const id = randomUUID();
    const prisma: any = {
      activityType: {
        findFirst: jest.fn().mockResolvedValue({ id }),
        delete: jest.fn(),
      },
      workItem: { count: jest.fn().mockResolvedValue(3) },
    };
    const e = await errorOf(() =>
      new DeleteActivityTypeCommandHandler(prisma).execute(
        new DeleteActivityTypeCommand(id),
        admin,
      ),
    );
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as ConflictException).getResponse()).toMatchObject({
      code: 'conflict',
    });
    expect(prisma.activityType.delete).not.toHaveBeenCalled();
  });
});

describe('staff', () => {
  it('update propio y ajeno', () =>
    ownAndForeign({
      model: 'professional',
      write: 'update',
      make: (p) => new UpdateStaffCommandHandler(p),
      command: (id) =>
        assign(UpdateStaffCommand, {
          id,
          name: 'A',
          surname: 'B',
          email: 'a@example.test',
        }),
    }));

  it('delete ajeno: 404 y sin escrituras', async () => {
    const prisma: any = {
      professional: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const e = await errorOf(() =>
      new DeleteStaffCommandHandler(prisma).execute(
        new DeleteStaffCommand(randomUUID()),
        admin,
      ),
    );
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(prisma.professional.update).not.toHaveBeenCalled();
    expect(prisma.professional.delete).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  const deleteWithUser = async (others: {
    pros: number;
    memberships: number;
  }) => {
    const id = randomUUID();
    const userId = randomUUID();
    const tx: any = {
      professional: {
        update: jest.fn().mockResolvedValue({ id }),
        count: jest.fn().mockResolvedValue(others.pros),
      },
      organizationMember: {
        deleteMany: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(others.memberships),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      professional: {
        findFirst: jest.fn().mockResolvedValue({
          id,
          userId,
          organizationId: orgA,
          workItems: [],
        }),
      },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
    };
    await new DeleteStaffCommandHandler(prisma).execute(
      new DeleteStaffCommand(id),
      admin,
    );
    return { tx, userId };
  };

  it('delete con usuario sin otros vínculos: baja del User y de la membresía de esta organización', async () => {
    const { tx, userId } = await deleteWithUser({ pros: 0, memberships: 0 });
    expect(tx.organizationMember.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: orgA, userId },
    });
    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });

  it.each([[{ pros: 1, memberships: 0 }], [{ pros: 0, memberships: 1 }]])(
    'delete con usuario con otro vínculo (%j): el User no se da de baja',
    async (others) => {
      const { tx } = await deleteWithUser(others);
      expect(tx.professional.update).toHaveBeenCalledTimes(1);
      expect(tx.organizationMember.deleteMany).toHaveBeenCalledTimes(1);
      expect(tx.user.update).not.toHaveBeenCalled();
    },
  );

  it('AssignStaffCategory: categoría de otra organización, 404 y sin update', async () => {
    const proId = randomUUID();
    const prisma: any = {
      professional: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: proId, organizationId: orgA }),
        update: jest.fn(),
      },
      professionalCategory: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const e = await errorOf(() =>
      new AssignStaffCategoryCommandHandler(prisma).execute(
        assign(AssignStaffCategoryCommand, {
          id: proId,
          categoryId: randomUUID(),
        }),
        admin,
      ),
    );
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(prisma.professional.update).not.toHaveBeenCalled();
    expect(
      prisma.professionalCategory.findFirst.mock.calls[0][0].where
        .organizationId,
    ).toBe(orgA);
  });

  it('AssignStaffCategory propio: actualiza', async () => {
    const proId = randomUUID();
    const catId = randomUUID();
    const prisma: any = {
      professional: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: proId, organizationId: orgA }),
        update: jest.fn().mockResolvedValue({}),
      },
      professionalCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: catId }),
      },
    };
    await new AssignStaffCategoryCommandHandler(prisma).execute(
      assign(AssignStaffCategoryCommand, { id: proId, categoryId: catId }),
      admin,
    );
    expect(prisma.professional.update).toHaveBeenCalledWith({
      where: { id: proId },
      data: { categoryId: catId },
    });
  });

  const createStaff = (prisma: any, over: Record<string, any>) =>
    new CreateStaffCommandHandler(prisma).execute(
      assign(CreateStaffCommand, {
        name: 'A',
        surname: 'B',
        cuit: '20000000001',
        ...over,
      }),
      admin,
    );

  it('CreateStaff con CUIT duplicado en la organización: 409 conflict y sin create', async () => {
    const prisma: any = {
      professionalCategory: { findFirst: jest.fn() },
      professional: {
        findFirst: jest.fn().mockResolvedValue({ id: randomUUID() }),
        create: jest.fn(),
      },
      user: { findUnique: jest.fn() },
    };
    const e = await errorOf(() => createStaff(prisma, {}));
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse()).toEqual({
      code: 'conflict',
      message: 'Ya existe un profesional con ese CUIT en esta organización.',
    });
    expect(prisma.professional.create).not.toHaveBeenCalled();
  });

  it('CreateStaff con categoryId ajeno: 404 y sin create', async () => {
    const prisma: any = {
      professionalCategory: { findFirst: jest.fn().mockResolvedValue(null) },
      professional: { findFirst: jest.fn(), create: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    const e = await errorOf(() =>
      createStaff(prisma, { categoryId: randomUUID() }),
    );
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(prisma.professional.create).not.toHaveBeenCalled();
  });

  it('CreateStaff con categoryId vacío: categoryId null y organización del scope', async () => {
    const prisma: any = {
      professionalCategory: { findFirst: jest.fn() },
      professional: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn() },
    };
    await createStaff(prisma, { categoryId: '' });
    const data = prisma.professional.create.mock.calls[0][0].data;
    expect(data.categoryId).toBeNull();
    expect(data.organizationId).toBe(orgA);
    expect(prisma.professionalCategory.findFirst).not.toHaveBeenCalled();
  });
});

describe('pagadores', () => {
  const payerOf = (professionalUserId: string | null) => ({
    id: randomUUID(),
    organizationId: orgA,
    professional: professionalUserId ? { userId: professionalUserId } : null,
  });
  const ctxOf = (role: 'ADMIN' | 'MEMBER' | null) =>
    makeCtx({ userId: me, roles: { [orgA]: role } });
  const upd = (id: string) => assign(UpdatePayerCommand, { id, name: 'N' });

  const run = async (payer: any, role: 'ADMIN' | 'MEMBER' | null) => {
    const prisma: any = {
      payer: {
        findFirst: jest.fn().mockResolvedValue(payer),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const eU = await errorOf(() =>
      new UpdatePayerCommandHandler(prisma).execute(
        upd(randomUUID()),
        ctxOf(role),
      ),
    );
    const eD = await errorOf(() =>
      new DeletePayerCommandHandler(prisma).execute(
        new DeletePayerCommand(randomUUID()),
        ctxOf(role),
      ),
    );
    return { prisma, eU, eD };
  };

  it('ADMIN modifica cualquier pagador de la organización (propio de profesional o del sistema)', async () => {
    for (const payer of [payerOf(other), payerOf(null)]) {
      const { prisma, eU, eD } = await run(payer, 'ADMIN');
      expect(eU).toBeUndefined();
      expect(eD).toBeUndefined();
      expect(prisma.payer.update).toHaveBeenCalledTimes(1);
      expect(prisma.payer.delete).toHaveBeenCalledTimes(1);
    }
  });

  it('el dueño del pagador (no ADMIN) lo modifica', async () => {
    const { prisma, eU, eD } = await run(payerOf(me), null);
    expect(eU).toBeUndefined();
    expect(eD).toBeUndefined();
    expect(prisma.payer.update).toHaveBeenCalled();
  });

  it.each([
    ['pagador de otro profesional', () => payerOf(other)],
    ['pagador del sistema', () => payerOf(null)],
  ])('no ADMIN ni dueño con %s: 403 y sin escritura', async (_n, make) => {
    const { prisma, eU, eD } = await run(make(), 'MEMBER');
    expect(eU.getResponse()).toEqual(FORBIDDEN_BODY);
    expect(eD.getResponse()).toEqual(FORBIDDEN_BODY);
    expect(prisma.payer.update).not.toHaveBeenCalled();
    expect(prisma.payer.delete).not.toHaveBeenCalled();
  });

  it('pagador de otra organización: 404 antes de decidir el permiso', async () => {
    const { prisma, eU, eD } = await run(null, 'ADMIN');
    expect(eU.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(eD.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(prisma.payer.update).not.toHaveBeenCalled();
    expect(
      prisma.payer.findFirst.mock.calls[0][0].where.organizationId,
    ).toEqual({ in: [orgA] });
  });

  const create = (
    prisma: any,
    role: 'ADMIN' | 'MEMBER' | null,
    cuit?: string,
  ) =>
    new CreatePayerCommandHandler(prisma).execute(
      assign(CreatePayerCommand, { name: 'OS', cuit }),
      ctxOf(role),
    );

  it('POST sin Professional y sin ADMIN: 403; con ADMIN: pagador del sistema', async () => {
    const mk = () => ({
      organization: { findFirst: jest.fn().mockResolvedValue(null) },
      professional: { findFirst: jest.fn().mockResolvedValue(null) },
      payer: { create: jest.fn().mockResolvedValue({}) },
    });
    const denied = mk();
    const e = await errorOf(() => create(denied, 'MEMBER'));
    expect(e.getResponse()).toEqual(FORBIDDEN_BODY);
    expect(denied.payer.create).not.toHaveBeenCalled();

    const ok = mk();
    await create(ok, 'ADMIN');
    const data = ok.payer.create.mock.calls[0][0].data;
    expect(data.organizationId).toBe(orgA);
    expect(data.isManagedBySystem).toBe(true);
  });

  it('POST con Professional propio: pagador propio, aunque no sea ADMIN', async () => {
    const proId = randomUUID();
    const prisma: any = {
      organization: { findFirst: jest.fn().mockResolvedValue(null) },
      professional: { findFirst: jest.fn().mockResolvedValue({ id: proId }) },
      payer: { create: jest.fn().mockResolvedValue({}) },
    };
    await create(prisma, null);
    expect(prisma.professional.findFirst.mock.calls[0][0].where).toMatchObject({
      userId: me,
      organizationId: orgA,
      deletedAt: null,
    });
    const data = prisma.payer.create.mock.calls[0][0].data;
    expect(data.professionalId).toBe(proId);
    expect(data.isManagedBySystem).toBe(false);
  });

  it('CUIT de una organización registrada: se rechaza sin nombrar a la organización', async () => {
    const prisma: any = {
      organization: {
        findFirst: jest.fn().mockResolvedValue({ name: 'Clinica Secreta' }),
      },
      professional: { findFirst: jest.fn() },
      payer: { create: jest.fn() },
    };
    const e = await errorOf(() => create(prisma, 'ADMIN', '30111111118'));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(e.getResponse())).not.toContain('Clinica Secreta');
    expect(prisma.payer.create).not.toHaveBeenCalled();
  });
});

describe('LookupStaffByCuitQueryHandler', () => {
  it('busca solo en la organización del request y devuelve la respuesta mínima', async () => {
    const id = randomUUID();
    const findFirst = jest.fn().mockResolvedValue({
      id,
      displayName: 'Pro Uno',
      userId: randomUUID(),
      email: 'x@example.test',
      phone: '123',
    });
    const handler = new LookupStaffByCuitQueryHandler({
      professional: { findFirst },
    } as any);
    const res = await handler.execute(
      new LookupStaffByCuitQuery('20000000001'),
      admin,
    );
    expect(res).toEqual({
      type: 'PROFESSIONAL',
      id,
      name: 'Pro Uno',
      hasUser: true,
    });
    expect(findFirst.mock.calls[0][0].where).toEqual({
      cuit: '20000000001',
      deletedAt: null,
      organizationId: orgA,
    });
  });

  it('CUIT de otra organización o vacío: NOT_FOUND', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const handler = new LookupStaffByCuitQueryHandler({
      professional: { findFirst },
    } as any);
    await expect(
      handler.execute(new LookupStaffByCuitQuery('20000000002'), admin),
    ).resolves.toEqual({
      type: 'NOT_FOUND',
    });
    findFirst.mockClear();
    await expect(
      handler.execute(new LookupStaffByCuitQuery(''), admin),
    ).resolves.toEqual({ type: 'NOT_FOUND' });
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('GetPayersQueryHandler: falla cerrado sin organización', () => {
  it.each([undefined, null, '', '  ', 5])(
    'orgId %p: 403 org-access-denied y ninguna consulta a payer',
    async (orgId) => {
      const prisma: any = {
        professional: { findFirst: jest.fn() },
        payer: { findMany: jest.fn(), count: jest.fn() },
      };
      const query = Object.assign(new GetPayersQuery(), {
        orgId: orgId as any,
        userId: randomUUID(),
      });
      const e = await errorOf(() =>
        new GetPayersQueryHandler(prisma).execute(query),
      );
      expect(e.getStatus()).toBe(403);
      expect(e.getResponse()).toEqual({
        code: 'org-access-denied',
        message: 'Forbidden',
      });
      expect(prisma.payer.findMany).not.toHaveBeenCalled();
      expect(prisma.payer.count).not.toHaveBeenCalled();
      expect(prisma.professional.findFirst).not.toHaveBeenCalled();
    },
  );
});
