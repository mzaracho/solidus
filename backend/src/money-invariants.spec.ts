import * as fs from 'fs';
import * as path from 'path';
import {
  analyzeMoneySource,
  countMoneyHelperCalls,
  MoneyFinding,
} from '../test/helpers/money-ops';

// Guardia del feature 017 (criterio 1): ningún camino de dinero hace aritmética con `number`, parseFloat ni
// Number(). Todo pasa por el helper común `domain/seed-work/money.ts` (sobre Prisma.Decimal). Análisis estático
// con el compilador de TypeScript (ver test/helpers/money-ops.ts para las reglas M1 y M2 y sus límites).
const SRC = __dirname;

/** Caminos de dinero: splits, honorarios de participantes, KPIs, liquidaciones, listados y deuda de pacientes. */
const MONEY_FILES = [
  'infrastructure/features/fee-engine/fee-resolution.service.ts',
  'infrastructure/features/activity/activity.service.ts',
  'infrastructure/features/dashboard/dashboard.service.ts',
  'application/features/settlements/queries/calculate-settlements-query.ts',
  'application/features/activity/queries/find-all-activities-query.ts',
  'application/features/activity/queries/find-activity-by-id-query.ts',
  'application/features/patients/queries/get-patient-summary-query.ts',
  'infrastructure/features/patients/patients.service.ts',
];

/**
 * Lista blanca: `archivo::texto exacto` -> justificación. Son usos que no son dinero. Cada entrada tiene que
 * seguir existiendo (no se acumulan obsoletas) y justificarse.
 */
const MONEY_ALLOWLIST: Record<string, string> = {
  'application/features/activity/queries/find-all-activities-query.ts::Math.ceil(total / limit)':
    'paginación: total de filas y tamaño de página, no dinero',
  'infrastructure/features/patients/patients.service.ts::Number(limit)':
    'tamaño de página de la paginación, no dinero',
  'application/features/activity/queries/find-all-activities-query.ts::total / limit':
    'paginación: total de filas y tamaño de página, no dinero',
};

const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const scan = (rel: string): MoneyFinding[] =>
  analyzeMoneySource(rel, read(rel));

const keyOf = (rel: string, f: MoneyFinding) => `${rel}::${f.text}`;

describe('guardia de dinero exacto (017, criterio 1)', () => {
  it('los archivos de MONEY_FILES existen', () => {
    for (const rel of MONEY_FILES) {
      expect(fs.existsSync(path.join(SRC, rel))).toBe(true);
    }
  });

  it('M1 y M2: ningún camino de dinero usa number (salvo la lista blanca)', () => {
    const findings = MONEY_FILES.flatMap((rel) =>
      scan(rel)
        .filter((f) => !(keyOf(rel, f) in MONEY_ALLOWLIST))
        .map((f) => `${rel}:${f.line} ${f.rule} ${f.text}`),
    );
    expect(findings).toEqual([]);
  });

  it('cada entrada de la lista blanca existe, sigue siendo un hallazgo y tiene justificación', () => {
    const seen = new Set(
      MONEY_FILES.flatMap((rel) => scan(rel).map((f) => keyOf(rel, f))),
    );
    for (const [key, why] of Object.entries(MONEY_ALLOWLIST)) {
      expect(seen.has(key)).toBe(true);
      expect(why.trim().length).toBeGreaterThan(10);
    }
  });

  it('control contra un detector ciego: un snippet con number da hallazgos M1 y M2', () => {
    const snippet = [
      'export const total = (items: { amount: unknown }[]) => {',
      '  let sum = 0;',
      '  for (const x of items) sum = sum + Number(x.amount);',
      '  const gross = sum * 1.1;',
      "  return gross.toFixed(2) + Math.round(sum) + parseFloat('1');",
      '};',
    ].join('\n');
    const rules = new Set(
      analyzeMoneySource('snippet.ts', snippet).map((f) => f.rule),
    );
    expect(rules.has('M1')).toBe(true);
    expect(rules.has('M2')).toBe(true);
    // y un snippet limpio (Decimal) no da nada
    expect(
      analyzeMoneySource(
        'ok.ts',
        'const t = sumMoney(items.map((i) => i.amount)).add(x);',
      ),
    ).toEqual([]);
  });

  it('el motor real se analiza sin error y usa el helper común', () => {
    const rel = 'infrastructure/features/fee-engine/fee-resolution.service.ts';
    expect(() => scan(rel)).not.toThrow();
    expect(countMoneyHelperCalls(read(rel))).toBeGreaterThan(0);
    expect(
      countMoneyHelperCalls(
        read('infrastructure/features/dashboard/dashboard.service.ts'),
      ),
    ).toBeGreaterThan(0);
  });
});
