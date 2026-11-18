# 016 — Testing: schema de Prisma y migraciones alineados

Autor: tester. Fecha: 2026-11-18. No se modificó código de producción ni se hizo commit. No se imprimieron credenciales.

## 1. Pasos ejecutados y códigos de salida

| # | Paso | Resultado |
|---|---|---|
| 0 | `scripts\dev-lib.tests.ps1` (existe) | **1133 OK, 0 fallidos** |
| 1 | `.\dev.ps1 -BaselineMigrations -Yes` sobre la base real | **Código 0.** Estado: solo `20261104192244_align_schema_with_migrations` pendiente; precondición diff = 0; respaldo creado; 17 tablas contadas; `resolve --applied` ("marked as applied"); verificación "Estado limpio, diff 0 y conteos iguales. Baseline OK." |
| 2a | `npx prisma migrate status` | exit 0, "Database schema is up to date!" (9 migraciones) |
| 2b | `.\dev.ps1 -CheckMigrations` | exit 0, "Schema y migraciones coinciden" |
| 2c | Segunda corrida de `-BaselineMigrations -Yes` | exit 0, "nada que hacer (no se escribio nada)"; **no creó otro respaldo** (sigue un único `.dump`) |
| 3a | `.\dev.ps1` | exit 0. Paso de migraciones: "9 migrations found... **No pending migrations to apply**". Backend y frontend respondieron |
| 3b | `.\dev.ps1 -Smoke` (1ª vez) | **exit 7: FALLO el frontend** en 3002 (ver anomalía A); backend y login OK |
| 3c | `.\dev.ps1 -Smoke` (2ª vez, tras reiniciar y esperar ~20 s) | **exit 0: Backend OK - Frontend OK - Login OK** |
| 3d | `.\dev.ps1 -Stop` (dos veces) | exit 0; `healthops-gem-db-1` quedó `Exited (0)` como estaba; sin procesos en 5433, 8080 ni 3002 |
| 4 | Verificación desde cero (ver sección 4) | OK |
| 5 | Calidad (ver sección 5) | OK |

Puerto 3000 ocupado por un proceso ajeno (PID no tocado): `dev.ps1` eligió 3002 para el frontend. El 3001 no se usó. No se mató ningún proceso ajeno.

## 2. Conteos antes y después (base real)

`-BaselineMigrations` comparó los conteos de 17 tablas antes y después: **iguales** (lo informa el propio comando). Verificación independiente posterior (SELECT):
ActivityType 3, Organization 3, Patient 72, Payer 5, Professional 12, User 9, WorkItem 324, WorkItemParticipant 352, WorkItemSplit 676.
Coinciden con los conteos del diseño §2.2 y del ensayo en copias. `_prisma_migrations`: la fila nueva tiene `applied_steps_count = 0` y está terminada; la anterior (`20260422122851_add_professional_status`) sigue intacta.

## 3. Respaldo (NO borrado)

`C:\Repositorios\healthops-gem\.dev\backups\pre-baseline-20261118-123322.dump`, 55549 bytes. Contiene datos de pacientes sin cifrar: lo borra el usuario (`Remove-Item .dev\backups\pre-baseline-20261118-123322.dump`) cuando confirme que todo anda. Nota (MENOR-7 de seguridad): `10-procedimiento-baseline.md` nombra `pre-016.dump`, que no es el nombre real del comando automático.

## 4. Verificación desde cero (criterio 4)

Contenedor `solidus-016-fresh` (`postgres:16.11-alpine`, `--tmpfs`, publicado solo en `127.0.0.1:47615`, credenciales aleatorias efímeras; `DATABASE_URL` solo en el entorno del proceso, no escrita en archivos):
- `prisma migrate deploy`: 9 migraciones aplicadas, "All migrations have been successfully applied", exit 0.
- `prisma migrate status`: "Database schema is up to date!".
- `prisma migrate diff --from-url <descartable> --to-schema-datamodel prisma/schema.prisma --exit-code`: "No difference detected", **exit 0**.
- Consulta Prisma real (datos ficticios): crear `Organization` y `ActivityType` con `baseValue`, `cardValue` y `roles` OK; `User`, `WorkItem` y `WorkItemParticipant` consultables (conteo 0).
- Backend (`nest start`, `PORT=18081`, `JWT_SECRET` aleatorio en el entorno del proceso): `GET /health/liveness` = 200, sin líneas de error. Proceso terminado.
- Limpieza: `docker rm -f -v solidus-016-fresh`; `docker ps -a` solo muestra `healthops-gem-db-1` (Exited); volúmenes 9 antes y 9 después; puerto 47615 sin listeners. No hay tests de integración con Prisma real (Jest usa mocks), por lo que no aplica más.

