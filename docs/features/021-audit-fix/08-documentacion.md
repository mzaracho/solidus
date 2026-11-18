# 021 — Documentación

Documentador. Fecha: 2026-11-18. Solo documentación; no se tocó código. Fuentes: 00-estado, 04-implementacion,
07-testing (APROBADO) y los archivos modificados del repo.

## Qué cambió en el feature (resumen)
Next 16.4.3 a 16.4.6 con `experimental.agentUpgrade: false`; `npm audit fix` sin `--force` en ambos repos; `overrides` de
`express`, `body-parser` y `multer` en el backend; `axios` y `@nestjs/axios` quitados; tests de pisos
(`dependency-floors.spec.ts`) y de gzip. `npm audit`: frontend 0; backend producción 0 críticos / 0 altos / 4 moderados.

## Archivos de documentación modificados
| Archivo | Cambio |
|---|---|
| `.claude/CLAUDE.md` | Stack Next 16.4.6; backend 58 suites / 1036 tests; `npm install --legacy-peer-deps`; sección breve "Dependencias (021)" (sin `--force`, overrides y su test, `--legacy-peer-deps`, `agentUpgrade: false`, nunca `next upgrade`). Frontend 148 y dev-lib 1151 ya estaban correctos; no mencionaba `axios` |
| `docs/auditoria/COMANDOS.md` | Workaround de `SecurityFatalError` (Next 16.4.3) reemplazado por nota de que ya no aplica; `npm audit` (con `--use-system-ca`), `--legacy-peer-deps`, dos pasadas de `audit fix`, `invalid` benigno en `npm ls`; líneas base de lint 755/153 y 140/42 |
| `docs/auditoria/BACKLOG.md` | RESUELTOS #36, #61, #103 y la parte de #25; nota en #35 con los residuales; sección "Candidatos surgidos del feature 021" (#115 a #122) |
| `docs/features/PLAN-pendientes.md` | 021 Hecho (sin hash); 019 "Siguiente"; #118/#119 a 020, #115/#120 a 022, #119 a 024 (condicional), #116 a 025, #117 a 026, #121 a 027 |
| `docs/auditoria/RIESGOS.md` (local, ignorado) | H-2 parcialmente resuelto (producción sin críticos ni altos; residuales moderados hasta el 022); H-3 resuelto |

README: no existe contenido afectado; CHANGELOG no se modificó (no hay uno que el feature requiera).

## Números nuevos de BACKLOG
115 (retirar overrides, 022), 116 (lint +29, 025), 117 (`npm audit` en CI, 026), 118 (imagen Docker con dev deps, 020),
119 (telemetría scarf, 020/024), 120 (`npm ls` invalid, informativo), 121 (timeouts del spec gzip, 027), 122 (audit fix en dos
pasadas, informativo). Los moderados de producción y los altos de desarrollo de `@nestjs/cli` se sumaron a #35 (no duplican).

## No verificable / notas
- Docker no se pudo verificar (#104). `agentUpgrade: false` validado por lectura de código, no con una versión vulnerable.
- `docs/auditoria/RIESGOS.md` está ignorado por git: el cambio es local.
