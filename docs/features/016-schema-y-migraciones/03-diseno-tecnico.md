# 016 — Diseño técnico: schema de Prisma y migraciones alineados (incluye `User.cuit`)

Autor: arquitecto. Fecha: 2026-11-04. Entrada: `01-spec.md`, hallazgo 6 de `015-transacciones/00-estado.md`.

## 1. Resumen

- **La base local del usuario ya coincide exactamente con `schema.prisma`** (`migrate diff` entre una copia de la base
  y el schema: vacío). La deriva está solo entre las **migraciones versionadas** y el schema.
- Las columnas que el schema no tiene (`WorkItem.coProfessionalId` y `WorkItem.eventRole`) **no existen en la base
  local**: no hay datos en juego.
- Solución: **una migración nueva**, generada con `prisma migrate diff --from-migrations ... --to-schema-datamodel ...`,
  sin editar las 8 existentes. En la base del usuario se registra como aplicada con
  `prisma migrate resolve --applied` (baseline), con confirmación del usuario. El procedimiento ya se probó en dos
  copias de la base.
- Guardia: nuevo `.\dev.ps1 -CheckMigrations`, que levanta un Postgres descartable en memoria (`--tmpfs`) en
  `127.0.0.1` con un puerto efímero, corre `migrate diff --exit-code` y lo elimina. Sale con código 11 si hay deriva.
  El CI del feature 026 corre el mismo comando de Prisma contra un servicio Postgres.
- Sin cambios en el modelo, en el código del backend ni en el frontend.

## 2. Relevamiento (criterio 1)

### 2.1 Método (solo lectura sobre la base del usuario)

| Comparación | Comando | Dónde |
|---|---|---|
| (a) → (b) migraciones vs schema | `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <descartable> --script` | Contenedor `solidus-shadow-016` |
| (c) → (b) base local vs schema | `prisma migrate diff --from-url <copia> --to-schema-datamodel prisma/schema.prisma --script` | Copia de la base |
| (a) → (c) migraciones vs base local | `prisma migrate diff --from-migrations ... --to-url <copia> --shadow-database-url <descartable> --script` | Copia + shadow |
| Historial | `SELECT` sobre `_prisma_migrations` y comparación de checksums con los archivos | Copia |
| Datos | `SELECT count(*)` por tabla y conteos puntuales | Copia |

**Cómo se obtuvo la copia sin tocar la base del usuario:** el contenedor `healthops-gem-db-1` estaba **detenido**
(apagado limpio, `Exited (0)`). No se levantó. El volumen `healthops-gem_solidus_postgres_data` se montó **solo
lectura** (`:ro`) en un contenedor efímero sin red, que lo copió con `cp -a` a un volumen descartable. Sobre esa copia
corrió un Postgres en `127.0.0.1` y se creó un rol de inspección con una contraseña aleatoria. Es equivalente a un
`pg_dump` y ni siquiera requiere que la base original esté levantada. El camino con `pg_dump` + `pg_restore` también
se probó (§5.2) y deja los mismos conteos y el mismo schema.

`npx prisma validate` (Prisma 5.22.0): **schema válido**.

### 2.2 Tabla de diferencias

Leyenda: ✔ = existe, ✘ = no existe. La columna (c) es la base local del usuario (vista en la copia).

| # | Objeto | (a) Migraciones | (b) Schema | (c) Base local | Decisión (fuente de verdad) | ¿Datos en juego? |
|---|---|---|---|---|---|---|
| 1 | Tabla `WorkItemParticipant` (id, workItemId, professionalId, roleLabel, feeAmount `DECIMAL(10,2)`, isRequired default true, createdAt) + PK | ✘ | ✔ | ✔ | Schema | No: se crea. En la base local ya existe, con 352 filas que no se tocan (baseline) |
| 2 | FK `WorkItemParticipant_workItemId_fkey` → `WorkItem` `ON DELETE CASCADE` | ✘ | ✔ | ✔ | Schema | No |
| 3 | FK `WorkItemParticipant_professionalId_fkey` → `Professional` `ON DELETE RESTRICT` | ✘ | ✔ | ✔ | Schema | No |
| 4 | `WorkItem.activityTypeId UUID NULL` + FK `WorkItem_activityTypeId_fkey` → `ActivityType` `ON DELETE SET NULL` | ✘ | ✔ | ✔ | Schema | No |
| 5 | `WorkItem.amountBase DECIMAL(10,2) NOT NULL` (sin default) | ✘ | ✔ | ✔ | Schema | No en la base local. En una base armada solo con migraciones **y con atenciones** la migración falla entera (ver §4.3) |
| 6 | `WorkItem.amountCard DECIMAL(10,2) NULL` | ✘ | ✔ | ✔ | Schema | No |
| 7 | `WorkItem.coProfessionalId UUID` + FK `WorkItem_coProfessionalId_fkey` (`SET NULL`) | ✔ (`20260218175457`) | ✘ | ✘ | Schema (se borra) | **No en la base local**: la columna no existe. El código no la usa como columna (`coProfessionalId` en `find-activity-by-id-query.ts` es un campo calculado a partir de los splits) |
| 8 | `WorkItem.eventRole TEXT NOT NULL DEFAULT 'TITULAR'` | ✔ (`init_uuid`) | ✘ | ✘ | Schema (se borra) | **No en la base local**. El código usa `eventRole` solo en el contexto del motor de honorarios, en memoria. `defaultEventRole` vive en el JSON `Organization.settings` |
| 9 | `ActivityType.baseValue DECIMAL(10,2) NULL` | ✘ | ✔ | ✔ | Schema | No |
| 10 | `ActivityType.cardValue DECIMAL(10,2) NULL` | ✘ | ✔ | ✔ | Schema | No |
| 11 | `ActivityType.roles JSONB NULL` | ✘ | ✔ | ✔ | Schema | No |
| 12 | `Payer.cuit TEXT NULL` | ✘ | ✔ | ✔ | Schema | No (no estaba en el hallazgo del 015) |
| 13 | `User.cuit TEXT NULL` | ✘ | ✔ | ✔ | Schema (pendiente del 004) | No. En la base local 1 usuario tiene CUIT; el índice único ya existe |
| 14 | Índice único `User_cuit_key` | ✘ | ✔ | ✔ | Schema | No |
| 15 | FK `Professional_userId_fkey` → `User` `ON DELETE SET NULL` | ✘ | ✔ | ✔ | Schema | No. No estaba en el hallazgo del 015. En la base local no hay `Professional.userId` huérfanos (0) |

