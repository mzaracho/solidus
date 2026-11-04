/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Prisma } from '@prisma/client';
import { createFakePrisma } from './fake-prisma';

const seed = () => ({
  patient: [
    { id: 'p1', name: 'Uno' },
    { id: 'p2', name: 'Dos' },
  ],
});

describe('fake-prisma: transacciones, fallos inyectados y P2025 (015)', () => {
  it('una transacción exitosa queda committed y marca las escrituras con inTx', async () => {
    const fake = createFakePrisma(seed());
    await fake.client.$transaction(async (tx: any) => {
      await tx.patient.create({ data: { name: 'Tres' } });
      await tx.patient.update({ where: { id: 'p1' }, data: { name: 'X' } });
    });
    expect(fake.transactions).toHaveLength(1);
    expect(fake.transactions[0].status).toBe('committed');
    expect(fake.writes.map((w) => w.inTx)).toEqual([true, true]);
    expect(fake.rows('patient')).toHaveLength(3);
  });

  it('si el callback lanza restaura las filas, trunca writes y relanza el mismo error', async () => {
    const fake = createFakePrisma(seed());
    const boom = new Error('boom');
    await expect(
      fake.client.$transaction(async (tx: any) => {
        await tx.patient.update({ where: { id: 'p1' }, data: { name: 'X' } });
        await tx.patient.delete({ where: { id: 'p2' } });
        await tx.patient.create({ data: { name: 'Tres' } });
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(fake.rows('patient')).toEqual(seed().patient);
    expect(fake.writes).toHaveLength(0);
    expect(fake.transactions[0].status).toBe('rolledBack');
    expect(fake.transactions[0].writes).toHaveLength(3);
  });

  it('una escritura con el cliente raíz dentro de la transacción queda con inTx false', async () => {
    const fake = createFakePrisma(seed());
    await fake.client.$transaction(async () => {
      await fake.client.patient.create({ data: { name: 'Afuera' } });
    });
    expect(fake.writes.map((w) => w.inTx)).toEqual([false]);
  });

  it('una transacción anidada no toma otra instantánea', async () => {
    const fake = createFakePrisma(seed());
    await fake.client.$transaction(async (tx: any) => {
      await tx.$transaction(async (inner: any) => {
        await inner.patient.create({ data: { name: 'Anidada' } });
      });
    });
    expect(fake.transactions).toHaveLength(1);
    expect(fake.rows('patient')).toHaveLength(3);
  });

  it('failOn lanza en la enésima llamada que coincide, antes de aplicarla', async () => {
    const fake = createFakePrisma(seed());
    fake.failOn({ model: 'patient', op: 'create', nth: 2 });
    await fake.client.patient.create({ data: { name: 'A' } });
    await expect(
      fake.client.patient.create({ data: { name: 'B' } }),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect(fake.rows('patient')).toHaveLength(3);
    expect(fake.writes).toHaveLength(1);
    // ya se consumió: la tercera pasa
    await fake.client.patient.create({ data: { name: 'C' } });
    expect(fake.rows('patient')).toHaveLength(4);
  });

  it('failOn acepta un error propio y reset() borra los fallos pendientes', async () => {
    const fake = createFakePrisma(seed());
    const custom = new Error('propio');
    fake.failOn({ model: 'patient', op: 'delete', error: custom });
    await expect(
      fake.client.patient.delete({ where: { id: 'p1' } }),
    ).rejects.toBe(custom);
    fake.failOn({ model: 'patient', op: 'delete' });
    fake.reset();
    await fake.client.patient.delete({ where: { id: 'p1' } });
    expect(fake.rows('patient')).toHaveLength(1);
  });

  it('update y delete sobre una fila inexistente lanzan P2025', async () => {
    const fake = createFakePrisma(seed());
    for (const call of [
      async () => {
        await fake.client.patient.update({ where: { id: 'nope' }, data: {} });
      },
      async () => {
        await fake.client.patient.delete({ where: { id: 'nope' } });
      },
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((err as Prisma.PrismaClientKnownRequestError).code).toBe('P2025');
    }
  });

  it('delete respeta una condición NOT en el where', async () => {
    const fake = createFakePrisma({
      workItem: [{ id: 'w1', paymentStatus: 'PAID', paymentDate: new Date() }],
    });
    await expect(
      fake.client.workItem.delete({
        where: {
          id: 'w1',
          NOT: { paymentStatus: 'PAID', paymentDate: { not: null } },
        },
      }),
    ).rejects.toMatchObject({ code: 'P2025' });
    expect(fake.rows('workItem')).toHaveLength(1);
  });
});
