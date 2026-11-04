/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  errorOf,
  FORBIDDEN_BODY,
  makeCtx,
  NOT_FOUND_BODY,
} from '../../../../test/helpers/scope';
import { ActivityService } from './activity.service';

const orgA = randomUUID();
const orgB = randomUUID();
const me = randomUUID();

/** Prisma mock: lecturas por defecto "encuentra todo en la organización"; todas las escrituras son espías. */
function setup(overrides: Partial<Record<string, any>> = {}) {
  const writes = {
    payerCreate: jest.fn().mockResolvedValue({ id: randomUUID() }),
    professionalCreate: jest.fn().mockResolvedValue({ id: randomUUID() }),
    workItemCreate: jest.fn().mockImplementation(async ({ data }: any) => ({
      id: randomUUID(),
      occurredAt: data.occurredAt,
      serviceType: data.serviceType,
      grossAmount: data.grossAmount,
      amountBase: data.amountBase,
      amountCard: data.amountCard,
      paymentStatus: data.paymentStatus,
      attendance: null,
    })),
    participantsCreateMany: jest.fn().mockResolvedValue({}),
    splitsCreateMany: jest.fn().mockResolvedValue({}),
  };
  const found = (id: string) => async (args: any) => ({
    id: args.where.id ?? id,
  });
  const tx: any = {
    payer: {
      create: writes.payerCreate,
      findUnique: jest.fn().mockResolvedValue({ id: 'p', name: 'Particular' }),
    },
    professional: {
      create: writes.professionalCreate,
      findUnique: jest.fn().mockResolvedValue({ id: 'x', category: null }),
    },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: me, name: 'Pro', email: 'pro@example.test' }),
    },
    workItem: { create: writes.workItemCreate },
    workItemParticipant: { createMany: writes.participantsCreateMany },
    workItemSplit: { createMany: writes.splitsCreateMany },
  };
  const prisma: any = {
    organization: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: orgA, type: 'CLINIC', settings: null }),
    },
    activityType: { findFirst: jest.fn().mockImplementation(found('at')) },
    feePreset: {
      findFirst: jest.fn().mockImplementation(async (a: any) => ({
        id: a.where.id,
        value: 100,
        cardValue: null,
      })),
    },
    payer: {
      findFirst: jest
        .fn()
        .mockImplementation(async (a: any) =>
          a.where.id ? { id: a.where.id } : { id: randomUUID() },
        ),
    },
    patient: { findFirst: jest.fn().mockImplementation(found('pt')) },
    professional: { findFirst: jest.fn().mockImplementation(found('pr')) },
    workItem: { count: jest.fn().mockResolvedValue(1) },
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
    ...overrides,
  };
  const feeEngine: any = { calculateSplits: jest.fn().mockResolvedValue([]) };
  const service = new ActivityService(prisma, feeEngine);
  const scopeOf = (
    role: 'ADMIN' | 'MEMBER' | null,
    extra: Record<string, any> = {},
  ) => makeCtx({ userId: me, roles: { [orgA]: role, ...extra } }).org!;
  return { service, prisma, tx, feeEngine, writes, scopeOf };
}

const dto = (over: Record<string, any> = {}): any => ({
  date: '2026-03-01T12:00:00.000Z',
  organizationId: orgA,
  patientId: randomUUID(),
  professionalId: randomUUID(),
  ...over,
});

const noWrites = (s: ReturnType<typeof setup>) => {
  expect(s.prisma.$transaction).not.toHaveBeenCalled();
  for (const fn of Object.values(s.writes)) expect(fn).not.toHaveBeenCalled();
};

