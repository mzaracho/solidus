# 09 — Cierre: 016-schema-y-migraciones

Fecha: 2026-11-18. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, sin vueltas de corrección (0 de 3). El agregado `-BaselineMigrations`, que pidió el
usuario después de la primera aprobación, se revisó de nuevo en forma acotada.

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI | — | Omitida |
| Arquitecto | 03-diseno-tecnico.md | APROBADO. 15 diferencias entre las migraciones y el schema; la base del usuario ya coincidía con el schema |
| Desarrollador | 04-implementacion.md | Completo (migración, `-CheckMigrations` y `-BaselineMigrations`) |
| Revisor | 05-revision.md | APROBADO dos veces: el feature y el agregado (3 menores) |
| Seguridad | 06-seguridad.md | APROBADO dos veces: el feature y el agregado (MENOR-5 a MENOR-8) |
| Tester | 07-testing.md | APROBADO; ejecutó el baseline en la base real con autorización del usuario |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **Migración `20261104192244_align_schema_with_migrations`:**
  - generada con `prisma migrate diff`, sin editar las 8 anteriores;
  - incluye `WorkItemParticipant`, `WorkItem.activityTypeId`, los montos de `WorkItem`, las columnas de `ActivityType`,
    `Payer.cuit`, la FK `Professional.userId` y `User.cuit`;
  - quita `coProfessionalId` y `eventRole`, que no existían en la base del usuario.
- **`.\dev.ps1 -CheckMigrations`:** la guardia de deriva. Sale con código 11 si las migraciones no reproducen el schema.
- **`.\dev.ps1 -BaselineMigrations [-Yes]`:** regulariza cualquier base armada por fuera de las migraciones. Hace en
  orden:
  1. verifica que la base coincide con el schema (si no, sale con 11 sin escribir);
  2. pide confirmación;
  3. hace el respaldo con ACL restringida;
  4. toma los conteos;
  5. ejecuta `resolve --applied`;
  6. verifica el resultado (si queda a medias, sale con el código nuevo 12).
- **La pista P3009/P3018 de `dev.ps1`** remite al comando nuevo.
- **`.gitattributes`:** fija `eol=lf` en las migraciones.
- **Tests:** dev-lib con 1133 OK; backend con 45 suites y 815 tests, sin cambios.
- **Base del usuario:**
  - el baseline se ejecutó el 2026-11-18;
  - `migrate status` quedó "up to date" y `-CheckMigrations` da 0;
  - los conteos de las 17 tablas no cambiaron;
  - `.\dev.ps1` y `-Smoke` dan OK.
- **Documentación:**
  - COMANDOS: "Baseline de migraciones", "Generar una migración sin migrate dev", "Guardia de deriva" y los códigos
    11 y 12;
  - `CLAUDE.md`: regla 6, la convención de backend, comandos y códigos de 0 a 12;
  - BACKLOG: #78 a #87;
  - RIESGOS;
  - procedimiento manual (`10-procedimiento-baseline.md`).

## Verificación de los criterios (PO)
| Criterios | Estado |
|---|---|
| 1, 2 | Cumplen: relevamiento en 03 y diff 0 entre la base real y el schema. No se perdieron datos: los conteos son iguales |
| 3 | Cumple: migración generada con `migrate diff`, con `User.cuit`, y las 8 anteriores sin cambios |
| 4 | Cumple: en un Postgres descartable, `deploy` y diff dan 0, el backend responde 200 y el contenedor se eliminó |
| 5 | Cumple: ensayado en copias, documentado y ejecutado en la base real con autorización escrita del usuario |
| 6 | Cumple: `-CheckMigrations` da 0 o 11. La integración con el CI queda en el #87 (feature 026) |
| 7 | Cumple: `.\dev.ps1` informa "No pending migrations" y `-Smoke` da OK |
| 8 | Cumple: `validate`, `generate`, `tsc`, `npm test` y dev-lib en verde |

## Pendiente
- **El usuario** borra `.dev\backups\pre-baseline-20261118-123322.dump` cuando confirme que todo anda. Tiene datos de
  pacientes sin cifrar.
- **BACKLOG #78, #79 y #81 a #86** son menores de `dev.ps1` y van al feature 024:
  - hints de rollback;
  - respaldos parciales;
  - regex con `$`;
  - la carrera de arranque del frontend en `-Smoke`;
  - las ramas P3018 y de código 12, que no se ensayaron sobre una base real.
- **#80:** `User.cuit` como dato personal.
- **#87:** `-CheckMigrations` en el CI (026).
- **#77:** el Dockerfile corre `migrate deploy` con `;` (020).

## Pasos omitidos
UX/UI, porque no hay interfaz de usuario.