**Sin diferencias** en enums (los 7 coinciden, incluido `PaymentStatus` con `PAID`), en las demás tablas, columnas,
tipos, defaults, índices (incluido el compuesto de `FeeRule`) ni en las demás FKs y sus `ON DELETE`.

**Otros hallazgos sobre (c):**
- `migrate diff` de (c) contra (b): **vacío**. No hay tablas, vistas, triggers ni funciones extra en `public`, y la
  única extensión es `plpgsql`.
- `_prisma_migrations` tiene las 8 migraciones terminadas y ninguna fallida ni revertida. Los checksums coinciden con
  los archivos actuales. Las 6 primeras tienen `applied_steps_count = 0`, que es la marca de
  `migrate resolve --applied`: **la base ya se "baselineó" una vez** después de armarse por otro camino (coincide con la
  hipótesis del `db push`). Las 2 últimas se aplicaron con `migrate deploy`.
- Conteos (los que se deben conservar): ActivityType 3, FeePreset 0, FeeRule 0, Notification 0, Organization 3,
  OrganizationMember 8, Patient 72, Payer 5, Professional 12, ProfessionalCategory 9, Role 2, Settlement 0, User 9,
  UserRole 8, WorkItem 324, WorkItemParticipant 352, WorkItemSplit 676. Todas las atenciones tienen `activityTypeId` y
  al menos un participante.
- Las líneas de los archivos de migración están en LF en el índice y en el working tree, aunque
  `core.autocrlf=true` (ver §4.4).

## 3. Fuente de verdad (criterio 2)

Para las 15 diferencias, la fuente de verdad es `schema.prisma`, que es lo que usa el código y lo que ya tiene la base
local. No hay diferencias en las que la base local tenga algo que el schema no tenga. Las dos columnas que se borran
(filas 7 y 8) solo existen en bases armadas exclusivamente con las migraciones viejas (§9, aclaración 1). En la base
del usuario no se pierde ningún dato, porque la migración **no se ejecuta** ahí: se registra como aplicada.

## 4. Migración nueva (criterio 3)

### 4.1 Nombre y contenido

Nombre: `<YYYYMMDDHHMMSS>_align_schema_with_migrations`, con la marca de tiempo UTC del momento de generarla (tiene que
ser posterior a `20260422122851`). Contenido: exactamente la salida de `migrate diff` (a → b). Esta es la salida que
se obtuvo en el análisis. El desarrollador la regenera y tiene que coincidir:

```sql
-- DropForeignKey
ALTER TABLE "WorkItem" DROP CONSTRAINT "WorkItem_coProfessionalId_fkey";

-- AlterTable
ALTER TABLE "ActivityType" ADD COLUMN     "baseValue" DECIMAL(10,2),
ADD COLUMN     "cardValue" DECIMAL(10,2),
ADD COLUMN     "roles" JSONB;

-- AlterTable
ALTER TABLE "Payer" ADD COLUMN     "cuit" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cuit" TEXT;

-- AlterTable
ALTER TABLE "WorkItem" DROP COLUMN "coProfessionalId",
DROP COLUMN "eventRole",
ADD COLUMN     "activityTypeId" UUID,
ADD COLUMN     "amountBase" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "amountCard" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "WorkItemParticipant" ( ... 7 columnas ..., CONSTRAINT "WorkItemParticipant_pkey" PRIMARY KEY ("id") );

-- CreateIndex
CREATE UNIQUE INDEX "User_cuit_key" ON "User"("cuit");

-- AddForeignKey (4)
--   Professional_userId_fkey           -> User          ON DELETE SET NULL  ON UPDATE CASCADE
--   WorkItem_activityTypeId_fkey       -> ActivityType  ON DELETE SET NULL  ON UPDATE CASCADE
--   WorkItemParticipant_workItemId_fkey     -> WorkItem      ON DELETE CASCADE   ON UPDATE CASCADE
--   WorkItemParticipant_professionalId_fkey -> Professional  ON DELETE RESTRICT  ON UPDATE CASCADE
```

