# 016 — Implementación: schema de Prisma y migraciones alineados (incluye `User.cuit`)

Autor: desarrollador. Fecha: 2026-11-04. Entrada: `01-spec.md`, `00-estado.md`, `03-diseno-tecnico.md` (aprobado).

**Estado: implementado y verificado en descartables y en copias. El baseline sobre la base REAL del usuario NO se
ejecutó: espera su confirmación (ver "Procedimiento para la base real").**

## 1. Migración nueva

- `backend/prisma/migrations/20261104192244_align_schema_with_migrations/migration.sql` (48 líneas).
- Generada con `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma
  --shadow-database-url <descartable> --script -o <archivo>` (receta del diseño §4.2), sin editar a mano. UTF-8 sin BOM,
  LF (verificado: sin bytes `0xEF 0xBB 0xBF` ni `CR`).
- Contenido: idéntico al SQL del diseño §4.1 (lo mostró también `-CheckMigrations` antes de existir la migración):
  - `DROP` de la FK `WorkItem_coProfessionalId_fkey` y de las columnas `WorkItem.coProfessionalId` y `eventRole`
    (decisión 1 del PO);
  - `ActivityType.baseValue`, `cardValue`, `roles`; `Payer.cuit`; `User.cuit`; `WorkItem.activityTypeId`,
    `amountBase` (NOT NULL) y `amountCard`;
  - tabla `WorkItemParticipant` con PK, índice único `User_cuit_key` y 4 FKs (`Professional_userId_fkey`,
    `WorkItem_activityTypeId_fkey`, `WorkItemParticipant_workItemId_fkey`, `WorkItemParticipant_professionalId_fkey`).
- Las 8 migraciones existentes y `schema.prisma` no se tocaron.

## 2. Verificación desde cero (criterio 4)

Postgres descartable `solidus-fresh-016` (`postgres:16.11-alpine`, `--tmpfs`, `127.0.0.1`, puerto efímero 60056,
contraseña aleatoria no impresa), `DATABASE_URL` solo en el entorno del proceso:

| Paso | Resultado |
|---|---|
| `prisma migrate deploy` | 9 migraciones aplicadas, "All migrations have been successfully applied", exit 0 |
| `prisma migrate status` | "Database schema is up to date!", exit 0 |
| `prisma migrate diff --from-url <descartable> --to-schema-datamodel prisma/schema.prisma --exit-code` | "No difference detected", exit 0 |
| Script `node` de un solo uso (scratchpad, no versionado) con el `PrismaClient` generado, en una transacción | Creó `Organization`, `Payer` (con `cuit`), 2 `Professional`, `ActivityType` (`baseValue`, `cardValue`, `roles`), `WorkItem` (`activityTypeId`, `amountBase`, `amountCard`), 2 `WorkItemParticipant`, 1 `WorkItemSplit` y un `User` con `cuit`; los leyó de vuelta. Datos ficticios |
| Backend (`nest start`) contra esa base, `PORT=18080`, `JWT_SECRET` aleatorio, todo en el entorno del proceso | `GET /health/liveness` → 200. Proceso terminado después |

No hay tests de integración con Prisma real (Jest usa mocks): no aplica más allá de `npm test`.

## 3. Ensayo del baseline sobre copias de la base del usuario (criterio 5)

La base real (`healthops-gem-db-1`) estaba detenida (`Exited (0)`) y no se levantó. Por cada escenario:

1. Volumen `healthops-gem_solidus_postgres_data` montado **solo lectura (`:ro`)** en un contenedor sin red
   (`--network none`) que lo copió con `cp -a` a un volumen descartable (`solidus-copy-016-A` / `-B`).
2. Postgres descartable sobre la copia, `127.0.0.1`, puerto efímero (60076 / 60095), rol de inspección con contraseña
   aleatoria (no impresa; la URL se ocultó en la salida).
3. Pasos del procedimiento sobre la copia. Al final se eliminaron contenedor y volumen.

