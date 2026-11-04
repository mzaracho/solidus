/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

type Row = Record<string, any>;

/**
 * Prisma en memoria para los tests de integración (sin base de datos). Soporta lo justo:
 *  - where: igualdad, null, { in }, { not }, { lt/lte/gt/gte }, AND, OR y NOT. Cualquier otro operador lanza
 *    un error, para que un cambio en una consulta no dé un falso verde.
 *  - filtros de relación SOLO para relaciones declaradas en RELATIONS: `{ rel: { some: {...} } }` en las
 *    relaciones `many` y `{ rel: {...} }` en las de un solo registro (009).
 *  - relaciones declaradas en RELATIONS para include/select.
 *  - toda escritura queda registrada en `writes` y se aplica sobre las tablas.
 *  - $transaction(fn) (015): toma una instantánea de las tablas y de `writes`; si fn lanza, restaura todo y
 *    relanza el error, como el rollback de Postgres. fn recibe un cliente que marca sus escrituras con
 *    `inTx: true`; una escritura con el cliente raíz mientras hay una transacción abierta queda con `inTx: false`.
 *  - failOn({ model, op, nth, error }) hace fallar la enésima escritura que coincide, antes de aplicarla.
 *  - update/delete sobre una fila inexistente lanzan PrismaClientKnownRequestError P2025, como Prisma.
 */
const RELATIONS: Record<
  string,
  Record<string, { model: string; fk: string; many?: boolean }>
> = {
  workItem: {
    patient: { model: 'patient', fk: 'patientId' },
    professional: { model: 'professional', fk: 'professionalId' },
    payer: { model: 'payer', fk: 'payerId' },
    preset: { model: 'feePreset', fk: 'presetId' },
    splits: { model: 'workItemSplit', fk: 'workItemId', many: true },
    participants: {
      model: 'workItemParticipant',
      fk: 'workItemId',
      many: true,
    },
    organization: { model: 'organization', fk: 'organizationId' },
  },
  patient: {
    workItems: { model: 'workItem', fk: 'patientId', many: true },
  },
  organizationMember: {
    organization: { model: 'organization', fk: 'organizationId' },
  },
  professional: {
    workItems: { model: 'workItem', fk: 'professionalId', many: true },
    category: { model: 'professionalCategory', fk: 'categoryId' },
  },
  payer: {
    professional: { model: 'professional', fk: 'professionalId' },
  },
};

const WRITE_OPS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
];

/** Convierte { rel: { connect: { id } } } en la clave foránea relId, como hace Prisma al persistir. */
const flattenConnects = (data: Row): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'connect' in v) {
      out[`${k}Id`] = v.connect.id;
    } else {
      out[k] = v;
    }
  }
  return out;
};

type Table = (model: string) => Row[];

const makeMatcher = (table: Table) => {
  const matches = (
    row: Row,
    where: Row | undefined,
    model?: string,
  ): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, cond]) => {
      if (cond === undefined) return true;
      if (key === 'AND')
        return (cond as Row[]).every((w) => matches(row, w, model));
      if (key === 'OR')
        return (cond as Row[]).some((w) => matches(row, w, model));
      if (key === 'NOT')
        return !(Array.isArray(cond) ? cond : [cond]).some((w: Row) =>
          matches(row, w, model),
        );
      // filtro de relación (solo relaciones declaradas)
      const rel = model ? RELATIONS[model]?.[key] : undefined;
      if (rel && cond !== null && typeof cond === 'object') {
        if (rel.many) {
          const ops = Object.keys(cond as Row);
          if (ops.length !== 1 || ops[0] !== 'some')
            throw new Error(
              `fake-prisma: filtro de relación no soportado "${ops.join(',')}" en ${model}.${key}`,
            );
          return table(rel.model)
            .filter((t) => t[rel.fk] === row.id)
            .some((t) => matches(t, (cond as Row).some, rel.model));
        }
        const target = table(rel.model).find((t) => t.id === row[rel.fk]);
        return !!target && matches(target, cond as Row, rel.model);
      }
      const value = row[key] === undefined ? null : row[key];
      if (cond === null) return value === null;
      if (cond instanceof Date || typeof cond !== 'object')
        return value === cond;
      return Object.entries(cond as Row).every(([op, arg]) => {
        switch (op) {
          case 'in':
            return (arg as any[]).includes(value);
          case 'not':
            return arg === null ? value !== null : value !== arg;
          case 'lte':
            return value !== null && value <= arg;
          case 'gte':
            return value !== null && value >= arg;
          case 'lt':
            return value !== null && value < arg;
          case 'gt':
            return value !== null && value > arg;
          case 'mode':
            return true;
          case 'contains':
            return String(value ?? '')
              .toLowerCase()
              .includes(String(arg).toLowerCase());
          default:
            throw new Error(
              `fake-prisma: operador de where no soportado "${op}" en ${key}`,
            );
        }
      });
    });
  };
  return matches;
};