**No se edita a mano.** Si se le agregan comentarios, se agregan **antes** de hacer el baseline en la base del
usuario, porque el checksum se calcula sobre el archivo final. Se recomienda no tocarlo.

### 4.2 Cómo generarla (desarrollador, PowerShell, desde `backend/`)

Nunca contra la base del usuario. `--shadow-database-url` **resetea** la base que recibe: solo puede apuntar a un
Postgres descartable.

```powershell
$name = 'solidus-mig-016'
$pw = [guid]::NewGuid().ToString('N')            # aleatoria, no se imprime
docker run -d --rm --name $name --tmpfs /var/lib/postgresql/data -p 127.0.0.1::5432 -e "POSTGRES_PASSWORD=$pw" postgres:16.11-alpine | Out-Null
try {
  do { Start-Sleep 1; docker exec $name pg_isready -h 127.0.0.1 -U postgres *> $null } until ($LASTEXITCODE -eq 0)
  $port = ((docker port $name 5432/tcp) | Select-Object -First 1).Split(':')[-1]
  $tmp = Join-Path $env:TEMP 'align_schema.sql'
  npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma `
    --shadow-database-url "postgresql://postgres:$pw@127.0.0.1:$port/postgres" --script -o $tmp
} finally { docker rm -f -v $name | Out-Null }
$ts = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
$dir = New-Item -ItemType Directory "prisma/migrations/${ts}_align_schema_with_migrations"
Move-Item $tmp (Join-Path $dir 'migration.sql')
```

- `-o` en lugar de `>`: en Windows PowerShell 5.1, `>` escribe UTF-16 y la migración quedaría ilegible para Postgres.
- La carpeta se crea **después** de generar: si existiera vacía dentro de `prisma/migrations`, `--from-migrations`
  fallaría.
- `--tmpfs` y `docker rm -v`: no queda ningún volumen anónimo (ver §10).
- Una vez implementado, el paso 2 del plan (`-CheckMigrations`) tiene que dar 0 con la migración nueva.

### 4.3 Por qué no se editan las existentes y qué pasa al aplicarla

- Editar una migración aplicada cambia su checksum: `migrate dev` lo detecta como "modified after applied" y propone
  **resetear** la base. Además, las instalaciones que ya la aplicaron no se enteran del cambio. Por eso se agrega una
  migración nueva.
- **Atomicidad (probado):** Prisma manda el script como un único lote y Postgres lo ejecuta en una transacción
  implícita. En una base armada solo con las 8 migraciones y con una atención con `coProfessionalId` cargado, el
  `deploy` falló en `amountBase NOT NULL` (23502) y **no cambió nada**: `coProfessionalId` y `eventRole` siguieron con
  sus datos y no se creó `WorkItemParticipant`. Es decir, en esas bases la migración falla entera en lugar de perder
  datos. No hay bases así en este proyecto (aclaración 1).
- Sobre una base vacía (instalación nueva), `migrate deploy` de las 9 migraciones funciona, y el diff contra el schema
  da vacío (§8.1, ya probado).

### 4.4 Finales de línea (checksum estable)

`core.autocrlf=true` en este equipo. Si la migración llegara al working tree con CRLF, el checksum registrado por
`resolve --applied` no coincidiría con el de un clon con LF. `migrate dev` lo vería como migración modificada y
propondría resetear. Para evitarlo, se agrega a `.gitattributes`:

```
backend/prisma/migrations/**/*.sql text eol=lf
backend/prisma/migrations/migration_lock.toml text eol=lf
```

Es una sola regla, consistente con las que ya existen para `*.sh` y `.githooks/*`. Las 8 migraciones actuales ya
están en LF, así que la regla no cambia sus checksums.

## 5. Base local del usuario: baseline (criterio 5)

### 5.1 Técnica elegida: `prisma migrate resolve --applied`

La base ya tiene todo lo que crea la migración. `resolve --applied` solo inserta una fila en `_prisma_migrations`
(`applied_steps_count = 0`), sin ejecutar el SQL. Es la misma técnica con la que ya se registraron las 6 primeras.

**Precondición obligatoria:** `migrate diff` entre la base y el schema tiene que dar **vacío** (`--exit-code` = 0). Si
da 2, la base no coincide con el schema: el baseline está prohibido y se vuelve al arquitecto.

### 5.2 Ensayo en copia (probado en este análisis; lo repite el tester)

| Escenario | Pasos | Resultado observado |
|---|---|---|
| A. Baseline antes del próximo arranque | `migrate status` → `resolve --applied` → `status` → `deploy` → diff → conteos | `status` exit 1 (solo la nueva pendiente) → "marked as applied" → `status` "up to date" (exit 0) → `deploy` "No pending migrations" → diff vacío → **conteos idénticos** |
| B. Alguien corre `.\dev.ps1` (o `-Docker`) antes del baseline | `deploy` → diff → `deploy` → `resolve --applied` → `status` → `deploy` → conteos | `deploy` falla: `42704 constraint "WorkItem_coProfessionalId_fkey" ... does not exist`, sin cambios en el schema. El siguiente `deploy` da **P3009** (migración fallida registrada). `resolve --applied` la marca como aplicada (la fila fallida queda como `rolled_back`) → `status` "up to date" → `deploy` no-op → **conteos idénticos** |
| Copia vía `pg_dump` | `pg_dump -Fc --no-owner --no-privileges` de la copia → `pg_restore` en una base descartable | Conteos idénticos, `migrate status` "up to date", diff vacío |

Conclusión: en los dos órdenes posibles, el mismo comando deja la base limpia sin tocar datos. El escenario B no es
destructivo: el error es en la primera sentencia y la transacción se revierte.

### 5.3 Procedimiento para la base real (lo documenta el documentador en COMANDOS.md)

Desde la raíz (PowerShell). Ningún paso imprime credenciales. `backend/.env` ya trae `DATABASE_URL`, así que se usa
`--from-schema-datasource` y no hace falta manejar URLs a mano.

| Paso | Comando | Escribe en la base del usuario | Confirmación |
|---|---|---|---|
| 0 | No correr `.\dev.ps1` ni `-Docker` entre el pull o la creación de la migración y el paso 6. Si se corrió, igual se sigue: es el escenario B | No | — |
| 1 | `docker compose up -d db` y esperar a que acepte conexiones (`.\dev.ps1 -Stop` no hace falta) | No (solo arranca el servicio) | — |
| 2 | **Respaldo:** `docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges -f /tmp/pre-016.dump'`, después `docker compose cp db:/tmp/pre-016.dump .dev/backups/pre-016.dump` y `docker compose exec -T db rm -f /tmp/pre-016.dump`. Las variables se expanden **dentro** del contenedor (comillas simples). `.dev/` y `*.dump` están en `.gitignore`. Se usa `cp` y no la redirección `>` de PowerShell, que corrompería el binario | No (lectura; el archivo temporal queda fuera de la base) | — |
| 3 | **Ensayo en copia:** restaurar `pre-016.dump` en un Postgres descartable (`--tmpfs`, `127.0.0.1::5432`) y correr ahí los pasos 4 a 7 con `DATABASE_URL` apuntando a la copia (desde una carpeta sin `.env`, con `--schema` explícito, como en este análisis) | No | — |
| 4 | `cd backend` · `npx prisma migrate status` → se espera exit 1 y **solo** la migración nueva pendiente (o, en el escenario B, esa misma como fallida) | No | — |
| 5 | `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` → **tiene que dar 0**. Conteos por tabla antes (la consulta de `Get-DatabaseRowCount`, desglosada por tabla) | No | — |
| 6 | `npx prisma migrate resolve --applied <YYYYMMDDHHMMSS>_align_schema_with_migrations` | **Sí: una fila en `_prisma_migrations`** | **Requiere confirmación explícita del usuario** |
| 7 | `npx prisma migrate status` → exit 0 "up to date". Repetir el diff del paso 5 (exit 0) y los conteos (iguales al paso 5) | No | — |
| 8 | `.\dev.ps1` → el paso "Migraciones y cliente Prisma" dice "No pending migrations". `.\dev.ps1 -Smoke` en verde | No (deploy no-op) | — |

**Si algo sale mal en el paso 6** (no debería: solo inserta una fila), la reversión es
`npx prisma migrate resolve --rolled-back <nombre>`, que también solo toca `_prisma_migrations`. Como último recurso
queda `pre-016.dump`, y restaurarlo **también requiere confirmación** porque reemplaza la base.

**Prohibido en todo el procedimiento:** `migrate dev`, `migrate reset`, `db push`, `TRUNCATE`, `DROP`,
`docker compose down -v` y usar la base del usuario como `--shadow-database-url`.

## 6. `dev.ps1` y Docker (criterio 7)

Dónde se corre `migrate deploy` hoy:
- **Modo desarrollo (`.\dev.ps1`)**: sí, en `Invoke-DevMode`. Si falla, sale con código 3.
- **`-Init`**: **no** corre migraciones (solo `.env`, permisos, hook y `compose config`).
- **`-Docker`**: el `CMD` de `backend/Dockerfile` corre `npx prisma migrate deploy; npm run start:prod`. Con `;`, si
  el deploy falla el backend **arranca igual**.
- `-Smoke`, `-Seed` y las rotaciones no corren migraciones.

| Momento | Modo desarrollo | `-Docker` |
|---|---|---|
| Base del usuario **antes** del baseline, con la migración nueva en el árbol | `migrate deploy` falla (42704 / P3018), código 3, nada cambia en la base. Con la pista nueva (abajo) indica el procedimiento | El deploy falla y deja la migración como fallida (P3009 en los arranques siguientes). El backend arranca igual porque el schema real ya es el correcto. Se recupera con el mismo `resolve --applied` (escenario B, probado) |
| **Después** del baseline | Deploy no-op, sigue normal | Deploy no-op, sigue normal |
| Instalación nueva (volumen vacío) | Las 9 migraciones crean el schema completo | Ídem |

**Cambio en `dev.ps1`:** al paso de `prisma migrate deploy` se le agrega una entrada a `-OutputHints`, con el patrón
existente (hoy solo tiene `P1000`): `'P3009|P3018'` → "La base ya tiene cambios que una migración intenta crear, o
quedó una migración fallida. No uses migrate reset ni migrate dev: seguí 'Baseline de migraciones' en
docs/auditoria/COMANDOS.md". No se automatiza el `resolve`: escribe en la base del usuario y requiere su
confirmación (spec, criterio 5).

## 7. Guardia contra divergencia futura (criterio 6)

### 7.1 `.\dev.ps1 -CheckMigrations` (local, requiere Docker)

Parameter set nuevo `CheckMigrations` y módulo nuevo `scripts/dev-lib.migrations.ps1`, sumado al cargador
`dev-lib.ps1` y a su comentario de módulos. Flujo de `Invoke-CheckMigrations`:
1. `Assert-LocalDockerDaemon` (código 8 si es remoto) y `Test-DockerDaemon`. Si falta
   `backend\node_modules\.bin\prisma.cmd`: código 2, con la pista de correr `.\dev.ps1` o `npm install`.
2. Contenedor `solidus-migcheck-<hex8>` con la etiqueta `solidus.dev=migcheck`:
   `docker run -d --rm --tmpfs /var/lib/postgresql/data -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=<New-RandomHex> <imagen>`.
   - El puerto lo elige Docker en el rango efímero, así que nunca es 3000, 3001, 5433 ni 8080.
   - Solo escucha en loopback y no usa volumen.
   - La imagen es la constante nueva `$script:PostgresImage = 'postgres:16.11-alpine'`.
3. Espera con `docker exec <c> pg_isready -h 127.0.0.1 -U postgres` (como `Wait-Postgres`, 60 s) y lee el puerto con
   `docker port <c> 5432/tcp`.
4. Con `Invoke-NativeCapture` y cwd `backend`:
   `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <url> --script --exit-code`.
   - La salida se muestra filtrando cualquier línea que contenga `://`.
   - Exit 0: "Schema y migraciones coinciden".
   - Exit 2: muestra el SQL que falta como migración y sale con el **código 11** (nuevo,
     `$script:ExitCodeMigrationDrift`).
   - Otro código: código 3.
5. `finally`: `docker rm -f -v <c>` siempre, incluso con Ctrl+C o error.

**Seguridad:**
- La URL con la contraseña nunca se imprime. Aparece unos segundos en la línea de comandos de `npx`, porque Prisma no
  acepta la shadow por variable. Es aceptable: es aleatoria, del contenedor descartable y en loopback. Lo valida
  seguridad.
- La URL se arma solo con `127.0.0.1` y el puerto leído de `docker port`. Una función pura lo garantiza y un test
  verifica que nunca es 5433 ni sale de `DATABASE_URL`.
- No lee `backend/.env`. Prisma lo carga por estar en `backend/`, pero `migrate diff` con `--from-migrations` y
  `--to-schema-datamodel` no se conecta a `DATABASE_URL` (probado).

Tiempo medido: menos de 2 s el diff más ~5 s el arranque del contenedor.

### 7.2 Tests de `dev-lib` (sin Docker, en `scripts/dev-lib.tests.ps1`)

Funciones puras con su test:
- `Get-MigrationCheckDockerArgs` lleva `--rm`, `--tmpfs /var/lib/postgresql/data`, `-p 127.0.0.1::5432` y la imagen
  constante.
- `ConvertFrom-DockerPortOutput` parsea `127.0.0.1:49153`, ignora líneas IPv6 y lanza error con una salida vacía.
- `New-ShadowDatabaseUrl` usa solo `127.0.0.1` y rechaza el puerto 5433.
- `Get-MigrationCheckOutcome`: 0 → OK, 2 → código 11, otro → código 3.

Tests estáticos:
- `$script:PostgresImage` es igual a la imagen del servicio `db` de `docker-compose.yml`, con el mismo patrón que
  `CaBaseImage`.
- `Invoke-CheckMigrations` llama a `docker rm -f -v` dentro de un `finally`.
- La pista `P3009|P3018` está en el paso de `migrate deploy` de `dev.ps1`.
- `Assert-Equal 11 $script:ExitCodeMigrationDrift`.

### 7.3 CI (feature 026) y regla 6

- **CI** (runner Linux con un servicio `postgres:16.11-alpine`):
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code`.
  Además, `npx prisma migrate deploy` sobre otra base vacía del mismo servicio y
  `migrate diff --from-url ... --to-schema-datamodel ... --exit-code`. Se anota en el BACKLOG del 026; este feature no
  crea el workflow.
- **Regla 6 de CLAUDE.md:** el documentador agrega que, tras cualquier cambio de schema, se corre
  `.\dev.ps1 -CheckMigrations` (exit 0) y `npx prisma migrate status`. Si `migrate dev` propone un reset, se responde
  **no**. El revisor lo agrega a su checklist cuando haya cambios en `prisma/`.

## 8. Verificación desde cero y plan del tester (criterios 4, 5 y 8)

### 8.1 Desde cero (contenedor descartable, `--tmpfs`, `127.0.0.1::5432`)
1. `migrate deploy` de las 9 migraciones (con `DATABASE_URL` a la base descartable, desde una carpeta sin `.env` y
   `--schema` explícito, o con la variable de proceso, que tiene precedencia sobre `backend/.env`). Se espera "All
   migrations have been successfully applied". Ya probado en el análisis.
2. `migrate status` → exit 0. `migrate diff --from-url <descartable> --to-schema-datamodel ... --exit-code` → 0. Ya
   probado.
3. **Puede crear atenciones:** un script `node` de un solo uso en el scratchpad, no versionado, con el `PrismaClient`
   generado, sobre la base descartable, crea dentro de una transacción:
   - `Organization`, `Payer`, dos `Professional`;
   - `ActivityType` con `baseValue` y `roles`;
   - `WorkItem` con `activityTypeId` y `amountBase`, más `WorkItemParticipant` y `WorkItemSplit`;
   - `User` con `cuit`.

   Después las lee. Los datos son ficticios.
4. Backend contra la base descartable: `npm run start:dev` con `DATABASE_URL` y `PORT=18080` como variables de proceso
   (no 3000, 3001, 5433 ni 8080; `dev.ps1` no levantado) → `GET /health/liveness` 200. Después se detiene.
5. **No hay tests de integración con Prisma real** en el backend: Jest usa mocks y `fake-prisma`. No aplica más allá
   de `npm test`.
6. `docker rm -f -v` de todo lo creado y verificación de que no quedan contenedores ni volúmenes con el prefijo usado.

### 8.2 Base del usuario
- Ensayo en copia (§5.3 paso 3) de los escenarios A y B. Escenario B: correr `migrate deploy` en la copia antes del
  baseline.
- Con la confirmación del usuario, pasos 6 a 8 sobre la base real. Evidencia en `07-testing.md`: exit codes de
  `status` y del diff, y la tabla de conteos antes y después (deben ser iguales a §2.2 salvo uso intermedio).

### 8.3 Calidad
- `npx prisma validate`, `npx prisma generate` (con el backend detenido: si no, EPERM en Windows), `npx tsc --noEmit`,
  `npm test` del backend en verde.
- Tests de `dev-lib` en verde.
- `.\dev.ps1 -CheckMigrations`:
  - con la migración nueva → 0;
  - quitándola temporalmente (en una copia del árbol o moviendo la carpeta y devolviéndola) → 11. Ya probado a nivel
    Prisma: exit 2 sin la migración, 0 con ella.
- El hook `pre-commit` acepta la migración nueva (`.sql` dentro de `backend/prisma/migrations/`).

## 9. Archivos a crear o modificar

| Archivo | Cambio |
|---|---|
| `backend/prisma/migrations/<ts>_align_schema_with_migrations/migration.sql` | **Nuevo**, generado (§4.2) |
| `backend/prisma/schema.prisma` | **Sin cambios** |
| `.gitattributes` | Regla `eol=lf` para las migraciones (§4.4) |
| `scripts/dev-lib.migrations.ps1` | **Nuevo**: guardia (§7.1) |
| `scripts/dev-lib.ps1` | Cargar el módulo `migrations` |
| `scripts/dev-lib.core.ps1` | Constantes `$script:PostgresImage` y `$script:ExitCodeMigrationDrift = 11` |
| `dev.ps1` | Parameter set `CheckMigrations`, ayuda (`.PARAMETER`, código 11), dispatch y pista `P3009\|P3018` en `migrate deploy` |
| `scripts/dev-lib.tests.ps1` | Tests de §7.2 |
| `docs/auditoria/COMANDOS.md` (documentador) | Sección "Baseline de migraciones" (§5.3), flag `-CheckMigrations`, código 11 en la tabla, error común P3009/P3018, nota de que `--shadow-database-url` resetea la base, cómo generar una migración sin `migrate dev` (§4.2) |
| `.claude/CLAUDE.md` (documentador, con pedido del PO) | Regla 6 y lista de comandos (`-CheckMigrations`, código 11) |
| `docs/auditoria/BACKLOG.md` | Cerrar `User.cuit` y la deriva; anotar el CI del 026 (§7.3) y el `;` del Dockerfile (aclaración 3) |

Sin cambios en el backend (`src/`, `test/`), el frontend, `docker-compose.yml` ni `backend/Dockerfile`. **No choca con
el 015**, que toca handlers y specs del backend.

## 10. Errores, rendimiento y compatibilidad

- **Errores:**
  - `-CheckMigrations` se mapea a los códigos existentes (2, 3 y 8) más el 11, y limpia siempre en el `finally`.
  - `migrate deploy` antes del baseline falla sin efectos y la pista lleva al procedimiento.
  - En Docker, el fallo deja una fila de migración fallida que se resuelve con el mismo comando.
- **Rendimiento:** nada en runtime. `-CheckMigrations` tarda unos 10 s y es manual (no se suma al arranque de
  `.\dev.ps1`).
- **Compatibilidad:**
  - Instalaciones nuevas: pasan a funcionar.
  - Base del usuario: sin cambios de schema ni de datos, solo una fila en `_prisma_migrations`.
  - Bases armadas solo con migraciones viejas: ver aclaración 1.
  - Prisma 5.22 (`-o`, `--exit-code` y `--from-schema-datasource` verificados en `migrate diff --help`) y Postgres
    16.11.
- **Lección del análisis:** un `postgres` con `--rm` eliminado con `docker rm -f` **sin `-v`** deja su volumen anónimo.
  Por eso la guardia y las recetas usan `--tmpfs` y `docker rm -f -v`.

## 11. Plan de implementación (pasos chicos)

1. `.gitattributes` (§4.4). Verificar con `git ls-files --eol backend/prisma/migrations` que nada cambia.
2. `dev-lib.migrations.ps1` + constantes + `-CheckMigrations` + tests de §7.2. Sobre el árbol **actual**, sin
   migración nueva, `-CheckMigrations` tiene que dar **11** y mostrar el SQL de §4.1. Es la prueba de que la guardia
   detecta la deriva.
3. Generar la migración (§4.2) y compararla con §4.1. `-CheckMigrations` → 0.
4. Verificación desde cero (§8.1) en un contenedor descartable.
5. Pista `P3009|P3018` en `dev.ps1` + su test. Tests de `dev-lib` en verde.
6. `prisma validate` y `generate`, `tsc --noEmit`, `npm test` (coordinar con el 015: correrlos cuando su trabajo esté
   estable o en su commit).
7. Tester: ensayo en copia (escenarios A y B) → **pedir confirmación al usuario** → baseline en la base real →
   `status`, diff y conteos → `.\dev.ps1` y `-Smoke`.
8. Documentador: COMANDOS, regla 6, BACKLOG.

Commit: la migración y el baseline tienen que ir juntos en el tiempo. Mientras la migración esté en el árbol y el
baseline no se haya hecho, `.\dev.ps1` falla con código 3 (sin daño). Se recomienda hacer el baseline antes del
próximo `.\dev.ps1` del usuario.

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Alguien usa la base del usuario como `--shadow-database-url` (Prisma la **resetea**) | La guardia arma la URL solo hacia el contenedor efímero (con test). Advertencia en COMANDOS y en §4.2 |
| `migrate dev` o `reset` contra la base del usuario | Prohibidos en el feature. La pista de `dev.ps1` lo repite. La regla 6 indica responder "no" al reset |
| Baseline sobre una base que no coincide con el schema | Precondición del diff vacío (paso 5), con exit code verificable |
| Checksum distinto por CRLF que dispara una propuesta de reset en `migrate dev` | `.gitattributes eol=lf` (§4.4) |
| `.\dev.ps1` o `-Docker` antes del baseline | No destructivo (probado). Se recupera con el mismo comando |
| Volúmenes huérfanos de contenedores descartables | `--tmpfs` + `rm -f -v` en `finally` |
| `prisma generate` con EPERM por el backend del 015 corriendo | Detener el backend antes (pista existente) |
| La URL de la shadow visible en la lista de procesos durante segundos | Contraseña aleatoria de un contenedor efímero en loopback; lo revisa seguridad |

## 13. Alternativas descartadas

- **SQL idempotente** (`IF NOT EXISTS`, bloques `DO` para las FKs, `DROP ... IF EXISTS`): evitaría el baseline, pero:
  - no es la salida de `migrate diff` que pide la spec;
  - Postgres 16 no tiene `ADD CONSTRAINT IF NOT EXISTS`, así que hay que escribir SQL a mano;
  - **esconde deriva**: si una columna existe con otro tipo, la saltea en silencio.
- **Editar las migraciones existentes:** rompe los checksums y propone un reset (§4.3).
- **Squash o re-baseline de todo el historial** (borrar las 8 y generar una inicial): obliga a reescribir
  `_prisma_migrations` en la base del usuario y pierde la historia. Es desproporcionado.
- **Dos migraciones** (una para la deriva y otra para `User.cuit`): una sola es más simple y se baselinea con un
  único comando. `User.cuit` queda incluido y documentado.
- **Automatizar el baseline en `dev.ps1`** (detectar el diff vacío y llamar a `resolve` solo): escribe en la base sin
  la confirmación que exige la spec.
- **Switch `-BaselineMigration`:** es una operación única. El procedimiento documentado más la pista alcanza. Si el
  caso se repite, se reconsidera.
- **Guardia en Jest** que se saltea sin `SHADOW_DATABASE_URL`: localmente quedaría siempre salteada. Para el CI, el
  comando de Prisma directo es más simple.
- **Guardia offline sin Postgres:** Prisma 5.22 necesita una shadow para `--from-migrations`. PGlite u otra base
  embebida sería una dependencia nueva.
- **Guardia en el hook `pre-commit`:** necesitaría Docker en cada commit y el hook está dedicado a secretos.
- **Correr la guardia en cada `.\dev.ps1`:** suma unos 10 s a cada arranque.
- **`-NewMigration <nombre>`** (generar migraciones sin `migrate dev`): útil, pero fuera de alcance. Va al BACKLOG.

## 14. Aclaraciones para el PO

1. **Columnas que se borran solo en bases armadas con las migraciones viejas:** `WorkItem.coProfessionalId` (con su
   FK) y `WorkItem.eventRole`.
   - En la base del usuario **no existen**: no hay nada que consultar ni perder.
   - En una base armada solo con migraciones que ya tenga atenciones, la migración **falla entera**, sin borrar nada
     (probado): `amountBase` es `NOT NULL` sin default y Prisma la aplica en una transacción.
   - Hay dos volúmenes huérfanos de composes viejos en este equipo: `healthops_healthops_pgdata` e
     `infra_healthops_pg`. No se inspeccionaron (fuera de alcance) y este proyecto no los usa. Si alguna vez se
     quisieran recuperar, primero hay que pasarles un `migrate diff`.
   - **Decisión pedida: confirmar que se aceptan esos `DROP` en la migración.** Es el comportamiento correcto para
     instalaciones nuevas.
2. **El alcance real es mayor que el del hallazgo del 015:** también faltaban en las migraciones `Payer.cuit` y la FK
   `Professional.userId → User`. Las dos ya están en la base local y entran en la misma migración.
3. **`backend/Dockerfile` arranca el backend aunque `migrate deploy` falle** (`;` en lugar de `&&`). Hoy eso evita que
   `-Docker` se caiga antes del baseline. Igual, conviene revisarlo (fallar rápido) en otro feature: BACKLOG.
4. **Confirmación del usuario** antes del paso 6 de §5.3 (`resolve --applied` sobre su base). Es la única escritura, y
   es una fila en `_prisma_migrations`. Recomendación: hacerlo antes del próximo `.\dev.ps1`.
5. **Regla 6 y `CLAUDE.md`:** el documentador necesita el pedido explícito para tocar `.claude/CLAUDE.md`
   (`-CheckMigrations`, código 11 y "responder no al reset").
6. **Pendiente de limpieza manual (ver §15):** quedó un volumen anónimo del análisis cuya eliminación bloqueó el
   sistema de permisos.

## 15. Contenedores y volúmenes usados en este análisis

| Recurso | Uso | Estado |
|---|---|---|
| `solidus-shadow-016` (`postgres:16.11-alpine`, `127.0.0.1:55436`) | Shadow para los diffs; bases descartables `shadow`, `fresh`, `fresh2`, `old8` con datos ficticios | Eliminado |
| `solidus-copy-016` + volumen `solidus-copy-016` (`127.0.0.1:55437`) | Copia de la base del usuario (volumen original montado `:ro`); escenario A | Contenedor y volumen eliminados |
| `solidus-copy2-016` + volumen `solidus-copy2-016` (`127.0.0.1:55438`) | Segunda copia; escenario B y origen del `pg_dump` | Contenedor y volumen eliminados |
| `solidus-volcopy-016`, `solidus-volcopy2-016` | Copia del volumen (sin red, `--rm`) | Se eliminaron solos |
| Volumen anónimo `d9e4e4f6a7e029d0a57e27311f9dee0c4dc3f13e9fad338c015d240915b888a9` | Datos de `solidus-shadow-016`. Contiene solo las bases descartables de arriba, sin datos del usuario | **Sigue existiendo**: el sistema de permisos bloqueó `docker volume rm`. Lo borra el usuario con `docker volume rm d9e4e4f6a7e029d0a57e27311f9dee0c4dc3f13e9fad338c015d240915b888a9` |

- La base del usuario (`healthops-gem-db-1`, volumen `healthops-gem_solidus_postgres_data`) **no se levantó ni se
  escribió**. Siguió detenida y solo se leyó su volumen en modo `:ro`.
- No se corrió `migrate dev`, `reset` ni `db push`, y no se imprimieron credenciales.

VEREDICTO: APROBADO