Conteos por tabla (idénticos antes y después, en A y en B, y coinciden con diseño §2.2):

| Tabla | Antes | Después | | Tabla | Antes | Después |
|---|---|---|---|---|---|---|
| ActivityType | 3 | 3 | | Professional | 12 | 12 |
| FeePreset | 0 | 0 | | ProfessionalCategory | 9 | 9 |
| FeeRule | 0 | 0 | | Role | 2 | 2 |
| Notification | 0 | 0 | | Settlement | 0 | 0 |
| Organization | 3 | 3 | | User | 9 | 9 |
| OrganizationMember | 8 | 8 | | UserRole | 8 | 8 |
| Patient | 72 | 72 | | WorkItem | 324 | 324 |
| Payer | 5 | 5 | | WorkItemParticipant | 352 | 352 |
| | | | | WorkItemSplit | 676 | 676 |

(`_prisma_migrations` se excluye del conteo: gana una fila, que es el efecto esperado.)

**Escenario A (baseline antes de cualquier `deploy`):** `migrate status` exit 1 con solo la migración nueva pendiente ->
diff base vs schema exit 0 ("No difference detected") -> `resolve --applied` exit 0 ("marked as applied") ->
`migrate status` exit 0 ("Database schema is up to date!") -> diff exit 0 -> `migrate deploy` "No pending migrations to
apply" exit 0 -> conteos iguales. `_prisma_migrations`: la nueva queda con `applied_steps_count = 0`, terminada.

**Escenario B (alguien corrió `.\dev.ps1` antes del baseline):** `migrate deploy` falla con **P3018** (`42704:
constraint "WorkItem_coProfessionalId_fkey" ... does not exist`), sin cambios; el segundo `deploy` da **P3009**; diff
base vs schema sigue en 0; el mismo `resolve --applied` la marca como aplicada (la fila fallida queda `rolled_back`);
`status` exit 0; `deploy` no-op; conteos iguales.

Ensayo del respaldo (paso 2 del procedimiento) sobre la copia B: `pg_dump -Fc --no-owner --no-privileges` dentro del
contenedor + `docker cp` a una ruta **relativa** + `pg_restore -l` leyó el dump (18 entradas `TABLE DATA`). Nota: con una
ruta de destino absoluta de Windows (`C:\...`) `docker cp` falla (interpreta la unidad como `contenedor:`); por eso el
procedimiento usa rutas relativas desde la raíz del repo.

## 4. `.\dev.ps1 -CheckMigrations`

- `scripts/dev-lib.migrations.ps1` (nuevo, con BOM como el resto): `Get-MigrationCheckDockerArgs`,
  `ConvertFrom-DockerPortOutput`, `New-ShadowDatabaseUrl`, `Get-MigrationCheckOutcome`, `Remove-UrlLines` e
  `Invoke-CheckMigrations`.
- Flujo: prerrequisitos (Docker, daemon local -> código 8, Prisma instalado -> código 2) -> contenedor
  `solidus-migcheck-<hex8>` (`--rm`, `--tmpfs`, `-p 127.0.0.1::5432`, etiqueta `solidus.dev=migcheck`) -> espera con
  `pg_isready` (60 s) -> `docker port` -> `prisma migrate diff --from-migrations ... --to-schema-datamodel ...
  --shadow-database-url <url> --script --exit-code` (cwd `backend`) -> `finally { docker rm -f -v }`.
- Códigos: 0 coinciden; **11** divergen (muestra el SQL que falta, filtrando líneas con `://`); 3 error de Prisma o del
  contenedor; 2/8 prerrequisitos.
- Desvío menor respecto del diseño: la contraseña **no** va en la línea de comandos de `docker run`. Se pasa con
  `-e POSTGRES_PASSWORD` (sin valor) tomada de la variable de entorno del proceso, que se restaura al terminar. Solo la
  URL de la shadow queda unos segundos en la línea de comandos de `npx` (inevitable, ya previsto en el diseño §7.1).
