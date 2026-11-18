/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { createFakePrisma } from '../../../../test/helpers/fake-prisma';
import {
  errorOf,
  makeCtx,
  FORBIDDEN_BODY,
  NOT_FOUND_BODY,
} from '../../../../test/helpers/scope';
import { ActivityService } from './activity.service';
import { FeeResolutionService } from '../fee-engine/fee-resolution.service';

// 017: PUT /activity/:id con monto y pagador (criterios 8 y 9) y fecha de pago obligatoria (criterio 16).
const D = (v: string | number) => new Prisma.Decimal(v);

const orgA = randomUUID();
const orgB = randomUUID();
const me = randomUUID();
const other = randomUUID();

const proMain = randomUUID();
const proCo = randomUUID();
const catMain = randomUUID();
const catCo = randomUUID();
const atId = randomUUID();
const payer1 = randomUUID();
const payer2 = randomUUID();
const payerB = randomUUID();
const wi = randomUUID();

const seed = (workItem: Record<string, any> = {}) => ({
  organization: [
    { id: orgA, type: 'CLINIC', settings: null },
    { id: orgB, type: 'CLINIC', settings: null },
  ],
  professionalCategory: [
    { id: catMain, organizationId: orgA, name: 'Senior', percentage: 60 },
    { id: catCo, organizationId: orgA, name: 'Junior', percentage: 20 },
  ],
  professional: [
    {
      id: proMain,
      organizationId: orgA,
      userId: null,
      categoryId: catMain,
      displayName: 'Principal',
      deletedAt: null,
    },
    {
      id: proCo,
      organizationId: orgA,
      userId: null,
      categoryId: catCo,
      displayName: 'Co',
      deletedAt: null,
    },
  ],
  activityType: [
    {
      id: atId,
      organizationId: orgA,
      roles: [
        {
          roleLabel: 'Titular',
          isRequired: true,
          feeStrategy: 'FIXED',
          fixedPercentage: 50,
        },
        { roleLabel: 'Coadmisor', isRequired: false, feeStrategy: 'CATEGORY' },
      ],
    },
  ],
  payer: [
    {
      id: payer1,
      organizationId: orgA,
      name: 'OS 1',
      retentionPercentage: null,
    },
    { id: payer2, organizationId: orgA, name: 'OS 2', retentionPercentage: 10 },
    {
      id: payerB,
      organizationId: orgB,
      name: 'OS B',
      retentionPercentage: null,
    },
  ],
  workItem: [
    {
      id: wi,
      organizationId: orgA,
      professionalId: proMain,
      payerId: payer1,
      activityTypeId: atId,
      serviceType: 'session',
      grossAmount: D(100),
      amountBase: D(100),
      amountCard: D(0),
      paymentStatus: 'UNPAID',
      paymentDate: null,
      createdByUserId: me,
      ...workItem,
    },
  ],
  workItemParticipant: [
    {
      id: 'part-1',
      workItemId: wi,
      professionalId: proMain,
      roleLabel: 'Titular',
      feeAmount: D(1),
      isRequired: true,
    },
    {
      id: 'part-2',
      workItemId: wi,
      professionalId: proCo,
      roleLabel: 'Coadmisor',
      feeAmount: D(2),
      isRequired: false,
    },
  ],
  workItemSplit: [
    {
      id: 'old-1',
      workItemId: wi,
      beneficiaryType: 'ORG',
      beneficiaryId: null,
      amount: D(100),
      roleLabel: 'manual',
    },
  ],
  feeRule: [],
});

const build = (workItem: Record<string, any> = {}) => {
  const fake = createFakePrisma(seed(workItem));
  const service = new ActivityService(
    fake.client,
    new FeeResolutionService(fake.client),
  );
  const scope = (role: 'ADMIN' | 'MEMBER' | null, userId = me) =>
    makeCtx({ userId, roles: { [orgA]: role } }).org!;
  return { fake, service, scope };
};

