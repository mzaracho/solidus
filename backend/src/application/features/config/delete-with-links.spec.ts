/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { createFakePrisma } from '../../../../test/helpers/fake-prisma';
import {
  errorOf,
  makeCtx,
  NOT_FOUND_BODY,
} from '../../../../test/helpers/scope';
import {
  DeletePayerCommand,
  DeletePayerCommandHandler,
} from './commands/payer-commands';
import {
  DeleteStaffCommand,
  DeleteStaffCommandHandler,
} from './commands/staff-commands';

// 017: borrar un pagador con reglas o con atenciones (409 con código propio) y borrar un staff sin usuario que es
// participante o beneficiario (baja lógica en lugar de 500).
const orgA = randomUUID();
const orgB = randomUUID();
const admin = randomUUID();
const ctx = makeCtx({ userId: admin, roles: { [orgA]: 'ADMIN' } });

const payerFree = randomUUID();
const payerWithRule = randomUUID();
const payerWithActivity = randomUUID();
const payerForeign = randomUUID();
const payerRace = randomUUID();

const staffFree = randomUUID();
const staffParticipant = randomUUID();
const staffBeneficiary = randomUUID();
const staffOwnWork = randomUUID();
const staffWithUser = randomUUID();
const wiId = randomUUID();
const userOfStaff = randomUUID();

const seed = () => ({
  payer: [payerFree, payerWithRule, payerWithActivity, payerRace]
    .map((id) => ({
      id,
      organizationId: orgA,
      name: 'Pagador',
      professionalId: null,
    }))
    .concat([
      {
        id: payerForeign,
        organizationId: orgB,
        name: 'Ajeno',
        professionalId: null,
      },
    ]),
  feeRule: [
    {
      id: randomUUID(),
      organizationId: orgA,
      payerId: payerWithRule,
      splits: [],
    },
    { id: randomUUID(), organizationId: orgA, payerId: payerRace, splits: [] },
  ],
  workItem: [
    {
      id: wiId,
      organizationId: orgA,
      payerId: payerWithActivity,
      professionalId: staffOwnWork,
    },
  ],
  professional: [
    staffFree,
    staffParticipant,
    staffBeneficiary,
    staffOwnWork,
    staffWithUser,
  ].map((id) => ({
    id,
    organizationId: orgA,
    userId: id === staffWithUser ? userOfStaff : null,
    displayName: 'Staff ficticio',
    deletedAt: null,
  })),
  workItemParticipant: [
    { id: randomUUID(), workItemId: wiId, professionalId: staffParticipant },
  ],
  workItemSplit: [
    {
      id: randomUUID(),
      workItemId: wiId,
      beneficiaryId: staffBeneficiary,
      amount: 1,
    },
  ],
  organizationMember: [],
  user: [{ id: userOfStaff, name: 'Usuario Ficticio', deletedAt: null }],
});

const p2003 = new Prisma.PrismaClientKnownRequestError('fk', {
  code: 'P2003',
  clientVersion: 'fake',
});
const p2025 = new Prisma.PrismaClientKnownRequestError('nf', {
  code: 'P2025',
  clientVersion: 'fake',
});

describe('DeletePayer con vínculos (criterios 11 y 17)', () => {
  const fake = createFakePrisma(seed());
  beforeEach(() => fake.reset());
  const del = (id: string, prisma: any = fake.client) =>
    errorOf(() =>
      new DeletePayerCommandHandler(prisma).execute(
        new DeletePayerCommand(id),
        ctx,
      ),
    );

  it('con reglas de honorarios: 409 payer-has-fee-rules, sin escrituras y las reglas intactas', async () => {
    const e = await del(payerWithRule);
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse()).toEqual({
      code: 'payer-has-fee-rules',
      message:
        'No se puede eliminar el pagador porque tiene reglas de honorarios asociadas.',
    });
    expect(fake.writeCount()).toBe(0);
    expect(
      fake.rows('feeRule').find((r) => r.payerId === payerWithRule),
    ).toBeDefined();
    expect(fake.rows('payer').some((r) => r.id === payerWithRule)).toBe(true);
  });

  it('con atenciones: 409 payer-has-activities (no 500) y no se borra nada', async () => {
    const e = await del(payerWithActivity);
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse()).toEqual({
      code: 'payer-has-activities',
      message:
        'No se puede eliminar el pagador porque tiene atenciones asociadas.',
    });
    expect(fake.writeCount()).toBe(0);
    expect(fake.rows('payer').some((r) => r.id === payerWithActivity)).toBe(
      true,
    );
  });

  it('sin vínculos: se borra como hoy', async () => {
    const e = await del(payerFree);
    expect(e).toBeUndefined();
    expect(fake.rows('payer').some((r) => r.id === payerFree)).toBe(false);
    expect(fake.writes.map((w) => `${w.model}.${w.op}`)).toEqual([
      'payer.delete',
    ]);
  });

  it('de otra organización o inexistente: 404 genérico antes que el 409', async () => {
    const foreign = await del(payerForeign);
    const missing = await del(randomUUID());
    expect(foreign.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(missing.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(fake.writeCount()).toBe(0);
  });

  it('carrera: una regla aparece después de la verificación y la FK rechaza el borrado: 409, no 500', async () => {
    // la primera verificación de reglas no la ve (se confirmó justo después); el delete falla con P2003
    let counts = 0;
    const prisma: any = {
      payer: fake.client.payer,
      workItem: fake.client.workItem,
      feeRule: {
        count: async (a: any) =>
          ++counts === 1 ? 0 : fake.client.feeRule.count(a),
      },
    };
    fake.failOn({ model: 'payer', op: 'delete', error: p2003 });
    const e = await del(payerRace, prisma);
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse().code).toBe('payer-has-fee-rules');
    expect(fake.rows('payer').some((r) => r.id === payerRace)).toBe(true);
  });

  it('P2025 (otro pedido lo borró en el medio): 404', async () => {
    fake.failOn({ model: 'payer', op: 'delete', error: p2025 });
    const e = await del(payerFree);
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
  });

  it('un P2003 sin reglas ni atenciones se relanza (no se oculta)', async () => {
    fake.failOn({ model: 'payer', op: 'delete', error: p2003 });
    const e = await del(payerFree);
    expect(e).toBe(p2003);
  });
});