- No lee `backend/.env` ni `DATABASE_URL` (un test lo vigila).
- Resultados reales: con el árbol sin la migración nueva -> **código 11** y el SQL del diseño §4.1; con la migración ->
  **código 0**. Sin contenedores ni volúmenes residuales después de cada corrida.

## 5. Cambios en archivos

| Archivo | Cambio |
|---|---|
| `backend/prisma/migrations/20261104192244_align_schema_with_migrations/migration.sql` | Nuevo (generado) |
| `.gitattributes` | `backend/prisma/migrations/**/*.sql` y `migration_lock.toml` con `text eol=lf` (`git ls-files --eol`: las 8 anteriores siguen `i/lf w/lf`) |
| `scripts/dev-lib.migrations.ps1` | Nuevo: guardia |
| `scripts/dev-lib.ps1` | Carga el módulo `migrations` y lo documenta |
| `scripts/dev-lib.core.ps1` | `$script:ExitCodeMigrationDrift = 11` y `$script:PostgresImage = 'postgres:16.11-alpine'` |
| `dev.ps1` | Parameter set `CheckMigrations`, ayuda (`.PARAMETER`, código 11), función `Invoke-CheckMigrationsMode`, dispatch y pista `P3009\|P3018` en el paso `prisma migrate deploy` (remite a "Baseline de migraciones" de COMANDOS.md, que escribe el documentador) |
| `scripts/dev-lib.tests.ps1` | 44 aserciones nuevas (1026 -> 1070) (ver §6) y `migrations` en la lista de módulos declarados |

Sin cambios en `backend/src`, `backend/test`, `schema.prisma`, el frontend, `docker-compose.yml` ni `Dockerfile`. No se
tocaron `.claude/`, `.vscode/`, `frontend/AGENTS.md` ni los archivos de backend que solo difieren por EOL.

## 6. Tests

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-lib.tests.ps1` -> **1070 OK, 0 fallidos** (AVG no
bloqueó nada). Nuevos: argumentos de `docker run` (`--rm`, tmpfs, loopback, imagen, sin contraseña ni volúmenes),
parseo de `docker port` (IPv4, IPv6 ignorada, vacío y otra interfaz fallan), URL de la shadow (solo `127.0.0.1`,
rechaza 5433, 8080, privilegiados y contraseñas no hex), resultado 0/2/otro -> 0/11/3, `Remove-UrlLines`,
`PostgresImage` igual a la del compose, `rm -f -v` dentro de un `finally`, sin `DATABASE_URL` ni `backend/.env` en la
guardia, pista `P3009|P3018` y parameter set en `dev.ps1`, regla de `.gitattributes`, y todas las migraciones sin BOM
ni CR.

## 7. Calidad

| Comando (en `backend/`) | Resultado |
|---|---|
| `npx prisma validate` | Schema válido |
| `npx prisma generate` | Sin errores |
| `npx tsc --noEmit` | Sin errores (exit 0) |
| `npm test` | 45 suites, 815 tests, todos en verde |
| `.\dev.ps1 -CheckMigrations` | Exit 0 con la migración; exit 11 sin ella |

## 8. Contenedores y volúmenes

Creados y **eliminados** (todos con `--tmpfs` o volumen propio, `rm -f -v`): `solidus-migcheck-<hex8>` (x2 de
`-CheckMigrations`), `solidus-mig-016` (generación de la migración), `solidus-fresh-016` (desde cero),
`solidus-copy-016-A` y `solidus-copy-016-B` con sus volúmenes `solidus-copy-016-A` y `-B`, y los contenedores efímeros
`--rm` de copia. Al final: sin contenedores `solidus-*`, mismo número de volúmenes que al inicio (10), y
`healthops-gem-db-1` sigue `Exited (0)` sin haberse levantado. El volumen real solo se montó `:ro`.
El volumen anónimo `d9e4e4f6...888a9` del análisis del arquitecto sigue pendiente de borrado por el usuario (no lo creé
ni lo toqué).

## 9. Procedimiento para la base real del usuario (listo para ejecutar con su confirmación)

Desde la raíz del repo, en PowerShell. No imprime credenciales. **Prohibido en todo el procedimiento:** `migrate dev`,
`migrate reset`, `db push`, `TRUNCATE`, `DROP`, `docker compose down -v`. No correr `.\dev.ps1` ni `-Docker` antes del
paso 6 (si ya se corrió, el procedimiento sigue igual: es el escenario B, ensayado).

```powershell
Set-Location C:\Repositorios\healthops-gem

