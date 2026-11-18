/**
 * Feature 017 (tester): guardia de compatibilidad con `nest start` / `nest build` (lo que usa `dev.ps1`).
 *
 * El hook de alias de rutas de Nest CLI (`tsconfig-paths.hook`) falla con
 * "Cannot read properties of undefined (reading 'checkJsDirective')" cuando un archivo de producción re-exporta
 * con un alias `@src/` (`export { X } from '@src/...'`). `tsc --noEmit` y Jest NO lo detectan: el backend no
 * arranca con `.\dev.ps1` / `npm run start:dev`. Los re-exports deben usar ruta relativa, o el consumidor debe
 * importar directo del módulo que define el símbolo.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', 'src');

function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...productionFiles(full));
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    )
      out.push(full);
  }
  return out;
}

// export { A } from '@src/x';  export type { A } from '@src/x';  export * from '@src/x';  (también en varias líneas)
const REEXPORT_WITH_ALIAS =
  /^\s*export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]@src\//m;

describe('compatibilidad con nest build (hook de alias @src)', () => {
  it('ningún archivo de producción re-exporta con el alias @src/', () => {
    const offenders = productionFiles(SRC)
      .filter((f) => REEXPORT_WITH_ALIAS.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
