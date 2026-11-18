# 016 — Revisión (revisor)

Fecha: 2026-11-04. Entradas: CLAUDE.md, 00-estado, 01-spec, 03-diseno-tecnico (aprobado), 04-implementacion, diff contra dc0b31c.

## Resultados de las verificaciones que corrí
| Verificación | Resultado |
|---|---|
| `npx prisma validate` | Schema válido |
| `npx tsc --noEmit` (backend) | Sin errores |
| `npm test` (backend) | 45 suites, 815 tests, verde |
| `scripts/dev-lib.tests.ps1` | 1070 OK, 0 fallidos |
| `.\dev.ps1 -CheckMigrations` | Exit 0 ("Schema y migraciones coinciden"); sin contenedores `solidus-*` residuales |
| `git diff -- scripts/dev-lib.tests.ps1` | 52 líneas agregadas, 1 modificada (la lista de módulos, que suma `migrations`); no se perdió ninguna aserción |
| Migraciones existentes | Sin cambios (`git status` no las lista); `git ls-files --eol`: `i/lf w/lf attr/text eol=lf` |

## Cumplimiento
- **Migración nueva** (`20261104192244_align_schema_with_migrations/migration.sql`): coincide sentencia por sentencia con el diseño §4.1 (DROP de FK y de `coProfessionalId`/`eventRole`, `ActivityType` x3, `Payer.cuit`, `User.cuit`, `WorkItem` x3, tabla `WorkItemParticipant`, índice `User_cuit_key`, 4 FKs). ASCII, sin BOM, 0 CR, posterior a `20260422122851`. Generada por `migrate diff`, sin edición manual.
- **`.gitattributes`**: reglas correctas para `*.sql` y `migration_lock.toml` (protegen el checksum de `_prisma_migrations` frente a `core.autocrlf`).
- **`dev-lib.migrations.ps1`**: contenedor `--rm`, `--tmpfs`, `127.0.0.1::5432`, sin volúmenes, contraseña por entorno (no en la línea de comandos de docker), puerto validado (rechaza 5433/8080/privilegiados), no lee `DATABASE_URL` ni `backend/.env`, `finally { rm -f -v }`, filtra líneas con `://` de la salida. BOM presente como el resto de módulos. Correcto.
- **`dev.ps1` / `core` / `dev-lib.ps1`**: parameter set `CheckMigrations`, ayuda con código 11, dispatch, `ExitCodeMigrationDrift = 11`, `PostgresImage` igual a la del compose (con test). La pista `'P3009|P3018'` funciona: `Invoke-Native` aplica `-match` sobre las claves de `OutputHints` (dev-lib.core.ps1 líneas 175-178). El código 11 no choca con otro y `Stop-Dev` no restringe el rango.
- **Criterios de la spec**: 1 a 8 cubiertos por el diseño y la implementación; el criterio 5 queda parcial a propósito (falta la confirmación del usuario y la verificación del tester sobre la base real). Sin cambios en `backend/src`, schema, compose ni Dockerfile.

## Hallazgos

### BLOQUEANTE
Ninguno.

### MAYOR
Ninguno.

### MENOR
1. **Procedimiento §9 de 04-implementacion.md, pasos 4-6: las condiciones de parada son solo comentarios.** Si alguien pega el bloque completo, un `diff exit 2` del paso 5 no impide el paso 6 (`resolve --applied`), que registraría como aplicada una migración que no lo está. Sugerencia: antes del paso 6 agregar `if ($LASTEXITCODE -ne 0) { throw 'La base no coincide con el schema: no seguir' }` justo después del diff del paso 5, y un `Read-Host 'Escribi SI para registrar la migracion'` que corte con `return`/`throw` si no hay confirmación. El procedimiento debería marcar el paso 6 como bloque separado, que se ejecuta sólo con la confirmación.
2. **§9 paso 2: el respaldo no aborta si falla.** `pg_dump`/`docker compose cp` no verifican `$LASTEXITCODE`; solo hay una comprobación manual del tamaño. Sugerencia: validar `$LASTEXITCODE -eq 0` tras `pg_dump` y `cp`, y que el `Length` sea > 0 antes de seguir (con `throw`).
3. **§9 paso 1: el `do ... until` no tiene tope de tiempo.** Si el contenedor no arranca, se cuelga. Sugerencia: contador de intentos (por ejemplo 30) y `throw`.
4. **Código de salida 11 ausente de la tabla de COMANDOS.md** (`docs/auditoria/COMANDOS.md`, línea ~48-58; hoy llega hasta 10). Está en la ayuda de `dev.ps1`. Es trabajo del documentador (04 §10 lo anota); no bloquea. También deben existir las secciones "Baseline de migraciones" y "Generar una migración sin migrate dev", que la pista y el mensaje de código 11 nombran: hoy apuntan a un texto inexistente hasta que el documentador entregue. No integrar el commit sin ese documento.
5. **`WorkItem.amountBase` se agrega `NOT NULL` sin `DEFAULT`.** Es lo que genera Prisma y coincide con el schema; en una base armada solo con migraciones viejas y con atenciones la migración falla entera (sin pérdida de datos, transaccional). El PO ya aceptó este escenario (decisión 1) y no hay datos así hoy. Sugerencia: dejarlo documentado en COMANDOS.md para quien tenga una base antigua con filas.
6. **Detalle de la guardia:** `$started = $true` se fija antes de `docker run`; si `docker run` falla se ejecuta igualmente `docker rm -f -v` sobre un nombre inexistente (se ignora el resultado, OK). Sin acción.