const row = (
  fake: ReturnType<typeof createFakePrisma>,
  model: string,
  id: string,
) => fake.rows(model).find((r) => r.id === id);
const splitsOf = (fake: ReturnType<typeof createFakePrisma>) =>
  fake.rows('workItemSplit').filter((r) => r.workItemId === wi);
const cents = (xs: any[]) =>
  xs.reduce((a, x) => a + Math.round(Number(x.amount) * 100), 0);

describe('ActivityService.updateActivity: monto y pagador (criterio 8)', () => {
  it('persiste monto y pagador, recalcula honorarios y splits con las reglas vigentes, todo en una transacción', async () => {
    const { fake, service, scope } = build();
    const result = await service.updateActivity(
      { id: wi, grossAmount: 250.55, payerId: payer2 },
      scope('ADMIN'),
    );

    const saved = row(fake, 'workItem', wi)!;
    expect(String(saved.grossAmount)).toBe('250.55');
    expect(String(saved.amountBase)).toBe('250.55');
    expect(saved.payerId).toBe(payer2);
    expect(result.id).toBe(wi);

    // honorarios: Titular FIXED 50 % de 250.55 = 125.275 -> 125.28; Coadmisor CATEGORY 20 % = 50.11
    expect(String(row(fake, 'workItemParticipant', 'part-1')!.feeAmount)).toBe(
      '125.28',
    );
    expect(String(row(fake, 'workItemParticipant', 'part-2')!.feeAmount)).toBe(
      '50.11',
    );
    // los participantes se conservan (mismos ids)
    expect(
      fake
        .rows('workItemParticipant')
        .map((r) => r.id)
        .sort(),
    ).toEqual(['part-1', 'part-2']);

    // splits: reemplaza el ajuste manual; el pagador 2 tiene retención 10 % (motor): ORG 25.06 + PRO 225.49
    const splits = splitsOf(fake);
    expect(splits.map((s) => s.roleLabel)).not.toContain('manual');
    expect(splits.map((s) => String(s.amount)).sort()).toEqual([
      '225.49',
      '25.06',
    ]);
    expect(cents(splits)).toBe(25055);

    // transacción única, todas las escrituras con tx
    expect(fake.transactions.length).toBe(1);
    expect(fake.transactions[0].status).toBe('committed');
    expect(fake.writes.length).toBeGreaterThan(1);
    expect(fake.writes.every((w) => w.inTx)).toBe(true);
  });

  it('usa el mismo cálculo que el alta: porcentaje de la categoría en CLINIC sin regla ni retención', async () => {
    const { fake, service, scope } = build();
    await service.updateActivity(
      { id: wi, grossAmount: 250.55 },
      scope('ADMIN'),
    );
    const splits = splitsOf(fake);
    // Senior 60 %: PRO 150.33 y ORG 100.22 (suma 250.55 al centavo)
    expect(
      splits.map((s) => [s.beneficiaryType, String(s.amount)]).sort(),
    ).toEqual([
      ['ORG', '100.22'],
      ['PROFESSIONAL', '150.33'],
    ]);
  });

  it('solo cambia el pagador: conserva monto y amountBase y recalcula', async () => {
    const { fake, service, scope } = build();
    await service.updateActivity({ id: wi, payerId: payer2 }, scope('MEMBER'));
    const saved = row(fake, 'workItem', wi)!;
    expect(saved.payerId).toBe(payer2);
    expect(String(saved.grossAmount)).toBe('100');
    expect(String(saved.amountBase)).toBe('100');
    expect(
      splitsOf(fake)
        .map((s) => String(s.amount))
        .sort(),
    ).toEqual(['10', '90']);
  });

  it('con recargo de tarjeta: amountBase = bruto - recargo; bruto menor que el recargo: 400 sin escrituras', async () => {
    const { fake, service, scope } = build({
      amountCard: D(20),
      amountBase: D(80),
    });
    await service.updateActivity({ id: wi, grossAmount: 150 }, scope('ADMIN'));
    expect(String(row(fake, 'workItem', wi)!.amountBase)).toBe('130');
    expect(String(row(fake, 'workItem', wi)!.amountCard)).toBe('20');

    const b = build({ amountCard: D(20), amountBase: D(80) });
    const e = await errorOf(() =>
      b.service.updateActivity({ id: wi, grossAmount: 10 }, b.scope('ADMIN')),
    );
    expect(e.getStatus()).toBe(400);
    expect(e.getResponse()).toEqual({
      code: 'bad-request',
      message:
        'El monto no puede ser menor que el recargo por tarjeta de la atención.',
    });
    expect(b.fake.writeCount()).toBe(0);
  });

  it('pagador de otra organización o inexistente: el mismo 404 genérico y sin escrituras', async () => {
    const { fake, service, scope } = build();
    const foreign = await errorOf(() =>
      service.updateActivity({ id: wi, payerId: payerB }, scope('ADMIN')),
    );
    const missing = await errorOf(() =>
      service.updateActivity({ id: wi, payerId: randomUUID() }, scope('ADMIN')),
    );
    expect(foreign.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(missing.getResponse()).toEqual(foreign.getResponse());
    expect(fake.writeCount()).toBe(0);
  });

  it('payerId null: usa el pagador particular de la organización', async () => {
    const { fake, scope } = build();
    // el particular existe
    const particular = randomUUID();
    const b = createFakePrisma({
      ...seed(),
      payer: [
        ...seed().payer,
        {
          id: particular,
          organizationId: orgA,
          name: 'Particular',
          retentionPercentage: null,
        },
      ],
    });
    const svc = new ActivityService(
      b.client,
      new FeeResolutionService(b.client),
    );
    await svc.updateActivity({ id: wi, payerId: null }, scope('ADMIN'));
    expect(row(b, 'workItem', wi)!.payerId).toBe(particular);
    expect(b.rows('payer').length).toBe(4);
    expect(fake.writeCount()).toBe(0);
  });

  it('payerId null sin pagador particular: lo crea dentro de la transacción', async () => {
    const { fake, service, scope } = build();
    await service.updateActivity({ id: wi, payerId: null }, scope('ADMIN'));
    const created = fake.rows('payer').find((p) => p.name === 'Particular');
    expect(created).toBeDefined();
    expect(created!.isManagedBySystem).toBe(true);
    expect(row(fake, 'workItem', wi)!.payerId).toBe(created!.id);
    expect(fake.writes[0]).toMatchObject({
      model: 'payer',
      op: 'create',
      inTx: true,
    });
  });

  it('falla inyectada al crear los splits: rollback de todo (monto, pagador y participantes)', async () => {
    const { fake, service, scope } = build();
    fake.failOn({ model: 'workItemSplit', op: 'createMany' });
    const e = await errorOf(() =>
      service.updateActivity(
        { id: wi, grossAmount: 500, payerId: null },
        scope('ADMIN'),
      ),
    );
    expect(e).toBeDefined();
    const saved = row(fake, 'workItem', wi)!;
    expect(String(saved.grossAmount)).toBe('100');
    expect(saved.payerId).toBe(payer1);
    expect(fake.rows('payer').some((p) => p.name === 'Particular')).toBe(false);
    expect(String(row(fake, 'workItemParticipant', 'part-1')!.feeAmount)).toBe(
      '1',
    );
    expect(splitsOf(fake).map((s) => s.id)).toEqual(['old-1']);
    expect(fake.transactions[0].status).toBe('rolledBack');
  });

  it('permisos del 007: ADMIN y MEMBER editan una ajena; el profesional solo lo suyo', async () => {
    for (const role of ['ADMIN', 'MEMBER'] as const) {
      const { fake, service, scope } = build({ createdByUserId: other });
      await service.updateActivity({ id: wi, grossAmount: 300 }, scope(role));
      expect(String(row(fake, 'workItem', wi)!.grossAmount)).toBe('300');
    }
    const own = build({ createdByUserId: me });
    await own.service.updateActivity(
      { id: wi, grossAmount: 300 },
      own.scope(null),
    );
    expect(String(row(own.fake, 'workItem', wi)!.grossAmount)).toBe('300');

    const foreign = build({ createdByUserId: other });
    const e = await errorOf(() =>
      foreign.service.updateActivity(
        { id: wi, grossAmount: 300 },
        foreign.scope(null),
      ),
    );
    expect(e.getResponse()).toEqual(FORBIDDEN_BODY);
    expect(foreign.fake.writeCount()).toBe(0);
  });

  it('atención de otra organización o inexistente: 404 antes del 403 y sin escrituras', async () => {
    const { fake, service, scope } = build({ organizationId: orgB });
    const e = await errorOf(() =>
      service.updateActivity({ id: wi, grossAmount: 300 }, scope('ADMIN')),
    );
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
    expect(fake.writeCount()).toBe(0);
  });
});

describe('ActivityService.updateActivity: atención cobrada (criterio 9)', () => {
  const collected = {
    paymentStatus: 'PAID',
    paymentDate: new Date('2026-02-01T12:00:00Z'),
  };

  it('cambiar el monto: 409 activity-already-collected, sin aplicar ningún cambio', async () => {
    const { fake, service, scope } = build(collected);
    const e = await errorOf(() =>
      service.updateActivity(
        { id: wi, grossAmount: 999, attendance: 'PRESENT' as any },
        scope('ADMIN'),
      ),
    );
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse()).toEqual({
      code: 'activity-already-collected',
      message:
        'Esta atención ya está cobrada: el monto y el pagador no se pueden modificar. No se guardó ningún cambio.',
    });
    expect(fake.writeCount()).toBe(0);
  });

  it('cambiar el pagador: 409 sin escrituras', async () => {
    const { fake, service, scope } = build(collected);
    const e = await errorOf(() =>
      service.updateActivity({ id: wi, payerId: payer2 }, scope('ADMIN')),
    );
    expect(e.getResponse().code).toBe('activity-already-collected');
    expect(fake.writeCount()).toBe(0);
  });

  it('mandar los mismos valores guardados no cuenta como cambio (100 frente a 100.00)', async () => {
    const { fake, service, scope } = build(collected);
    await service.updateActivity(
      {
        id: wi,
        grossAmount: 100,
        payerId: payer1,
        attendance: 'PRESENT' as any,
      },
      scope('ADMIN'),
    );
    expect(row(fake, 'workItem', wi)!.attendance).toBe('PRESENT');
    // una sola escritura, fuera de transacción: no hay recálculo
    expect(fake.writes.map((w) => `${w.model}.${w.op}:${w.inTx}`)).toEqual([
      'workItem.update:false',
    ]);
    expect(splitsOf(fake).map((s) => s.id)).toEqual(['old-1']);
  });

  it('editar los demás campos sigue funcionando', async () => {
    const { fake, service, scope } = build(collected);
    await service.updateActivity(
      { id: wi, paymentMethod: 'Transferencia', attendance: 'ABSENT' as any },
      scope('ADMIN'),
    );
    expect(row(fake, 'workItem', wi)!.paymentMethod).toBe('Transferencia');
  });

  it('carrera: se cobró entre la lectura y la escritura: updateMany con count 0 da 409 y no queda nada', async () => {
    const { fake, scope } = build();
    // simula la otra sesión: el cobro se confirma justo después de que la edición leyó la atención
    let first = true;
    const racing: any = new Proxy(fake.client, {
      get: (t, prop) => {
        if (prop !== 'workItem') return t[prop as any];
        return {
          ...t.workItem,
          findFirst: async (a: any) => {
            const r = await t.workItem.findFirst(a);
            if (first) {
              first = false;
              await t.workItem.update({ where: { id: wi }, data: collected });
            }
            return r;
          },
        };
      },
    });
    const svc = new ActivityService(
      racing,
      new FeeResolutionService(fake.client),
    );
    const e = await errorOf(() =>
      svc.updateActivity({ id: wi, grossAmount: 999 }, scope('ADMIN')),
    );
    expect(e.getResponse().code).toBe('activity-already-collected');
    const saved = row(fake, 'workItem', wi)!;
    expect(String(saved.grossAmount)).toBe('100');
    expect(saved.paymentStatus).toBe('PAID');
    expect(splitsOf(fake).map((s) => s.id)).toEqual(['old-1']);
    expect(fake.transactions[0].status).toBe('rolledBack');
  });

  it('carrera: la atención se borró entre la lectura y la escritura: 404', async () => {
    const { fake, scope } = build();
    let first = true;
    const racing: any = new Proxy(fake.client, {
      get: (t, prop) => {
        if (prop !== 'workItem') return t[prop as any];
        return {
          ...t.workItem,
          findFirst: async (a: any) => {
            const r = await t.workItem.findFirst(a);
            if (first) {
              first = false;
              await t.workItem.delete({ where: { id: wi } });
            }
            return r;
          },
        };
      },
    });
    const svc = new ActivityService(
      racing,
      new FeeResolutionService(fake.client),
    );
    const e = await errorOf(() =>
      svc.updateActivity({ id: wi, grossAmount: 999 }, scope('ADMIN')),
    );
    expect(e.getResponse()).toEqual(NOT_FOUND_BODY);
  });

  it('el mismo pedido cobra y cambia el monto sobre una no cobrada: se aplica entero y recalcula', async () => {
    const { fake, service, scope } = build();
    await service.updateActivity(
      {
        id: wi,
        grossAmount: 200,
        paymentStatus: 'PAID' as any,
        paymentDate: '2026-03-02',
      },
      scope('ADMIN'),
    );
    const saved = row(fake, 'workItem', wi)!;
    expect(String(saved.grossAmount)).toBe('200');
    expect(saved.paymentStatus).toBe('PAID');
    expect(saved.paymentDate).toBeInstanceOf(Date);
    expect(cents(splitsOf(fake))).toBe(20000);
  });

  it('guardada cobrada, pedido que la pasa a pendiente y cambia el monto: 409', async () => {
    const { fake, service, scope } = build(collected);
    const e = await errorOf(() =>
      service.updateActivity(
        { id: wi, grossAmount: 200, paymentStatus: 'UNPAID' as any },
        scope('ADMIN'),
      ),
    );
    expect(e.getResponse().code).toBe('activity-already-collected');
    expect(fake.writeCount()).toBe(0);
  });

  it('PAID sin fecha de pago NO es cobrada: monto y pagador siguen editables', async () => {
    const { fake, service, scope } = build({
      paymentStatus: 'PAID',
      paymentDate: null,
    });
    await service.updateActivity({ id: wi, grossAmount: 321 }, scope('ADMIN'));
    expect(String(row(fake, 'workItem', wi)!.grossAmount)).toBe('321');
  });
});