## 5. Calidad (criterio 8), en `backend/`

| Comando | Resultado |
|---|---|
| `npx prisma validate` | válido, exit 0 |
| `npx prisma generate` | sin errores, exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npm test` | 45 suites, 815 tests, todos en verde |
| `scripts\dev-lib.tests.ps1` | 1133 OK, 0 fallidos |
| `npm run lint` | no se corrió (aplica `--fix`) |

## 6. Criterios de aceptación

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Relevamiento exacto de la deriva (3 comparaciones, lista de diferencias, fuente de verdad) | `03-diseno-tecnico.md` (relevamiento y 15 diferencias, aprobado por PO). Lo ejecutable lo confirman: diff base real vs schema = 0 (precondición del baseline) y `-CheckMigrations` = 0 | Cumple |
| 2 | Fuente de verdad: el schema; sin pérdida de datos; diferencias con datos informadas al PO | Decisión 1 del PO sobre los `DROP` (columnas inexistentes en la base real). Conteos de la base real idénticos tras el baseline | Cumple |
| 3 | Migración nueva generada con `migrate diff`, con `User.cuit`, sin editar las anteriores, aplicable sobre base que ya tiene las columnas | Migración `20261104192244_...` presente y aplicada desde cero (4); `User.cuit` y `User_cuit_key` en el diff 0; baseline con `resolve --applied` funcionó sobre la base real; las 8 anteriores sin cambios en `git status` | Cumple |
| 4 | Verificación desde cero en Postgres descartable | Sección 4: deploy exit 0, diff exit 0, consulta Prisma y backend 200, limpieza verificada | Cumple |
| 5 | Base local: procedimiento documentado y probado en copia; status limpio y conteos sin cambios; confirmación del usuario | Probado en copias A y B (04 §3); documentado (`10-procedimiento-baseline.md`, `-BaselineMigrations`); ejecutado en la base real con autorización escrita del usuario: status "up to date", conteos iguales | Cumple |
| 6 | Guardia que falle si schema y migraciones divergen | `.\dev.ps1 -CheckMigrations`: exit 0 con la migración; 11 sin ella (probado por el desarrollador); tests de dev-lib 1133 OK. Falta la integración con el CI, prevista para el feature 026 | Cumple |
| 7 | `dev.ps1` sigue funcionando tras el baseline | `.\dev.ps1`: "No pending migrations to apply", backend y frontend arriba; `-Smoke` OK (2ª corrida) | Cumple |
| 8 | Calidad | Sección 5 | Cumple |

## 7. Anomalías y bugs

- **A (menor, no bloqueante, de dev.ps1; no se corrigió porque no se toca código de producción).** La primera corrida de `.\dev.ps1 -Smoke`, hecha inmediatamente después de `.\dev.ps1`, falló en "Frontend no responde en el puerto 3002" (exit 7), aunque `dev.ps1` había informado "Frontend responde". Tras detener y volver a iniciar, y con una espera de ~20 s, el `-Smoke` dio OK y `curl` al frontend devolvió 307 en 13 ms. Hipótesis: el frontend dev (Next/Turbopack) con la primera compilación o un reinicio de ventana no estaba listo aún (carrera de arranque). No tiene relación con las migraciones. Para reproducir: `.\dev.ps1` y enseguida `.\dev.ps1 -Smoke`. Sugerencia: darle al smoke un reintento corto para el frontend.
- Menores de la revisión y seguridad (MENOR-1 a 8) siguen sin cambios y no bloquean. MENOR-7 se observó en la práctica (nombre del respaldo distinto del documentado en el procedimiento manual).
- No se encontraron bugs en el schema, las migraciones ni el comando de baseline.

## 8. Qué no se verificó

- Escenario de deriva (código 11) y fallo (código 12) del baseline sobre la base real: no se provocaron. Los cubrió el desarrollador en copias y los tests de dev-lib.
- El procedimiento de restauración del respaldo (no autorizado ni necesario).
- Docker completo (`.\dev.ps1 -Docker`) y el `Dockerfile` (fuera de alcance: BACKLOG #77, feature 020).
- Integración con CI (feature 026).
- `npm run lint` (aplica `--fix`).

## 9. Limpieza hecha

- Contenedor `solidus-016-fresh` y su espacio tmpfs eliminados; sin volúmenes nuevos (9 = 9); archivos temporales solo en el scratchpad (no versionados).
- Backend de prueba (puerto 18081) terminado; entorno de desarrollo detenido con `.\dev.ps1 -Stop` (base en `Exited (0)`, volumen conservado).
- Respaldo `.dev\backups\pre-baseline-20261118-123322.dump` conservado a propósito.
- No se tocaron procesos en los puertos 3000 ni 3001.

VEREDICTO: APROBADO
