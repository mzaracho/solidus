/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import * as fs from 'fs';
import * as path from 'path';

// Invariantes estáticos de seguridad del feature 005: se leen los fuentes (sin *.spec.ts).
const SRC = __dirname;

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });

const files = walk(SRC);
const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, '/');
const sources = files.map((file) => ({
  file: rel(file),
  text: fs.readFileSync(file, 'utf8'),
}));

const filesMatching = (re: RegExp) =>
  sources.filter((s) => re.test(s.text)).map((s) => s.file);

describe('invariantes de seguridad', () => {
  it('x-user-id solo aparece en el guard de autenticación', () => {
    expect(filesMatching(/x-user-id/i)).toEqual([
      'infrastructure.bootstrap/guards/authentication-guard.ts',
    ]);
  });

  it('nadie decodifica JWT sin verificar en el backend', () => {
    expect(filesMatching(/\.decode\(/)).toEqual([]);
  });

  it('no quedan referencias a los guards y servicios retirados', () => {
    expect(
      filesMatching(/ApiKeyGuard|VerifyTokenService|JwtAuthGuard|AuthGuard\b/),
    ).toEqual([]);
  });

  it('console.log solo existe en el logger central', () => {
    expect(filesMatching(/console\.log\(/)).toEqual([
      'infrastructure.bootstrap/config/core/logger.ts',
    ]);
  });

  it('no hay otros console.* con payloads fuera del logger central', () => {
    expect(
      filesMatching(/console\.(info|debug|warn|error|dir|table)\(/),
    ).toEqual(['infrastructure.bootstrap/config/core/logger.ts']);
  });

  it('CORS no refleja cualquier origen', () => {
    expect(filesMatching(/origin:\s*true/)).toEqual([]);
  });

  it('hay exactamente un JwtModule.register*', () => {
    const matches = sources.flatMap((s) =>
      [...s.text.matchAll(/JwtModule\s*\.\s*register(Async)?\s*\(/g)].map(
        () => s.file,
      ),
    );
    expect(matches).toEqual(['infrastructure.bootstrap/modules/app-module.ts']);
  });

  it('ningún controlador usa @UseGuards con guards de autenticación (el guard es global)', () => {
    const offenders = sources
      .filter((s) => s.file.startsWith('api/controllers/'))
      .filter((s) => /UseGuards\((?!OrgRoleGuard\))/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('los controladores no leen la organización o el usuario de headers directamente para identidad', () => {
    expect(filesMatching(/@Headers\(\s*['"]x-user-id['"]\s*\)/)).toEqual([]);
  });
});