describe('ActivityService.updateActivity: fecha de pago obligatoria (criterio 16)', () => {
  it('PAID sin fecha (ni en el pedido ni guardada): 400 payment-date-required sin aplicar cambios', async () => {
    const { fake, service, scope } = build();
    const e = await errorOf(() =>
      service.updateActivity(
        { id: wi, paymentStatus: 'PAID' as any, attendance: 'PRESENT' as any },
        scope('ADMIN'),
      ),
    );
    expect(e.getStatus()).toBe(400);
    expect(e.getResponse().code).toBe('payment-date-required');
    expect(typeof e.getResponse().message).toBe('string');
    expect(fake.writeCount()).toBe(0);
  });

  it('PAID con fecha en el pedido: se guarda', async () => {
    const { fake, service, scope } = build();
    await service.updateActivity(
      { id: wi, paymentStatus: 'PAID' as any, paymentDate: '2026-03-05' },
      scope('ADMIN'),
    );
    const saved = row(fake, 'workItem', wi)!;
    expect(saved.paymentStatus).toBe('PAID');
    expect(saved.paymentDate.toISOString().slice(0, 10)).toBe('2026-03-05');
  });

  it('PAID cuando ya hay una fecha guardada: vale', async () => {
    const { fake, service, scope } = build({
      paymentStatus: 'UNPAID',
      paymentDate: new Date('2026-01-10T12:00:00Z'),
    });
    await service.updateActivity(
      { id: wi, paymentStatus: 'PAID' as any },
      scope('ADMIN'),
    );
    expect(row(fake, 'workItem', wi)!.paymentStatus).toBe('PAID');
  });

  it('una PAID antigua sin fecha: las ediciones que no tocan paymentStatus no se bloquean', async () => {
    const { fake, service, scope } = build({
      paymentStatus: 'PAID',
      paymentDate: null,
    });
    await service.updateActivity(
      { id: wi, attendance: 'PRESENT' as any, grossAmount: 150 },
      scope('ADMIN'),
    );
    expect(row(fake, 'workItem', wi)!.attendance).toBe('PRESENT');
  });

  it('una PAID antigua sin fecha se completa agregando la fecha', async () => {
    const { fake, service, scope } = build({
      paymentStatus: 'PAID',
      paymentDate: null,
    });
    await service.updateActivity(
      { id: wi, paymentDate: '2026-02-03' },
      scope('ADMIN'),
    );
    expect(
      row(fake, 'workItem', wi)!.paymentDate.toISOString().slice(0, 10),
    ).toBe('2026-02-03');
  });

  it('PAID sin fecha + otro campo mandando el mismo paymentStatus: 200 sin fecha', async () => {
    const { fake, service, scope } = build({
      paymentStatus: 'PAID',
      paymentDate: null,
    });
    await service.updateActivity(
      { id: wi, paymentStatus: 'PAID' as any, attendance: 'PRESENT' as any },
      scope('ADMIN'),
    );
    const saved = row(fake, 'workItem', wi)!;
    expect(saved.attendance).toBe('PRESENT');
    expect(saved.paymentDate).toBeNull();
  });

  it('UNPAID -> PAID sin fecha en el pedido ni guardada: 400', async () => {
    const { service, scope } = build({
      paymentStatus: 'UNPAID',
      paymentDate: null,
    });
    const e = await errorOf(() =>
      service.updateActivity(
        { id: wi, paymentStatus: 'PAID' as any },
        scope('ADMIN'),
      ),
    );
    expect(e.getResponse().code).toBe('payment-date-required');
  });

  it('PAID con fecha: mandar paymentDate null o vacía (borrarla) es 400 y no cambia nada', async () => {
    for (const empty of [null, '']) {
      const { fake, service, scope } = build({
        paymentStatus: 'PAID',
        paymentDate: new Date('2026-01-10T00:00:00.000Z'),
      });
      const e = await errorOf(() =>
        service.updateActivity(
          { id: wi, paymentDate: empty as any },
          scope('ADMIN'),
        ),
      );
      expect(e.getResponse().code).toBe('payment-date-required');
      expect(
        row(fake, 'workItem', wi)!.paymentDate.toISOString().slice(0, 10),
      ).toBe('2026-01-10');
    }
  });

  it('monto con más de 2 decimales que redondea a lo guardado no es cambio (sin 409 sobre una cobrada)', async () => {
    const { fake, service, scope } = build({
      paymentStatus: 'PAID',
      paymentDate: new Date('2026-01-10T00:00:00.000Z'),
      grossAmount: 100,
    });
    await service.updateActivity(
      { id: wi, grossAmount: 100.001, attendance: 'PRESENT' as any },
      scope('ADMIN'),
    );
    expect(row(fake, 'workItem', wi)!.attendance).toBe('PRESENT');
  });

  it('pasar a pendiente o parcial no exige fecha', async () => {
    const { fake, service, scope } = build();
    await service.updateActivity(
      { id: wi, paymentStatus: 'PARTIAL' as any },
      scope('ADMIN'),
    );
    expect(row(fake, 'workItem', wi)!.paymentStatus).toBe('PARTIAL');
  });
});