### Sugerencias
- Sumar `-CheckMigrations` al CI cuando exista el feature 026 (la spec pedía documentarlo).
- Añadir al procedimiento §9 la línea final `git status` / confirmación de que `.dev/backups/` queda ignorado: verifiqué que `.dev/` está en `.gitignore` (línea 33), por lo que el dump con datos reales no se versiona.

## Procedimiento §9: evaluación
- **Correcto:** pasos coherentes con lo ensayado en copias A y B (status, diff como precondición, resolve, status, diff, conteos). Rutas relativas para `docker cp` bien justificadas. Prisma usa `backend/.env` generado, sin imprimir credenciales.
- **Seguro:** sin `migrate dev/reset`, `db push`, `TRUNCATE`, `DROP` ni `down -v`. Respaldo previo en `.dev/backups` (ignorado). Reversión documentada (`resolve --rolled-back`, que solo toca `_prisma_migrations`).
- **Solo `resolve --applied` escribe** sobre las tablas de Prisma: confirmado. Salvedades de menor importancia: `docker compose up -d db` arranca Postgres (escritura de WAL/arranque normal, sin datos de negocio) y `pg_dump` escribe `/tmp` dentro del contenedor, que se borra. Los pasos 3, 4, 5 y 7 son lecturas.
- Mejoras: ver hallazgos 1 a 3.

VEREDICTO: APROBADO

## Re-revisión: agregado -BaselineMigrations (2026-11-18)

Alcance: `scripts/dev-lib.migrations.ps1` (Invoke-BaselineMigrations y funciones puras), `dev.ps1` (parameter set, modo, ayuda, códigos 11/12, pista `P3009|P3018`), `scripts/dev-lib.tests.ps1`.

Verificado:
- `scripts\dev-lib.tests.ps1`: 1133 OK, 0 fallidos. `.\dev.ps1 -CheckMigrations`: código 0.
- Único paso de escritura: `prisma migrate resolve --applied <m>` por cada migración (nombres validados con `^[0-9]{14}_[A-Za-z0-9_]+$` antes de escribir). Sin `migrate dev`, `reset`, `db push`, TRUNCATE, DROP ni `compose down` (solo `compose up -d db`, que no toca datos).
- Precondición diff 0 (`--from-schema-datasource` vs schema) se evalúa primero: con deriva, código 11 sin escribir; error de diff, código 3.
- Orden del respaldo: confirmación, luego `pg_dump -Fc`, copia al host con ACL de dueño, chequeo de tamaño > 0, conteos antes, y recién ahí el `resolve`. El respaldo sigue estando antes de la única escritura: aceptable, y mejor para no dejar datos de pacientes en disco sin necesidad.
- Sin consola interactiva y sin `-Yes`: cancela sin cambios. Solo vale `SI` exacto.
- Parseo de `migrate status`: el texto real de Prisma 5 ("Following migration(s) have failed:" con singular/plural, y "have not yet been applied") queda cubierto por las regex; las secciones se cortan con línea en blanco.
- Verificación posterior: status limpio y UpToDate, diff 0 y conteos iguales; si falla, código 12 con instrucciones `--rolled-back`. Falla de `resolve` a medias: código 12 con las ya marcadas.
- `$LASTEXITCODE` leído justo tras la pipeline con `ErrorActionPreference=Continue` (stderr como ErrorRecord convertido a texto), correcto en 5.1 y 7. Variables de entorno restauradas. Líneas con `://` filtradas. Rutas con `-LiteralPath`; `docker cp` con ruta relativa y cwd en la raíz.
- Estilo y ayuda consistentes con el resto de dev.ps1 (`-Yes` documentado, códigos 11 y 12 en la ayuda).

Hallazgos BLOQUEANTES: ninguno.

Hallazgos MENORES:
1. `dev-lib.migrations.ps1` ~línea 417-418: si falla el primer `resolve`, `$done` está vacío y `Get-BaselineRollbackHint` produce "…desde backend: ." sin comandos. Sugerencia: si no hay migraciones hechas, decir "no se registró ninguna; no hay nada que revertir" (y conservar el aviso del respaldo).
2. ~línea 383: el nombre del respaldo tiene resolución de segundos; dos corridas en el mismo segundo sobrescribirían el archivo. Riesgo práctico nulo, se puede ignorar o agregar sufijo aleatorio.
3. En el caso de falla en la verificación posterior, el hint de rollback lista todas las migraciones aunque alguna pudiera no haberse marcado; `--rolled-back` sobre una no aplicada puede dar error. Informativo, el mensaje ya aclara que es solo el registro.

VEREDICTO: APROBADO
