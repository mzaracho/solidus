/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { createFakePrisma } from './helpers/fake-prisma';
import { errorOf, makeCtx, NOT_FOUND_BODY } from './helpers/scope';
import { ActivityService } from '@src/infrastructure/features/activity/activity.service';
import {
  DeleteStaffCommand,
  DeleteStaffCommandHandler,
} from '@src/application/features/config/commands/staff-commands';
import {
  MergePatientCommand,
  MergePatientCommandHandler,
} from '@src/application/features/patients/commands/merge-patient-command';

// Atomicidad (feature 015, criterio 6): la segunda (o última) escritura falla y no tiene que quedar nada escrito.
// Se usa la base en memoria con rollback; los handlers se instancian directamente.
const ORG = randomUUID();
const ME = randomUUID();
const OTHER_USER = randomUUID();
const PRO = randomUUID();
const PRO_STAFF = randomUUID();
const SRC = randomUUID();
const TGT = randomUUID();

const snapshot = (
  fake: ReturnType<typeof createFakePrisma>,
  models: string[],
) => Object.fromEntries(models.map((m) => [m, fake.rows(m)]));

describe('createActivity: atomicidad', () => {
  const seedClinic = () => ({
    organization: [{ id: ORG, type: 'CLINIC', settings: null }],
    user: [
      { id: ME, name: 'Admin', email: 'admin@example.test', deletedAt: null },
    ],
    professional: [
      {
        id: PRO,
        organizationId: ORG,
        userId: null,
        displayName: 'Pro Uno',
        deletedAt: null,
        categoryId: null,
      },
    ],
  });
  const MODELS = [
    'payer',
    'professional',
    'workItem',
    'workItemParticipant',
    'workItemSplit',
  ];
  const feeEngine: any = {
    calculateSplits: jest.fn().mockResolvedValue([
      {
        beneficiaryType: 'PROFESSIONAL',
        beneficiaryId: PRO,
        amount: 50,
        roleLabel: 'Honorario',
      },
    ]),
  };
  const dto = (over: Record<string, any> = {}): any => ({
    date: '2026-03-01T12:00:00.000Z',
    organizationId: ORG,
    professionalId: PRO,
    amountBase: 100,
    ...over,
  });
  const scopeOf = () => makeCtx({ userId: ME, roles: { [ORG]: 'ADMIN' } }).org!;

  it('falla workItemParticipant.createMany: no quedan el pagador, la atención ni los participantes', async () => {
    const fake = createFakePrisma(seedClinic());
    const before = snapshot(fake, MODELS);
    fake.failOn({ model: 'workItemParticipant', op: 'createMany' });
    const service = new ActivityService(fake.client, feeEngine);
    const e = await errorOf(() =>
      service.createActivity(dto(), 'org', scopeOf()),
    );
    expect(e).toMatchObject({ code: 'P2034' });
    expect(snapshot(fake, MODELS)).toEqual(before);
    expect(fake.writes).toHaveLength(0);
    expect(fake.transactions.map((t) => t.status)).toEqual(['rolledBack']);
    // se hicieron escrituras antes de fallar (el pagador y la atención), y se deshicieron
    expect(
      fake.transactions[0].writes.map((w) => `${w.model}.${w.op}`),
    ).toEqual(['payer.create', 'workItem.create']);
  });

  it('falla workItemSplit.createMany (la última): las tablas quedan iguales', async () => {
    const fake = createFakePrisma(seedClinic());
    const before = snapshot(fake, MODELS);
    fake.failOn({ model: 'workItemSplit', op: 'createMany' });
    const service = new ActivityService(fake.client, feeEngine);
    const e = await errorOf(() =>
      service.createActivity(dto(), 'org', scopeOf()),
    );
    expect(e).toMatchObject({ code: 'P2034' });
    expect(snapshot(fake, MODELS)).toEqual(before);
    expect(fake.transactions[0].status).toBe('rolledBack');
    expect(fake.transactions[0].writes).toHaveLength(3);
  });

  it('SOLO_PRACTICE en modo pro sin Professional: falla workItem.create y no quedan el Professional ni el pagador automáticos', async () => {
    const seed = seedClinic();
    seed.organization = [{ id: ORG, type: 'SOLO_PRACTICE', settings: null }];
    seed.professional = [];
    const fake = createFakePrisma(seed);
    const before = snapshot(fake, MODELS);
    fake.failOn({ model: 'workItem', op: 'create' });
    const service = new ActivityService(fake.client, feeEngine);
    const e = await errorOf(() =>
      service.createActivity(
        dto({ professionalId: undefined }),
        'pro',
        scopeOf(),
      ),
    );
    expect(e).toMatchObject({ code: 'P2034' });
    expect(snapshot(fake, MODELS)).toEqual(before);
    expect(
      fake.transactions[0].writes.map((w) => `${w.model}.${w.op}`),
    ).toEqual(['payer.create', 'professional.create']);
  });

  it('caso feliz: todas las escrituras con inTx y una transacción committed', async () => {
    const fake = createFakePrisma(seedClinic());
    const service = new ActivityService(fake.client, feeEngine);
    await service.createActivity(dto(), 'org', scopeOf());
    expect(fake.transactions.map((t) => t.status)).toEqual(['committed']);
    expect(fake.writes.map((w) => `${w.model}.${w.op}`)).toEqual([
      'payer.create',
      'workItem.create',
      'workItemParticipant.createMany',
      'workItemSplit.createMany',
    ]);
    expect(fake.writes.every((w) => w.inTx)).toBe(true);
    expect(fake.rows('workItem')).toHaveLength(1);
    expect(fake.rows('workItemSplit')).toHaveLength(1);
  });
});

