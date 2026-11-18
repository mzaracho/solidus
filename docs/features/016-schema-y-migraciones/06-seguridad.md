# 016 — Revisión de seguridad

Revisor: seguridad. Fecha: 2026-11-04. Alcance: guardia `-CheckMigrations`, migración SQL, procedimiento de baseline (§9), pista P3009/P3018, `.gitattributes`, archivos nuevos y docs. No se tocó `backend/src`: no hay superficie de API (auth, inyección, CORS, uploads) afectada. No se corrió nada contra la base del usuario.

## Verificaciones ejecutadas
- `scripts\dev-lib.tests.ps1`: 1070 OK, 0 fallidos.
- `.\dev.ps1 -CheckMigrations`: exit 0; después no quedan contenedores `solidus-*` y los volúmenes siguen en 10.
- Búsqueda de secretos/credenciales literales en `scripts/dev-lib.migrations.ps1`, docs del feature, `.vscode/`, `frontend/AGENTS.md`: sin resultados.

## 1. Guardia `-CheckMigrations`: correcto
- Escucha solo en loopback: `-p 127.0.0.1::5432` (puerto efímero); `ConvertFrom-DockerPortOutput` acepta únicamente `127.0.0.1:<puerto>`; `New-ShadowDatabaseUrl` rechaza puertos reservados (5433, 8080) y < 1024.
- Contraseña aleatoria (`New-RandomHex`, 16 bytes), hex validado, no va en la línea de `docker run` (`-e POSTGRES_PASSWORD` sin valor, variable de entorno restaurada en `finally`). Nunca se imprime: `Remove-UrlLines` filtra toda línea con `://`; `Invoke-NativeCapture` descarta stderr.
- Limpieza: `docker rm -f -v` en `finally`; `Stop-Dev` lanza excepción (no `exit`), por lo que el `finally` corre en error; Ctrl+C también dispara `finally` en PowerShell. `--rm` y `--tmpfs` hacen que no haya volumen persistente. `$started` se marca antes de `docker run`, cubriendo fallos a medias.
- Nombre `solidus-migcheck-<hex8>` con etiqueta `solidus.dev=migcheck`: no colisiona con `healthops-gem-db-1` ni con otros del usuario.
- No lee `backend/.env` ni `DATABASE_URL`; la única URL es la de la shadow temporal. Nunca apunta a la base real.

## 2. Migración SQL
- Los únicos `DROP` son la FK `WorkItem_coProfessionalId_fkey` y las columnas `WorkItem.coProfessionalId` y `eventRole`. Según diseño §2.2 y los ensayos, no existen en la base del usuario (por eso el escenario B falla con P3018 y se resuelve con baseline). En una base nueva desde las migraciones antiguas esas columnas sí existían, pero eran de un modelo abandonado y la decisión 1 del PO lo aprueba. Ver MENOR-1.
- No contiene `DELETE`, `TRUNCATE`, grants ni nada que exponga datos.
- Índice único `User_cuit_key`: la columna nace `NULL`, así que no puede fallar por duplicados al crearse (Postgres permite varios NULL). `Payer.cuit` no tiene índice único. Además, en la base del usuario no se ejecuta el SQL. El riesgo es de diseño futuro (ver MENOR-2).
- `amountBase DECIMAL NOT NULL` sin `DEFAULT` fallaría si `WorkItem` tuviera filas al aplicar el SQL en una base con datos que no esté ya alineada (es el caso de bases antiguas, no del usuario). Ver MENOR-1.

## 3. Procedimiento de baseline (§9): correcto
- Sin credenciales en la línea de comandos: `$POSTGRES_USER/$POSTGRES_DB` se expanden dentro del contenedor (comillas simples en PowerShell); Prisma lee `DATABASE_URL` de `backend/.env`.
- Único paso que escribe en la base: `migrate resolve --applied` (una fila en `_prisma_migrations`); el resto es lectura. Precondición explícita (diff exit 0) antes del paso 6, conteos antes/después, reversión documentada y prohibiciones (`reset`, `db push`, `down -v`).
- El respaldo se borra de `/tmp` del contenedor y queda en `.dev/backups/`, ignorado por git (`git check-ignore`: `.gitignore:33 .dev/`). Verificado que el hook pre-commit además rechaza dumps/`.sql` fuera de migraciones.
- ACL de `.dev` restringida (SYSTEM, Administradores, usuario actual); `.dev\backups` hereda esa ACL por herencia (OI)(CI).

## 4. Pista P3009/P3018 en `dev.ps1`: correcta
El texto es fijo y no interpola salida ni URLs. No imprime credenciales.

## 5. `.gitattributes` y contenido
- Reglas `text eol=lf` sobre `migrations/**/*.sql` y `migration_lock.toml`: protegen el checksum de `_prisma_migrations` frente a `core.autocrlf`. Sin riesgo.
- Sin secretos ni datos reales en archivos nuevos y docs (los datos de los ensayos son conteos por tabla; los ids de volumen no son sensibles). `.vscode/settings.json` y `frontend/AGENTS.md` sin datos sensibles. `.claude/settings.json` solo tiene el aviso de EOL (sin diff de contenido relevante para este feature).

## Hallazgos

BLOQUEANTE: ninguno.
MAYOR: ninguno.

MENOR-1 (`backend/prisma/migrations/20261104192244_align_schema_with_migrations/migration.sql`, líneas 12-16): el SQL borra columnas y agrega `amountBase NOT NULL` sin default. Aplicado con `migrate deploy` en una base con `WorkItem` poblados y no alineada, perdería `coProfessionalId/eventRole` o fallaría. Riesgo bajo: la base del usuario recibe baseline, no el SQL. Remediación: documentar en COMANDOS.md (sección "Baseline de migraciones") que en cualquier base con datos que no sea la del usuario primero se hace respaldo y se verifica con el diff; no ejecutar `deploy` ciego.

