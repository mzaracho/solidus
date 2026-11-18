/**
 * Feature 021: versiones mínimas de dependencias con avisos de seguridad corregidos.
 *
 * Lee el package.json INSTALADO de cada paquete, resolviéndolo desde quien lo usa (lo que Node cargaría en
 * runtime), y falla si queda por debajo del piso corregido. Evita que un lockfile regenerado o un `npm install`
 * sin los `overrides` de package.json reabra los avisos (proxy-addr, body-parser, express, multer, qs,
 * path-to-regexp). Compara con un helper numérico local para no depender de `semver`.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

interface Manifest {
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
}

function readManifest(file: string): Manifest {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
}

function parse(version: string): number[] {
  const core = version.split(/[-+]/)[0];
  return core.split('.').map((n) => (/^\d+$/.test(n) ? Number(n) : NaN));
}

/** true si `actual` >= `floor` (versiones x.y.z, sin prerelease relevante). Lanza si alguna no se puede parsear. */
function atLeast(actual: string, floor: string): boolean {
  const a = parse(actual);
  const f = parse(floor);
  if ([...a, ...f].some((n) => Number.isNaN(n))) {
    throw new Error(`versión no parseable: "${actual}" vs "${floor}"`);
  }
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (f[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (f[i] ?? 0)) return false;
  }
  return true;
}

/** Versión instalada de `pkg` tal como la resuelve `from` (otro paquete) o la raíz del backend. */
function installedVersion(pkg: string, from?: string): string {
  const base = from
    ? path.dirname(require.resolve(`${from}/package.json`, { paths: [ROOT] }))
    : ROOT;
  // Instalación anidada: se lee directo (algunos paquetes, como path-to-regexp 8, no exportan ./package.json).
  const nested = path.join(base, 'node_modules', pkg, 'package.json');
  if (from && fs.existsSync(nested)) return readManifest(nested).version;
  const manifest = require.resolve(`${pkg}/package.json`, { paths: [base] });
  return readManifest(manifest).version;
}

describe('versiones mínimas de dependencias (avisos de seguridad)', () => {
  it('helper de comparación', () => {
    expect(atLeast('1.20.9', '1.20.9')).toBe(true);
    expect(atLeast('1.20.10', '1.20.9')).toBe(true);
    expect(atLeast('1.20.4', '1.20.9')).toBe(false);
    expect(atLeast('2.0.2', '2.5.0')).toBe(false);
    expect(atLeast('6.16.2', '6.16.1')).toBe(true);
    expect(atLeast('6.14.3', '6.16.1')).toBe(false);
  });

  it('helper: versión no parseable falla en vez de pasar', () => {
    expect(() => atLeast('abc', '1.0.0')).toThrow('no parseable');
    expect(() => atLeast('1.x.0', '1.0.0')).toThrow('no parseable');
    expect(() => atLeast('1.0.0', '')).toThrow('no parseable');
    expect(() => atLeast('', '1.0.0')).toThrow('no parseable');
  });

  const cases: Array<[string, string | undefined, string]> = [
    ['express', '@nestjs/platform-express', '4.22.3'],
    ['body-parser', '@nestjs/platform-express', '1.20.9'],
    ['body-parser', 'express', '1.20.9'],
    ['multer', '@nestjs/platform-express', '2.5.0'],
    ['proxy-addr', 'express', '2.0.8'],
    ['qs', 'express', '6.16.1'],
    ['qs', 'body-parser', '6.16.1'],
    ['path-to-regexp', 'express', '0.1.13'],
    ['path-to-regexp', '@nestjs/swagger', '8.4.2'],
    ['lodash', '@nestjs/config', '4.18.1'],
    ['lodash', '@nestjs/swagger', '4.18.1'],
  ];

  it.each(cases)('%s (desde %s) >= %s', (pkg, from, floor) => {
    const actual = installedVersion(pkg, from);
    expect({ pkg, from, ok: atLeast(actual, floor), actual }).toEqual({
      pkg,
      from,
      ok: true,
      actual,
    });
  });

  it('axios y @nestjs/axios no están declarados (#61)', () => {
    const pkgJson = readManifest(path.join(ROOT, 'package.json'));
    const declared = {
      ...pkgJson.dependencies,
      ...pkgJson.devDependencies,
    };
    expect(Object.keys(declared)).not.toContain('axios');
    expect(Object.keys(declared)).not.toContain('@nestjs/axios');
  });

  it('package.json fija los overrides con piso en las versiones corregidas', () => {
    const pkgJson = readManifest(path.join(ROOT, 'package.json'));
    const overrides = pkgJson.overrides ?? {};
    // Piso del rango = versión corregida (^piso): ningún rango permite bajar de ahí.
    expect(overrides['express']).toBe('^4.22.3');
    expect(overrides['body-parser']).toBe('^1.20.9');
    expect(overrides['multer']).toBe('^2.5.0');
    // Pisos de rango de las directas que arrastran lodash / path-to-regexp corregidos.
    expect(pkgJson.dependencies?.['@nestjs/config']).toBe('^4.0.4');
    expect(pkgJson.dependencies?.['@nestjs/swagger']).toBe('^11.4.8');
  });
});