describe('DeleteStaff con usuario: atomicidad', () => {
  const seed = () => ({
    professional: [
      {
        id: PRO_STAFF,
        organizationId: ORG,
        userId: OTHER_USER,
        deletedAt: null,
      },
    ],
    organizationMember: [
      { id: 'm1', organizationId: ORG, userId: OTHER_USER, role: 'MEMBER' },
    ],
    user: [{ id: OTHER_USER, deletedAt: null }],
    workItem: [],
  });
  const MODELS = ['professional', 'organizationMember', 'user'];
  const ctx = () => makeCtx({ userId: ME, roles: { [ORG]: 'ADMIN' } });

  it('caso feliz: baja del Professional, de la membresía y del User en una transacción', async () => {
    const fake = createFakePrisma(seed());
    await new DeleteStaffCommandHandler(fake.client).execute(
      new DeleteStaffCommand(PRO_STAFF),
      ctx(),
    );
    expect(fake.transactions.map((t) => t.status)).toEqual(['committed']);
    expect(fake.writes.map((w) => `${w.model}.${w.op}`)).toEqual([
      'professional.update',
      'organizationMember.deleteMany',
      'user.update',
    ]);
    expect(fake.writes.every((w) => w.inTx)).toBe(true);
    expect(fake.rows('professional')[0].deletedAt).toBeInstanceOf(Date);
    expect(fake.rows('organizationMember')).toHaveLength(0);
    expect(fake.rows('user')[0].deletedAt).toBeInstanceOf(Date);
  });

  it('falla organizationMember.deleteMany: el Professional sigue con deletedAt null', async () => {
    const fake = createFakePrisma(seed());
    const before = snapshot(fake, MODELS);
    fake.failOn({ model: 'organizationMember', op: 'deleteMany' });
    const e = await errorOf(() =>
      new DeleteStaffCommandHandler(fake.client).execute(
        new DeleteStaffCommand(PRO_STAFF),
        ctx(),
      ),
    );
    expect(e).toMatchObject({ code: 'P2034' });
    expect(fake.rows('professional')[0].deletedAt).toBeNull();
    expect(snapshot(fake, MODELS)).toEqual(before);
    expect(fake.transactions[0].status).toBe('rolledBack');
  });

  it('falla user.update: el Professional y la membresía quedan intactos y el User activo', async () => {
    const fake = createFakePrisma(seed());
    const before = snapshot(fake, MODELS);
    fake.failOn({ model: 'user', op: 'update' });
    const e = await errorOf(() =>
      new DeleteStaffCommandHandler(fake.client).execute(
        new DeleteStaffCommand(PRO_STAFF),
        ctx(),
      ),
    );
    expect(e).toMatchObject({ code: 'P2034' });
    expect(snapshot(fake, MODELS)).toEqual(before);
    expect(fake.rows('user')[0].deletedAt).toBeNull();
    expect(fake.rows('organizationMember')).toHaveLength(1);
  });
});