MENOR-2 (`User_cuit_key`, migration.sql línea 38): el índice único sobre `User.cuit` fallará en una base donde ya existan CUIT duplicados cuando se complete la columna; además un CUIT es dato personal. Remediación: cuando el feature use `cuit`, validar formato y unicidad en el DTO y devolver el error genérico del contrato 013 sin revelar si el CUIT existe; no loguear el valor.

MENOR-3 (`.dev/backups/pre-016.dump`, §9 paso 2): el dump contiene datos de pacientes (PHI) sin cifrar. Está ignorado por git y con ACL restringida, pero queda indefinidamente. Remediación: agregar al procedimiento que el usuario borre el respaldo cuando termine la verificación (o lo mueva a almacenamiento cifrado), y no subirlo a ninguna nube.

MENOR-4 (`scripts/dev-lib.migrations.ps1`, líneas 109-114): la URL de la shadow, con su contraseña aleatoria, queda unos segundos en la línea de comandos de `npx`/`node` visible para otros procesos del mismo equipo. Ya aceptado en diseño §7.1: la base es descartable, solo en loopback y se destruye al terminar. Sin acción, solo se deja constancia.

VEREDICTO: APROBADO

## Re-revisión: agregado -BaselineMigrations (2026-11-18)

Alcance: `Invoke-BaselineMigrations` y helpers (`scripts/dev-lib.migrations.ps1`), parameter set y `Invoke-BaselineMigrationsMode` (`dev.ps1`), tests (`scripts/dev-lib.tests.ps1`: 1133 OK, 0 fallidos, ejecutado). No se ejecutó el comando ni se escribió en la base real.

### Verificado
- Pérdida de datos: el único paso de escritura es `prisma migrate resolve --applied <nombre>` (línea 414). No hay `migrate dev/reset`, `db push`, TRUNCATE, DROP ni `down -v`. La precondición diff = 0 (`Get-BaselineDecision`) se evalúa primero; con deriva (2) o error no se escribe. Sin `-Yes` solo escribe tras teclear exactamente `SI` (`-ceq`); sin consola interactiva y sin `-Yes` cancela. Verificación posterior (status limpio, diff 0, conteos iguales) con pista de reversión `--rolled-back`.
- Respaldo: `.dev/backups/pre-baseline-<yyyyMMdd-HHmmss>.dump`, creado después de la confirmación. `.dev/` ignorado (`.gitignore:33`); además `scripts/secret-scan.ps1` rechaza `.dump` en el pre-commit. ACL restringida en `.dev`, `.dev/backups` y el archivo (`Set-OwnerOnly*Acl`). El dump temporal en `/tmp` del contenedor se borra siempre tras el `docker cp` (éxito o fallo del cp). El respaldo vacío se elimina. Se imprime el recordatorio de borrarlo (datos de pacientes sin cifrar).
- Credenciales: `POSTGRES_USER/DB` se expanden dentro del contenedor (`sh -c` con comillas simples); Prisma lee `backend/.env` sin que el script lo parsee ni lo imprima. Toda salida de Prisma pasa por `Remove-UrlLines` (descarta líneas con `://`); la línea "Datasource ... at host:puerto" no contiene `://` y no lleva usuario ni contraseña (solo nombre de base, schema y host:puerto), aceptable.
- Inyección: los nombres de migración se validan con `^[0-9]{14}_[A-Za-z0-9_]+$` (`-cmatch`) al parsear y otra vez antes de escribir; la ruta del dump sale de un timestamp. Nada externo se interpola en `sh -c`. `Invoke-PrismaCapture` usa operador de llamada con arreglo de argumentos.
- Parámetros de ensayo: `-Container` y `-PrismaEnv` no existen en `dev.ps1`; `Invoke-BaselineMigrationsMode` solo pasa `-RootDir` y `-AssumeYes`. `-Yes` aplica únicamente a los sets Rotate/RotateJwt/ExportCa/BaselineMigrations.
- Docker: `Assert-LocalDockerDaemon` evita un daemon remoto; solo se levanta el servicio `db`.

### Hallazgos
BLOQUEANTE: ninguno.
MAYOR: ninguno.

MENOR-5 (`scripts/dev-lib.migrations.ps1`, líneas 387-388): si `pg_dump` falla, el archivo parcial en `/tmp` del contenedor no se borra (el `rm -f` solo corre después del cp). Remediación: ejecutar `rm -f $tmpRemote` también en la rama de fallo de `pg_dump`. Riesgo bajo (efímero, dentro del contenedor local).

MENOR-6 (líneas 393-395): si `docker cp` falla y deja un archivo parcial en `.dev/backups`, no se elimina (solo se elimina el de tamaño 0, y la ACL aún no se aplicó al archivo, aunque hereda la de la carpeta restringida). Remediación: borrar `$bkFile` en esa rama o aplicar la ACL antes de comprobar el resultado.

MENOR-7 (`10-procedimiento-baseline.md` líneas 91-92): el procedimiento manual nombra `pre-016.dump`, mientras el comando genera `pre-baseline-<timestamp>.dump`. Riesgo de que el usuario no borre el respaldo real. Remediación: indicar `Remove-Item .dev\backups\pre-baseline-*.dump` para el comando automático.

MENOR-8 (líneas 150, 172, 200): en .NET `$` admite un salto de línea final; hoy no es explotable porque las líneas se `Trim()`ean. Remediación opcional: usar `\z` en lugar de `$`.

VEREDICTO: APROBADO
