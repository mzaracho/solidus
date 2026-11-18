# 016 — Documentación

Autor: documentador. Fecha: 2026-11-18. No se modificó código ni scripts. No se hizo commit.

## Qué cambió realmente
Migración `20261104192244_align_schema_with_migrations` (schema y migraciones alineados, con `User.cuit`), guardia
`.\dev.ps1 -CheckMigrations`, comando `.\dev.ps1 -BaselineMigrations [-Yes]`, códigos de salida 11 y 12, reglas de
`.gitattributes` para las migraciones. No hay README raíz ni CHANGELOG en el repo: no aplican.

## Archivos modificados
| Archivo | Cambio |
|---|---|
| `docs/auditoria/COMANDOS.md` | Flags `-CheckMigrations` y `-BaselineMigrations` en la tabla (y `-Yes` también con baseline); códigos 11 y 12 con el texto de la ayuda de `dev.ps1`; sección 2 ya no recomienda `migrate dev`; secciones nuevas "Baseline de migraciones", "Generar una migración sin migrate dev" (con la advertencia de `--shadow-database-url` y la nota de `docker cp` con rutas relativas) y "Guardia de deriva" (CI pendiente: feature 026) |
| `.claude/CLAUDE.md` | Convención de backend sin `migrate dev`; regla 6 (migración sin `migrate dev`, `prisma generate`, spec, `-CheckMigrations` en 0, baseline); comandos nuevos; códigos de salida 0 a 12; tests de dev-lib (1133). Conteos de Jest (45/815) y frontend (87) sin cambios |
| `docs/features/016-schema-y-migraciones/10-procedimiento-baseline.md` | MENOR-7 de seguridad: "Al terminar" indica también `Remove-Item .dev\backups\pre-baseline-*.dump` para el comando |
| `docs/auditoria/BACKLOG.md` | Sección "Candidatos surgidos del feature 016": resueltos (deriva schema/migraciones y `User.cuit` sin migración) y 10 ítems nuevos, **78 a 87**, prioridad baja |
| `docs/auditoria/RIESGOS.md` | Sección "Residuales del feature 016": respaldos de baseline con datos de pacientes sin cifrar en `.dev/backups`, `User.cuit` como dato personal, migración sobre base antigua con datos, menores de `dev.ps1` |

## BACKLOG nuevos
- 78 hint de rollback vacío si falla el primer `resolve` (revisor 1); 79 nombre del respaldo con resolución de segundos (revisor 2);
  81 hint tras falla de verificación lista migraciones quizá no marcadas (revisor 3).
- 80 `User.cuit` dato personal (seguridad MENOR-2); 82 `pg_dump` parcial en `/tmp` (MENOR-5); 83 `docker cp` parcial en
  `.dev/backups` (MENOR-6); 84 regex con `$` en vez de `\z` (MENOR-8).
- 85 carrera de arranque del frontend en `-Smoke` (tester); 86 ramas no ensayadas en base real (P3018 y salida 12);
  87 `-CheckMigrations` en CI.
- Los menores de `dev.ps1` (78, 79 y 81 a 86) se agrupan en el feature 024-dev-ps1-node-env.
- MENOR-1 de seguridad (migración sobre base antigua con datos) quedó documentado en COMANDOS.md; MENOR-3 (borrar el respaldo) en
  COMANDOS.md, CLAUDE.md y el procedimiento; MENOR-4 es una constancia sin acción.

## Verificado contra
`dev.ps1` (ayuda y códigos 11/12, pista `P3009|P3018` que remite a "Baseline de migraciones"), 04-implementacion.md,
05-revision.md, 06-seguridad.md, 07-testing.md. Sin valores del `.env`.