# 1) Levantar solo la base (no escribe datos de negocio)
docker compose up -d db
do { Start-Sleep 2; docker compose exec -T db sh -c 'pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' *> $null } until ($LASTEXITCODE -eq 0)

# 2) Respaldo (lectura). Las variables se expanden DENTRO del contenedor. cp y no ">" (corrompe binarios en PS 5.1)
New-Item -ItemType Directory -Force .dev\backups | Out-Null
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges -f /tmp/pre-016.dump'
docker compose cp db:/tmp/pre-016.dump .dev/backups/pre-016.dump
docker compose exec -T db sh -c 'pg_restore -l /tmp/pre-016.dump | grep -c "TABLE DATA"'   # verificar que el dump se lee
docker compose exec -T db rm -f /tmp/pre-016.dump
(Get-Item .dev\backups\pre-016.dump).Length                                                 # debe ser > 0

# 3) Conteos ANTES (lectura). Guardar la salida
$countSql = @"
select table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name <> '_prisma_migrations' order by 1;
"@
$before = $countSql | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA'
$before

# 4) Estado de migraciones (lectura). Se espera exit 1 y SOLO la migración nueva pendiente
#    (o esa misma como fallida, si ya se corrió .\dev.ps1: escenario B)
Set-Location backend
npx prisma migrate status; "status exit $LASTEXITCODE"

# 5) PRECONDICIÓN: la base coincide con el schema. Tiene que dar exit 0; si da 2, DETENERSE (no hacer el paso 6)
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code; "diff exit $LASTEXITCODE"

# 6) UNICO PASO QUE ESCRIBE: una fila en _prisma_migrations. REQUIERE CONFIRMACION EXPLICITA DEL USUARIO
npx prisma migrate resolve --applied 20261104192244_align_schema_with_migrations

# 7) Verificación: status exit 0 ("up to date"), diff exit 0 y conteos iguales
npx prisma migrate status; "status exit $LASTEXITCODE"
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code; "diff exit $LASTEXITCODE"
Set-Location ..
$after = $countSql | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA'
if (($before -join '|') -eq ($after -join '|')) { 'CONTEOS IGUALES' } else { 'CONTEOS DISTINTOS: no seguir, avisar' }