describe('ActivityService.createActivity', () => {
  it.each(['ADMIN', 'MEMBER'] as const)(
    '%s crea la atención dentro de una transacción con tx',
    async (role) => {
      const s = setup();
      await s.service.createActivity(dto(), 'org', s.scopeOf(role));
      expect(s.prisma.$transaction).toHaveBeenCalledTimes(1);
      const data = s.writes.workItemCreate.mock.calls[0][0].data;
      expect(data.organization).toEqual({ connect: { id: orgA } });
      expect(data.createdByUserId).toBe(me);
      expect(s.writes.participantsCreateMany).toHaveBeenCalled();
      // calculateSplits recibe el cliente de la transacción
      expect(s.feeEngine.calculateSplits.mock.calls[0][1]).toBe(s.tx);
      // todas las lecturas de ids referenciados filtran por la organización destino
      expect(
        s.prisma.patient.findFirst.mock.calls[0][0].where.organizationId,
      ).toBe(orgA);
      expect(
        s.prisma.professional.findFirst.mock.calls[0][0].where.organizationId,
      ).toBe(orgA);
    },
  );

  it('crea el pagador por defecto dentro de la transacción (no antes)', async () => {
    const s = setup({
      payer: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await s.service.createActivity(dto(), 'org', s.scopeOf('ADMIN'));
    expect(s.writes.payerCreate).toHaveBeenCalledTimes(1);
    expect(s.writes.payerCreate.mock.calls[0][0].data.organizationId).toBe(
      orgA,
    );
  });

  it('profesional con canLoadActivities=true crea, y solo a su Professional', async () => {
    const ownId = randomUUID();
    const s = setup();
    s.prisma.professional.findFirst.mockImplementation(async (a: any) =>
      a.where.userId === me
        ? { id: ownId, canLoadActivities: true }
        : { id: a.where.id },
    );
    await s.service.createActivity(
      dto({ professionalId: undefined }),
      'pro',
      s.scopeOf(null),
    );
    const data = s.writes.workItemCreate.mock.calls[0][0].data;
    expect(data.professional).toEqual({ connect: { id: ownId } });
    // indicando su propio professionalId el resultado es el mismo
    const s2 = setup();
    s2.prisma.professional.findFirst.mockImplementation(async (a: any) =>
      a.where.userId === me
        ? { id: ownId, canLoadActivities: true }
        : { id: a.where.id },
    );
    await s2.service.createActivity(
      dto({ professionalId: ownId }),
      'pro',
      s2.scopeOf(null),
    );
    expect(s2.writes.workItemCreate.mock.calls[0][0].data.professional).toEqual(
      {
        connect: { id: ownId },
      },
    );
  });

  it('busca el Professional propio solo entre los ACTIVE y no eliminados de la organización', async () => {
    const ownId = randomUUID();
    const s = setup();
    s.prisma.professional.findFirst.mockImplementation(async (a: any) =>
      a.where.userId === me
        ? { id: ownId, canLoadActivities: true }
        : { id: a.where.id },
    );
    await s.service.createActivity(
      dto({ professionalId: undefined }),
      'pro',
      s.scopeOf(null),
    );
    const ownLookup = s.prisma.professional.findFirst.mock.calls
      .map((c: any) => c[0].where)
      .find((w: any) => w.userId === me);
    expect(ownLookup).toMatchObject({
      userId: me,
      organizationId: orgA,
      status: 'ACTIVE',
      deletedAt: null,
    });
  });

  it.each(['org', 'pro'] as const)(
    'profesional con canLoadActivities=false: 403 y ninguna escritura (mode %s)',
    async (mode) => {
      const s = setup();
      s.prisma.professional.findFirst.mockResolvedValue({
        id: randomUUID(),
        canLoadActivities: false,
      });
      const e = await errorOf(() =>
        s.service.createActivity(dto(), mode, s.scopeOf(null)),
      );
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(e.getResponse()).toEqual(FORBIDDEN_BODY);
      noWrites(s);
      // el permiso va antes de leer cualquier id referenciado
      expect(s.prisma.patient.findFirst).not.toHaveBeenCalled();
    },
  );

  it('profesional sin Professional activo en la organización: 403', async () => {
    const s = setup();
    s.prisma.professional.findFirst.mockResolvedValue(null);
    const e = await errorOf(() =>
      s.service.createActivity(dto(), 'pro', s.scopeOf(null)),
    );
    expect(e.getResponse()).toEqual(FORBIDDEN_BODY);
    noWrites(s);
  });

  it('profesional con professionalId de otro: 403 sin escrituras', async () => {
    const s = setup();
    s.prisma.professional.findFirst.mockResolvedValue({
      id: randomUUID(),
      canLoadActivities: true,
    });
    const e = await errorOf(() =>
      s.service.createActivity(
        dto({ professionalId: randomUUID() }),
        'pro',
        s.scopeOf(null),
      ),
    );
    expect(e.getResponse()).toEqual(FORBIDDEN_BODY);
    noWrites(s);
  });

  it('modo org sin membresia en la organizacion destino: 403 sin lecturas ni escrituras (aunque tenga canLoadActivities)', async () => {
    const s = setup();
    s.prisma.professional.findFirst.mockResolvedValue({
      id: randomUUID(),
      canLoadActivities: true,
    });
    const e = await errorOf(() =>
      s.service.createActivity(dto(), 'org', s.scopeOf(null)),
    );
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(e.getResponse()).toEqual(FORBIDDEN_BODY);
    noWrites(s);
    // la regla va antes de cualquier lectura
    expect(s.prisma.professional.findFirst).not.toHaveBeenCalled();
    expect(s.prisma.patient.findFirst).not.toHaveBeenCalled();
    expect(s.prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('modo pro de un profesional con canLoadActivities sin membresia: carga a su Professional', async () => {
    const s = setup();
    const own = randomUUID();
    s.prisma.professional.findFirst.mockImplementation(async (a: any) =>
      a.where.userId
        ? { id: own, canLoadActivities: true }
        : { id: a.where.id },
    );
    await s.service.createActivity(
      dto({ professionalId: undefined }),
      'pro',
      s.scopeOf(null),
    );
    expect(s.writes.workItemCreate).toHaveBeenCalledTimes(1);
  });

  it('organización destino fuera del scope: 403 org-access-denied', async () => {
    const s = setup();
    const e = await errorOf(() =>
      s.service.createActivity(
        dto({ organizationId: orgB }),
        'org',
        s.scopeOf('ADMIN'),
      ),
    );
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(e.getResponse()).toEqual({
      code: 'org-access-denied',
      message: 'Forbidden',
    });
    noWrites(s);
  });

  const referenced: Array<
    [string, (s: ReturnType<typeof setup>) => void, Record<string, any>]
  > = [
    [
      'patientId',
      (s) => s.prisma.patient.findFirst.mockResolvedValue(null),
      {},
    ],
    [
      'professionalId',
      (s) => s.prisma.professional.findFirst.mockResolvedValue(null),
      { professionalId: randomUUID() },
    ],
    [
      'participante',
      (s) =>
        s.prisma.professional.findFirst.mockImplementation(async (a: any) =>
          a.where.id === partId ? null : { id: a.where.id },
        ),
      {
        participants: [
          { professionalId: undefined as any, roleLabel: 'Admisor' },
        ],
      },
    ],
    [
      'activityTypeId',
      (s) => s.prisma.activityType.findFirst.mockResolvedValue(null),
      { activityTypeId: randomUUID() },
    ],
    [
      'presetId',
      (s) => s.prisma.feePreset.findFirst.mockResolvedValue(null),
      { presetId: randomUUID() },
    ],
    [
      'payerId',
      (s) => s.prisma.payer.findFirst.mockResolvedValue(null),
      { payerId: randomUUID() },
    ],
  ];
  const partId = randomUUID();

  it.each(referenced)(
    '%s de otra organización: 404 genérico y sin escrituras',
    async (_name, arrange, extra) => {
      const s = setup();
      arrange(s);
      const body = dto(extra);
      if (body.participants) body.participants[0].professionalId = partId;
      const e = await errorOf(() =>
        s.service.createActivity(body, 'org', s.scopeOf('ADMIN')),
      );
      expect(e).toBeInstanceOf(NotFoundException);
      expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
      noWrites(s);
    },
  );

  it('ids opcionales vacíos cuentan como ausentes (sin consulta de preset y con pagador por defecto)', async () => {
    const s = setup();
    await s.service.createActivity(
      dto({ presetId: '', payerId: null, activityTypeId: '' }),
      'org',
      s.scopeOf('ADMIN'),
    );
    expect(s.prisma.feePreset.findFirst).not.toHaveBeenCalled();
    expect(s.prisma.activityType.findFirst).not.toHaveBeenCalled();
    expect(s.writes.workItemCreate).toHaveBeenCalled();
  });

  it('un id que no es UUID en el body da 404 sin consultar el modelo', async () => {
    const s = setup();
    const e = await errorOf(() =>
      s.service.createActivity(
        dto({ presetId: 'no-uuid' }),
        'org',
        s.scopeOf('ADMIN'),
      ),
    );
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(s.prisma.feePreset.findFirst).not.toHaveBeenCalled();
    noWrites(s);
  });

  it('modo pro de un ADMIN sin Professional en una organización SOLO_PRACTICE: crea el Professional dentro de la transacción', async () => {
    const s = setup();
    s.prisma.organization.findUnique.mockResolvedValue({
      id: orgA,
      type: 'SOLO_PRACTICE',
      settings: null,
    });
    s.prisma.professional.findFirst.mockImplementation(async (a: any) =>
      a.where.userId ? null : { id: a.where.id },
    );
    await s.service.createActivity(
      dto({ professionalId: undefined }),
      'pro',
      s.scopeOf('ADMIN'),
    );
    expect(s.writes.professionalCreate).toHaveBeenCalledTimes(1);
    expect(
      s.writes.professionalCreate.mock.calls[0][0].data.organizationId,
    ).toBe(orgA);
    expect(s.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('sin profesional resoluble no se escribe nada', async () => {
    const s = setup();
    const e = await errorOf(() =>
      s.service.createActivity(
        dto({ professionalId: undefined }),
        'org',
        s.scopeOf('ADMIN'),
      ),
    );
    // Antes un Error común (500): ahora 400 explícito, y la transacción hace rollback.
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).getResponse()).toEqual({
      code: 'bad-request',
      message: 'Falta el profesional de la atención.',
    });
    expect(s.writes.workItemCreate).not.toHaveBeenCalled();
  });

  it('regla de primera carga (#53): 400 first-load-required y no abre la transacción', async () => {
    const s = setup({
      professional: {
        // sin canLoadActivities en la organización: profesional externo
        findFirst: jest
          .fn()
          .mockImplementation(async (a: any) =>
            a.where.canLoadActivities ? null : { id: a.where.id ?? 'pr' },
          ),
      },
      workItem: { count: jest.fn().mockResolvedValue(0) },
    });
    const e = await errorOf(() =>
      s.service.createActivity(dto(), 'pro', s.scopeOf('ADMIN')),
    );
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).getResponse()).toMatchObject({
      code: 'first-load-required',
    });
    noWrites(s);
  });
});