describe('MergePatient: atomicidad y re-verificación', () => {
  const seed = () => ({
    patient: [
      { id: SRC, organizationId: ORG },
      { id: TGT, organizationId: ORG },
    ],
    workItem: [
      { id: 'w1', organizationId: ORG, patientId: SRC },
      { id: 'w2', organizationId: ORG, patientId: SRC },
    ],
  });
  const MODELS = ['patient', 'workItem'];
  const ctx = () => makeCtx({ userId: ME, roles: { [ORG]: 'ADMIN' } });
  const cmd = Object.assign(new MergePatientCommand(), {
    sourceId: SRC,
    targetId: TGT,
  });

  it('caso feliz: bloquea, reasigna y borra el origen dentro de una transacción', async () => {
    const fake = createFakePrisma(seed());
    await new MergePatientCommandHandler(fake.client).execute(cmd, ctx());
    expect(fake.transactions.map((t) => t.status)).toEqual(['committed']);
    expect(fake.writes.map((w) => `${w.model}.${w.op}`)).toEqual([
      'patient.updateMany',
      'workItem.updateMany',
      'patient.delete',
    ]);
    expect(fake.writes.every((w) => w.inTx)).toBe(true);
    expect(fake.rows('patient').map((p) => p.id)).toEqual([TGT]);
    expect(fake.rows('workItem').every((w) => w.patientId === TGT)).toBe(true);
  });

  it('falla patient.delete: las atenciones siguen con el paciente de origen y los dos pacientes existen', async () => {
    const fake = createFakePrisma(seed());
    const before = snapshot(fake, MODELS);
    fake.failOn({ model: 'patient', op: 'delete' });
    const e = await errorOf(() =>
      new MergePatientCommandHandler(fake.client).execute(cmd, ctx()),
    );
    expect(e).toMatchObject({ code: 'P2034' });
    expect(snapshot(fake, MODELS)).toEqual(before);
    expect(fake.rows('workItem').every((w) => w.patientId === SRC)).toBe(true);
    expect(fake.rows('patient')).toHaveLength(2);
    expect(fake.transactions[0].status).toBe('rolledBack');
  });

  it('otra sesión borró el destino después de la verificación: 404 y nada escrito', async () => {
    const fake = createFakePrisma(seed());
    // Simula la fusión concurrente que confirma entre la verificación de afuera y la transacción
    const racing: any = new Proxy(fake.client, {
      get: (target, prop) =>
        prop === '$transaction'
          ? async (fn: any) => {
              await fake.client.patient.delete({ where: { id: TGT } });
              return target.$transaction(fn);
            }
          : target[prop],
    });
    const e = await errorOf(() =>
      new MergePatientCommandHandler(racing).execute(cmd, ctx()),
    );
    expect(e).toBeInstanceOf(NotFoundException);
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(fake.rows('patient').map((p) => p.id)).toEqual([SRC]);
    expect(fake.rows('workItem').every((w) => w.patientId === SRC)).toBe(true);
    expect(fake.transactions.map((t) => t.status)).toEqual(['rolledBack']);
    expect(
      fake.transactions[0].writes.map((w) => `${w.model}.${w.op}`),
    ).toEqual(['patient.updateMany']);
  });
});
