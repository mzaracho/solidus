import * as fs from 'fs';
import * as path from 'path';
import { analyzeSource } from '../test/helpers/prisma-writes';

// Guardia del feature 015 (regla 5): toda operación con dos o más escrituras va en prisma.$transaction (forma
// interactiva) y dentro del callback solo se usa el cliente `tx`. Análisis estático con el compilador de
// TypeScript (ver test/helpers/prisma-writes.ts para las definiciones y limitaciones).
const SRC = __dirname;

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });

const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, '/');

/**
 * Lista blanca: `archivo::Clase.método` -> justificación. Hoy vacía: el código actual no tiene infracciones.
 * Cada entrada tiene que seguir siendo infractora (se controla abajo, para que no se acumulen obsoletas).
 */
const TX_ALLOWLIST: Record<string, string> = {};

interface Finding {
  key: string;
  rule: 'A' | 'B' | 'C';
}

const scan = (fileName: string, text: string): Finding[] =>
  analyzeSource(fileName, text).flatMap((u) => {
    const key = `${fileName}::${u.name}`;
    const out: Finding[] = [];
    if (u.ruleA) out.push({ key, rule: 'A' });
    if (u.ruleB.length > 0) out.push({ key, rule: 'B' });
    if (u.ruleC) out.push({ key, rule: 'C' });
    return out;
  });

const findings: Finding[] = walk(SRC).flatMap((file) =>
  scan(rel(file), fs.readFileSync(file, 'utf8')),
);
const byRule = (rule: Finding['rule']) =>
  findings
    .filter((f) => f.rule === rule && !(f.key in TX_ALLOWLIST))
    .map((f) => f.key);

describe('guardia de transacciones (015)', () => {
  it('A: ninguna unidad tiene 2 o más escrituras fuera de $transaction', () => {
    expect(byRule('A')).toEqual([]);
  });

  it('B: dentro de un callback de $transaction solo se usa el cliente tx', () => {
    expect(byRule('B')).toEqual([]);
  });

  it('C: no se usa la forma de arreglo $transaction([...])', () => {
    expect(byRule('C')).toEqual([]);
  });

  it('cada entrada de la lista blanca existe, sigue siendo infractora y tiene justificación', () => {
    const keys = new Set(findings.map((f) => f.key));
    for (const [key, why] of Object.entries(TX_ALLOWLIST)) {
      expect(keys.has(key)).toBe(true);
      expect(why.trim().length).toBeGreaterThan(10);
    }
  });

  it('el análisis ve las unidades transaccionales conocidas (control contra un detector ciego)', () => {
    const text = fs.readFileSync(
      path.join(SRC, 'infrastructure/features/activity/activity.service.ts'),
      'utf8',
    );
    const unit = analyzeSource('activity.service.ts', text).find(
      (u) => u.name === 'ActivityService.createActivity',
    );
    expect(unit).toBeDefined();
    expect(unit?.writesOutsideTx).toBe(0);
  });
});

describe('pruebas del detector (contra falsos verdes)', () => {
  const wrap = (body: string) => `class X { async m() { ${body} } }`;
  const rules = (body: string) => scan('x.ts', wrap(body)).map((f) => f.rule);

  it('dos await this.prisma.x.create seguidos: infractor', () => {
    expect(
      rules(`await this.prisma.a.create({}); await this.prisma.b.create({});`),
    ).toEqual(['A']);
  });

  it('await create + return update: infractor', () => {
    expect(
      rules(`await this.prisma.a.create({}); return this.prisma.b.update({});`),
    ).toEqual(['A']);
  });

  it('una escritura en for...of: infractor', () => {
    expect(
      rules(`for (const i of []) { await this.prisma.a.create({ data: i }); }`),
    ).toEqual(['A']);
  });

  it('una escritura en el callback de map: infractor', () => {
    expect(
      rules(
        `await Promise.all([].map((i) => this.prisma.a.update({ data: i })));`,
      ),
    ).toEqual(['A']);
  });

  it('dos create en Promise.all([...]): infractor', () => {
    expect(
      rules(
        `await Promise.all([this.prisma.a.create({}), this.prisma.b.create({})]);`,
      ),
    ).toEqual(['A']);
  });

  it('una escritura delegada a un servicio cuenta como escritura', () => {
    expect(
      rules(
        `await this.patientService.update('1', {}); await this.prisma.a.create({});`,
      ),
    ).toEqual(['A']);
  });

  it('dos return en ramas excluyentes: no infractor', () => {
    expect(
      rules(
        `if (a) { return this.prisma.a.update({}); } return this.prisma.a.create({});`,
      ),
    ).toEqual([]);
  });

  it('una sola escritura: no infractor', () => {
    expect(rules(`await this.prisma.a.create({});`)).toEqual([]);
  });

  it('tres escrituras con tx dentro de $transaction(async (tx) => ...): no infractor', () => {
    expect(
      rules(
        `return this.prisma.$transaction(async (tx) => { await tx.a.create({}); await tx.b.update({}); await tx.c.delete({}); });`,
      ),
    ).toEqual([]);
  });

  it('this.prisma.x.findFirst dentro del callback: viola B', () => {
    expect(
      rules(
        `await this.prisma.$transaction(async (tx) => { await this.prisma.a.findFirst({}); await tx.a.create({}); });`,
      ),
    ).toEqual(['B']);
  });

  it('una escritura con this.prisma dentro del callback: viola B', () => {
    expect(
      rules(
        `await this.prisma.$transaction(async (tx) => { await tx.a.create({}); await this.prisma.b.create({}); });`,
      ),
    ).toEqual(['B']);
  });

  it('$transaction([a, b]): viola C', () => {
    expect(rules(`await this.prisma.$transaction([a, b]);`)).toEqual(['C']);
  });

  it('this.entries.delete(k) dos veces (un Map): no infractor', () => {
    expect(rules(`this.entries.delete(k); this.entries.delete(k);`)).toEqual(
      [],
    );
  });

  it('las funciones de primer nivel también son unidades', () => {
    const f = scan(
      'x.ts',
      `export async function f(prisma) { await prisma.a.create({}); await prisma.b.create({}); }`,
    );
    expect(f).toEqual([{ key: 'x.ts::f', rule: 'A' }]);
  });
});