describe('DeleteStaff con vínculos (criterio 12)', () => {
  const fake = createFakePrisma(seed());
  beforeEach(() => fake.reset());
  const del = (id: string) =>
    errorOf(() =>
      new DeleteStaffCommandHandler(fake.client).execute(
        new DeleteStaffCommand(id),
        ctx,
      ),
    );
  const row = (id: string) =>
    fake.rows('professional').find((r) => r.id === id);

  it('sin usuario y solo participante de una atención: baja lógica, no 500', async () => {
    expect(await del(staffParticipant)).toBeUndefined();
    expect(row(staffParticipant)?.deletedAt).toBeInstanceOf(Date);
    expect(fake.writes.map((w) => w.op)).toEqual(['update']);
    // se conservan las participaciones
    expect(fake.rows('workItemParticipant').length).toBe(1);
  });

  it('sin usuario y solo beneficiario de un split: baja lógica', async () => {
    expect(await del(staffBeneficiary)).toBeUndefined();
    expect(row(staffBeneficiary)?.deletedAt).toBeInstanceOf(Date);
    expect(fake.rows('workItemSplit').length).toBe(1);
  });

  it('sin usuario y con atenciones propias: baja lógica (como antes)', async () => {
    expect(await del(staffOwnWork)).toBeUndefined();
    expect(row(staffOwnWork)?.deletedAt).toBeInstanceOf(Date);
  });

  it('sin ningún vínculo: borrado físico', async () => {
    expect(await del(staffFree)).toBeUndefined();
    expect(row(staffFree)).toBeUndefined();
    expect(fake.writes.map((w) => w.op)).toEqual(['delete']);
  });

  it('aparece un vínculo entre la verificación y el borrado (P2003): baja lógica con éxito, no 500 ni 409', async () => {
    fake.failOn({ model: 'professional', op: 'delete', error: p2003 });
    expect(await del(staffFree)).toBeUndefined();
    expect(row(staffFree)?.deletedAt).toBeInstanceOf(Date);
  });

  it('P2003 y después P2025 en la baja (otro pedido lo borró): 404', async () => {
    fake.failOn({ model: 'professional', op: 'delete', error: p2003 });
    fake.failOn({ model: 'professional', op: 'update', error: p2025 });
    const e = await del(staffFree);
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
  });

  it('otro error del borrado físico se relanza', async () => {
    const boom = new Error('otro');
    fake.failOn({ model: 'professional', op: 'delete', error: boom });
    expect(await del(staffFree)).toBe(boom);
  });

  it('con usuario: sigue la regla 3 (baja lógica en transacción)', async () => {
    expect(await del(staffWithUser)).toBeUndefined();
    expect(row(staffWithUser)?.deletedAt).toBeInstanceOf(Date);
    expect(fake.transactions.length).toBe(1);
  });

  it('el nombre de un staff dado de baja sigue en las participaciones (las lecturas no filtran deletedAt)', async () => {
    await del(staffParticipant);
    const participants = await fake.client.workItemParticipant.findMany({
      where: { workItemId: wiId },
    });
    expect(participants.length).toBe(1);
    const pro = await fake.client.professional.findFirst({
      where: { id: participants[0].professionalId },
    });
    expect(pro.displayName).toBe('Staff ficticio');
  });
});