export interface FakeWrite {
  model: string;
  op: string;
  /** true si la escritura se hizo con el cliente del callback de $transaction. */
  inTx: boolean;
}

export interface FakeTransaction {
  status: 'committed' | 'rolledBack';
  writes: FakeWrite[];
}

export interface FailOnSpec {
  model: string;
  op: string;
  /** Enésima llamada que coincide (por defecto la primera). */
  nth?: number;
  error?: Error;
}

const p2025 = (model: string, op: string) =>
  new Prisma.PrismaClientKnownRequestError(
    `fake-prisma: ${op} sobre fila inexistente (${model})`,
    { code: 'P2025', clientVersion: 'fake' },
  );

export function createFakePrisma(seed: Record<string, Row[]>) {
  let tables: Record<string, Row[]> = {};
  const writes: FakeWrite[] = [];
  const transactions: FakeTransaction[] = [];
  let failures: { spec: FailOnSpec; seen: number }[] = [];
  /** Transacción abierta (si la hay): sus escrituras con inTx. */
  let openTx: FakeTransaction | null = null;

  const reset = () => {
    transactions.length = 0;
    failures = [];
    openTx = null;
    tables = {};
    for (const [model, rows] of Object.entries(seed)) {
      tables[model] = rows.map((r) => ({ ...r }));
    }
    writes.length = 0;
  };
  reset();

  const table = (model: string) => (tables[model] ??= []);
  const matches = makeMatcher(table);

  const shape = (
    model: string,
    row: Row | undefined,
    args: Row | undefined,
  ): Row | null => {
    if (!row) return null;
    const out: Row = { ...row };
    const spec: Row = { ...(args?.include ?? {}), ...(args?.select ?? {}) };
    for (const [name, rel] of Object.entries(RELATIONS[model] ?? {})) {
      if (!spec[name]) continue;
      const target = table(rel.model);
      const sub = typeof spec[name] === 'object' ? spec[name] : undefined;
      if (rel.many) {
        let list = target.filter((t) => t[rel.fk] === row.id);
        if (sub?.take) list = list.slice(0, sub.take);
        out[name] = list.map((t) => shape(rel.model, t, sub));
      } else {
        const found = target.find((t) => t.id === row[rel.fk]);
        out[name] = shape(rel.model, found, sub);
      }
    }
    if (args?.select) {
      const picked: Row = {};
      for (const k of Object.keys(args.select))
        if (args.select[k]) picked[k] = out[k];
      return picked;
    }
    return out;
  };

  /** Registra una escritura; si coincide con un failOn pendiente, lanza antes de aplicarla. */
  const record = (model: string, op: string, inTx: boolean) => {
    for (const f of failures) {
      if (f.spec.model !== model || f.spec.op !== op) continue;
      f.seen += 1;
      if (f.seen === (f.spec.nth ?? 1)) {
        throw (
          f.spec.error ??
          new Prisma.PrismaClientKnownRequestError(
            'fake-prisma: fallo inyectado',
            { code: 'P2034', clientVersion: 'fake' },
          )
        );
      }
    }
    const w: FakeWrite = { model, op, inTx };
    writes.push(w);
    if (inTx) openTx?.writes.push(w);
  };

  const modelApi = (model: string, inTx: boolean) => {
    const api: Record<string, (args?: any) => Promise<any>> = {
      findFirst: async (args) =>
        shape(
          model,
          table(model).find((r) => matches(r, args?.where, model)),
          args,
        ),
      findUnique: async (args) =>
        shape(
          model,
          table(model).find((r) => matches(r, args?.where, model)),
          args,
        ),
      findMany: async (args) => {
        let rows = table(model).filter((r) => matches(r, args?.where, model));
        if (args?.skip) rows = rows.slice(args.skip);
        if (args?.take) rows = rows.slice(0, args.take);
        return rows.map((r) => shape(model, r, args));
      },
      // groupBy mínimo: by (una o más columnas) y _sum sobre columnas numéricas
      groupBy: async (args) => {
        const by: string[] = args.by;
        const sums = Object.keys(args._sum ?? {});
        const groups = new Map<string, Row>();
        for (const r of table(model).filter((x) => matches(x, args?.where, model))) {
          const key = JSON.stringify(by.map((k) => r[k] ?? null));
          let g = groups.get(key);
          if (!g) {
            g = { _sum: {} };
            by.forEach((k) => (g![k] = r[k] ?? null));
            sums.forEach((k) => (g!._sum[k] = 0));
            groups.set(key, g);
          }
          sums.forEach((k) => (g!._sum[k] += Number(r[k] ?? 0)));
        }
        return [...groups.values()];
      },
      count: async (args) =>
        table(model).filter((r) => matches(r, args?.where, model)).length,
      create: async (args) => {
        record(model, 'create', inTx);
        const row = { id: randomUUID(), ...flattenConnects(args.data) };
        table(model).push(row);
        return { ...row };
      },
      createMany: async (args) => {
        record(model, 'createMany', inTx);
        for (const d of args.data)
          table(model).push({ id: randomUUID(), ...d });
        return { count: args.data.length };
      },
      update: async (args) => {
        record(model, 'update', inTx);
        const row = table(model).find((r) => matches(r, args.where, model));
        if (!row) throw p2025(model, 'update');
        Object.assign(row, args.data);
        return { ...row };
      },
      updateMany: async (args) => {
        record(model, 'updateMany', inTx);
        const rows = table(model).filter((r) => matches(r, args.where, model));
        rows.forEach((r) => Object.assign(r, args.data));
        return { count: rows.length };
      },
      delete: async (args) => {
        record(model, 'delete', inTx);
        const idx = table(model).findIndex((r) => matches(r, args.where, model));
        if (idx < 0) throw p2025(model, 'delete');
        const [row] = table(model).splice(idx, 1);
        return row;
      },
      deleteMany: async (args) => {
        record(model, 'deleteMany', inTx);
        const before = table(model).length;
        tables[model] = table(model).filter((r) => !matches(r, args?.where, model));
        return { count: before - tables[model].length };
      },
    };
    return api;
  };

  const makeClient = (inTx: boolean): any =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (typeof prop !== 'string' || prop === 'then') return undefined;
          if (prop === '$transaction') {
            return async (arg: any) => {
              if (typeof arg !== 'function') return Promise.all(arg);
              // anidada: sin otra instantánea
              if (openTx) return arg(txClient);
              const snapshot: Record<string, Row[]> = {};
              for (const [m, rows] of Object.entries(tables))
                snapshot[m] = rows.map((r) => ({ ...r }));
              const writesBefore = writes.length;
              const tx: FakeTransaction = { status: 'committed', writes: [] };
              openTx = tx;
              try {
                const result = await arg(txClient);
                transactions.push(tx);
                return result;
              } catch (err) {
                tables = snapshot;
                writes.length = writesBefore;
                tx.status = 'rolledBack';
                transactions.push(tx);
                throw err;
              } finally {
                openTx = null;
              }
            };
          }
          if (prop.startsWith('$') || prop.startsWith('_')) return undefined;
          return modelApi(prop, inTx);
        },
      },
    );
  const txClient: any = makeClient(true);
  const client: any = makeClient(false);

  return {
    client,
    writes,
    /** Transacciones cerradas desde el último reset, con su estado final. */
    transactions,
    /** Hace fallar la enésima escritura que coincide (antes de aplicarla). reset() las borra. */
    failOn: (spec: FailOnSpec) => {
      failures.push({ spec, seen: 0 });
    },
    reset,
    /** Cantidad de escrituras registradas desde el último reset. */
    writeCount: () => writes.length,
    rows: (model: string) => table(model).map((r) => ({ ...r })),
    WRITE_OPS,
  };
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