# 8) Arranque normal: el paso "Migraciones y cliente Prisma" debe decir "No pending migrations to apply"
.\dev.ps1
.\dev.ps1 -Smoke
```

Notas:
- Prisma lee `DATABASE_URL` de `backend/.env` (lo genera `dev.ps1`); no hay que escribir URLs ni credenciales.
- **Reversión del paso 6** (solo toca `_prisma_migrations`): `npx prisma migrate resolve --rolled-back
  20261104192244_align_schema_with_migrations`. Último recurso: restaurar `.dev/backups/pre-016.dump`, que reemplaza la
  base y requiere confirmación aparte.
- El nombre de la migración es el de §1; si se regenerara, cambia el prefijo y hay que actualizar el comando.

## 10. Dudas pendientes

- Confirmación del usuario para el paso 6 (único bloqueante).
- Borrar el volumen anónimo `d9e4e4f6a7e029d0a57e27311f9dee0c4dc3f13e9fad338c015d240915b888a9` (sigue en `00-estado.md`).
- Para el documentador: COMANDOS.md debe tener las secciones "Baseline de migraciones" y "Generar una migración sin
  migrate dev" (la pista de `dev.ps1` y el mensaje de código 11 las nombran), la advertencia de que
  `--shadow-database-url` resetea la base que recibe y que `docker cp` necesita rutas relativas en Windows.

## Agregado: -BaselineMigrations

Pedido del usuario: convertir el procedimiento de `10-procedimiento-baseline.md` en un comando. **No se ejecutó sobre la
base real.** Lo decide el usuario.

### Comportamiento
`.\dev.ps1 -BaselineMigrations [-Yes]` (`Invoke-BaselineMigrations` en `scripts/dev-lib.migrations.ps1`; parameter set
propio; `-Yes` se acepta también en este set). Sirve para cualquier base local armada por fuera de las migraciones.

1. Prerrequisitos: Docker, daemon local (8), Prisma instalado y `backend\.env` presente (2).
2. `docker compose up -d db` y espera con tope de 120 s (3 si no responde).
3. Lectura: `prisma migrate status` (se parsean pendientes y fallidas) y `prisma migrate diff --from-schema-datasource ...
   --to-schema-datamodel ... --exit-code`. Si el status falla sin informar pendientes ni fallidas: 3.
4. **Precondición:** diff distinto de 0 -> aborta **sin escribir**: **11** si la base difiere (muestra el diff), 3 si el diff falla.
5. Sin pendientes ni fallidas y diff 0 -> "nada que hacer", sale 0, sin respaldo ni escritura.
6. Muestra las migraciones que va a marcar y pide escribir exactamente `SI` (sensible a mayúsculas), o `-Yes`. Sin consola
   interactiva y sin `-Yes`: cancela con 0 sin cambiar nada (igual que `ROTAR`).
7. Respaldo `pg_dump -Fc --no-owner --no-privileges` a `.dev/backups/pre-baseline-<yyyyMMdd-HHmmss>.dump` (ruta relativa
   para `docker compose cp`, cwd en la raíz). `.dev`, `.dev/backups` y el archivo con ACL restringida
   (`Set-OwnerOnlyDirectoryAcl` / `Set-OwnerOnlyAcl`). Aborta con 3 si `pg_dump` o la copia fallan o el archivo queda vacío.
8. Conteos por tabla antes (SQL de solo lectura; valida que la salida sea `tabla=entero`).
9. **Único paso que escribe:** `prisma migrate resolve --applied <migración>` por cada pendiente/fallida (nombres
   validados con `^[0-9]{14}_[A-Za-z0-9_]+$` antes de pasarlos a `npx`). Si falla: **12** con la pista de `--rolled-back`.
10. Verificación: `status` limpio (exit 0, "up to date", sin pendientes), diff 0 y conteos iguales. Si algo no coincide:
    **12**, indica `npx prisma migrate resolve --rolled-back <migración>` por cada una y la ruta del respaldo.
11. Al final recuerda borrar el respaldo (contiene datos de pacientes).

No imprime credenciales ni URLs (toda salida de Prisma pasa por `Remove-UrlLines`; también se descartan las líneas
`npm notice`). Sí aparece la línea `Datasource "db": ... at "host:puerto"` de Prisma (sin credenciales). No usa
`migrate dev`, `reset`, `db push`, `TRUNCATE`, `DROP` ni `down -v` (un test lo vigila sobre el código fuente).

Desvío del procedimiento manual: el respaldo y los conteos se hacen **después** de la confirmación y no antes del estado,
para no dejar un dump con datos de pacientes en disco cuando no hay nada que hacer o la precondición falla. El respaldo
sigue existiendo antes de la única escritura.

La pista `P3009|P3018` de `dev.ps1` ahora remite a `.\dev.ps1 -BaselineMigrations`.

Parámetros internos para ensayar sobre una copia (no expuestos en `dev.ps1`): `-Container` (contenedor de la base en
lugar del servicio `db` de compose) y `-PrismaEnv` (variables solo del proceso de Prisma, p. ej. `DATABASE_URL`).

### Códigos de salida
0 OK, nada que hacer o cancelado; 2 prerrequisito; 3 error de base, de Prisma, de respaldo o de lectura; 8 Docker remoto;
**11** la base no coincide con `schema.prisma` (reutilizado, sin escribir); **12 (nuevo)** el baseline quedó a medias o no
verificó. Documentados en la ayuda de `dev.ps1` (`.PARAMETER BaselineMigrations`, lista de códigos).

### Tests
`scripts/dev-lib.tests.ps1`: **1133 OK, 0 fallidos** (antes 1070). 63 aserciones nuevas: parseo de `migrate status` (una o
dos pendientes, fallida, up to date, nombres inválidos, nulo), decisión según diff/pendientes (Resolve, NothingToDo, Drift
11, Error 3, fallidas y pendientes sin repetir), confirmación (solo `SI`; rechaza `si`, `yes`, espacios, vacío, nulo),
validación de nombres de migración, nombre del respaldo, comparación y validación de conteos, SQL de conteo de solo
lectura, pista de reversión, y chequeos estáticos (sin `dev`/`reset`/`push`/`TRUNCATE`/`DROP`/`down`, un único `resolve`,
sin `DATABASE_URL` ni lectura de `.env`, ACL del respaldo, parameter set, despacho, `-Yes` y pista P3009/P3018).
`.\dev.ps1 -CheckMigrations` sigue en 0. No se tocó el backend (`tsc`/`npm test` no aplican).

### Ensayo sobre una COPIA de la base del usuario
Con el stack detenido (`healthops-gem-db-1` `Exited (0)`, no se levantó): volumen `healthops-gem_solidus_postgres_data`
montado `:ro` en un contenedor `--network none` que lo copió con `cp -a` al volumen `solidus-copy-016-bl`; Postgres
descartable `solidus-copy-016-bl` sobre la copia (127.0.0.1, puerto efímero, contraseña aleatoria puesta con `ALTER ROLE` en
la copia y pasada solo por `DATABASE_URL` del proceso de Prisma, no impresa). Se corrió `Invoke-BaselineMigrations`
completo (`-Container`, `-PrismaEnv`, `-AssumeYes`) contra la raíz real del repo.

| Escenario | Resultado |
|---|---|
| 1. Copia sin baseline | status: solo `20261104192244_align_schema_with_migrations` pendiente; diff 0; marcada; respaldo de 55 549 bytes; status "up to date", diff 0; **conteos iguales** (17 tablas); exit 0 |
| 2. Segunda corrida | "nada que hacer", sin respaldo ni escritura; exit 0 |
| 3. Deriva forzada (columna extra en la copia) | diff 2: "La base NO coincide...", sin escribir; **exit 11** |

Conteos (antes = después): ActivityType 3, FeePreset 0, FeeRule 0, Notification 0, Organization 3, OrganizationMember 8,
Patient 72, Payer 5, Professional 12, ProfessionalCategory 9, Role 2, Settlement 0, User 9, UserRole 8, WorkItem 324,
WorkItemParticipant 352, WorkItemSplit 676. Coinciden con el ensayo anterior.

No se ensayaron en esta pasada la rama 12 ni el caso de migración fallida (P3018, cubierto por el escenario B de la sección
3 con el procedimiento manual; el parseo de "have failed" se cubre con tests de funciones puras).

### Contenedores, volúmenes y archivos creados y eliminados
- Contenedor `solidus-copy-016-bl` y volumen `solidus-copy-016-bl`: **eliminados** (`rm -f -v`, `volume rm`), más el
  contenedor `--rm` de copia y los contenedores `solidus-migcheck-*` de `-CheckMigrations`. Al final solo queda
  `healthops-gem-db-1` (`Exited (0)`), sin tocar. Volúmenes: 9 (no creé ni toqué ninguno más).
- El respaldo del ensayo (`.dev/backups/pre-baseline-20261118-122838.dump`, datos de la copia) se **borró**.
- Los scripts auxiliares del ensayo viven en el scratchpad de la sesión, no en el repo.
