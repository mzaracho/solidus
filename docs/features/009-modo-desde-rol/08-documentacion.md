# 08 - Documentación: 009-modo-desde-rol

Autor: documentador. Fecha: 2026-11-04. Sin cambios de código, `.env` ni `.claude/settings*.json`; sin commit ni push.
Fuentes: 00-estado, 01, 03, 04 (con vuelta 1), 05, 06 y 07 (aprobados).

## Qué cambió en el feature (resumen verificable)
`ViewModeGuard` (tercer guard global) resuelve el modo org/pro según los vínculos del usuario; `x-mode` / `?mode=` son
solo una preferencia. Rutas con `@UsesViewMode()`: `GET/POST activity`, `GET dashboard/{kpis,chart,payers}` (ADMIN) y
`GET v1/patients`; los handlers usan `requireViewScope(ctx)`. Modo que no corresponde: 403 sin degradar; valor inválido:
400 `invalid-mode`. `settlements/calculate` y el dashboard en org: solo ADMIN. Frontend: `src/lib/view-mode.ts`.

## Archivos modificados
| Archivo | Cambio |
|---|---|
| `.claude/CLAUDE.md` | Regla 4: modo por `ViewModeGuard` (corrige la frase vieja de `x-mode`), financieros solo ADMIN, "Pendiente" sin el 009. Convención backend (`@UsesViewMode()` / `requireViewScope`). Convención frontend (`view-mode.ts`). Conteo de Jest 13 a 30 suites |
| `docs/auditoria/BACKLOG.md` | #2 y #41 RESUELTOS (feature 009); nueva sección "Candidatos surgidos del feature 009" (#47 a #54) y nota para #12 |
| `docs/auditoria/RIESGOS.md` (local, ignorado por git) | S3, M-2, fila de contexto por headers, BIND_ADDRESS, MENOR-1 e INFO-1 del 007 actualizados; nueva sección "Residuales del feature 009" |
| `docs/auditoria/ARQUITECTURA.md` | Filas de Activity, Dashboard, Patients y Settlements; sección "Contexto de tenant / usuario" reescrita (tres guards globales, `ViewModeGuard`). Se avisa que el resto de la tabla es anterior al 005 y no se revisó |
| `docs/features/009-modo-desde-rol/08-documentacion.md` | Este informe |

`COMANDOS.md` no se tocó: el 009 no agrega comandos ni variables (su conteo de tests, 141, ya estaba viejo desde antes y no se revisó).

## Números nuevos de BACKLOG
| # | Ítem | Origen |
|---|---|---|
| 47 | Menús según el rol de la primera membresía del token | decisión 8 / INFO-3 |
| 48 | `GET fee-rules` filtra por categoría también en org | decisión 9 / INFO-4 |
| 49 | `org/config` abierto a cualquier vínculo (no estaba como ítem) | decisión 11 / INFO-1 del 007 |
| 50 | Orden de deudores en pacientes (pro) mira deuda ajena | MENOR-7 |
| 51 | `MEMBER` ve comisión y montos por atención en org | BAJA-1 seguridad |
| 52 | `POST /activity` puede apuntar a otra organización en el body | BAJA-2 seguridad |
| 53 | `new Error` en la regla de primera carga responde 500 (relacionado con #13) | INFO-2 seguridad |
| 54 | Mover `ownProfessionalsFilter` de `application/` a `domain/` | MENOR-6 / INFO-8 |
Además: nota bajo la tabla, para #12 (whitelist), por el `?mode=` del front (INFO-1 de seguridad).

## Pendientes / avisos
- `ARQUITECTURA.md` conserva información anterior al 005 en otras filas (por ejemplo ProductionController, ReportingController, ProfileController, ProfessionalCategoryController); no se tocó por estar fuera del alcance de este feature.
- El estado de `scripts/dev-lib.tests.ps1` (informe 07, sección de desvíos) sigue por revisar antes del commit.
