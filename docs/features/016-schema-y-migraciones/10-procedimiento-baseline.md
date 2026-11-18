> **Camino recomendado: `.\dev.ps1 -BaselineMigrations [-Yes]`.** Implementa este procedimiento de forma genérica
> (verifica la precondición, respalda, pide escribir `SI`, marca con `resolve --applied` y verifica estado, diff y conteos).
> El script manual de abajo queda como alternativa. Detalle y ensayo en la sección "Agregado: -BaselineMigrations" de
> `04-implementacion.md`.

# 10 — Procedimiento de baseline sobre la base local del usuario (versión reforzada)

Autor: PO. Reemplaza la sección 9 de `04-implementacion.md` e incorpora los menores 1, 2 y 3 del revisor y el menor 3
de seguridad. **Requiere la confirmación del usuario.**

## Qué hace
Registra en la base local que la migración `20261104192244_align_schema_with_migrations` ya está aplicada, porque la
base ya tiene esas columnas. No ejecuta su SQL. Escribe una sola fila en `_prisma_migrations` y no toca tablas ni
datos.

## Reglas
- **Prohibido en todo el procedimiento:** `migrate dev`, `migrate reset`, `db push`, `TRUNCATE`, `DROP` y
  `docker compose down -v`.
- **No correr `.\dev.ps1` ni `-Docker` antes del paso 6.** Si ya se corrió, el procedimiento sirve igual: es el
  escenario B, ya ensayado.
- **Ninguna credencial en la línea de comandos.** Las variables de conexión se expanden dentro del contenedor, y Prisma
  lee `backend/.env`.

## Script
Se ejecuta desde la raíz del repo, en PowerShell. Se detiene solo ante cualquier falla y pide confirmación antes del
paso que escribe.

```powershell
$ErrorActionPreference = 'Stop'
Set-Location C:\Repositorios\healthops-gem
$migration = '20261104192244_align_schema_with_migrations'

# 1) Levantar solo la base, con un tope de 120 s
docker compose up -d db
if ($LASTEXITCODE -ne 0) { throw 'No se pudo levantar la base' }
$deadline = (Get-Date).AddSeconds(120)
do {
  Start-Sleep 2
  docker compose exec -T db sh -c 'pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' *> $null
} until ($LASTEXITCODE -eq 0 -or (Get-Date) -gt $deadline)
if ($LASTEXITCODE -ne 0) { throw 'La base no respondió en 120 s' }

# 2) Respaldo (lectura). Se aborta si algo falla o si el dump queda vacío
New-Item -ItemType Directory -Force .dev\backups | Out-Null
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges -f /tmp/pre-016.dump'
if ($LASTEXITCODE -ne 0) { throw 'pg_dump falló' }
docker compose cp db:/tmp/pre-016.dump .dev/backups/pre-016.dump
if ($LASTEXITCODE -ne 0) { throw 'No se pudo copiar el respaldo' }
docker compose exec -T db rm -f /tmp/pre-016.dump
if (-not (Test-Path .dev\backups\pre-016.dump) -or (Get-Item .dev\backups\pre-016.dump).Length -le 0) { throw 'Respaldo vacío' }

# 3) Conteos ANTES (lectura)
$countSql = @"
select table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name <> '_prisma_migrations' order by 1;
"@
$before = $countSql | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA'
if ($LASTEXITCODE -ne 0 -or -not $before) { throw 'No se pudieron leer los conteos' }
$before

# 4) Estado de migraciones (lectura). Se espera que solo la migración nueva figure como pendiente o fallida
Set-Location backend
npx prisma migrate status

# 5) PRECONDICIÓN: la base coincide con el schema. Si no da 0, se detiene
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
if ($LASTEXITCODE -ne 0) { Set-Location ..; throw 'La base NO coincide con el schema: no se hace el baseline. Avisar al PO.' }

# 6) ÚNICO PASO QUE ESCRIBE (una fila en _prisma_migrations). Confirmación explícita
$ok = Read-Host "Escribí SI para registrar $migration como aplicada"
if ($ok -ne 'SI') { Set-Location ..; throw 'Cancelado por el usuario' }
npx prisma migrate resolve --applied $migration
if ($LASTEXITCODE -ne 0) { Set-Location ..; throw 'resolve --applied falló' }

# 7) Verificación
npx prisma migrate status
if ($LASTEXITCODE -ne 0) { Set-Location ..; throw 'migrate status no quedó limpio' }
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
if ($LASTEXITCODE -ne 0) { Set-Location ..; throw 'diff distinto de 0 después del baseline' }
Set-Location ..
$after = $countSql | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA'
if (($before -join '|') -ne ($after -join '|')) { throw 'CONTEOS DISTINTOS: no seguir, avisar al PO' }
'CONTEOS IGUALES. Baseline OK.'

# 8) Arranque normal. Debería decir "No pending migrations to apply"
.\dev.ps1
.\dev.ps1 -Smoke
```

## Al terminar
- **Borrar el respaldo** cuando `-Smoke` dé OK, porque contiene datos de pacientes sin cifrar:
  `Remove-Item .dev\backups\pre-016.dump`. Si se usó el comando `.\dev.ps1 -BaselineMigrations`, el respaldo se llama
  `pre-baseline-<yyyyMMdd-HHmmss>.dump`: `Remove-Item .dev\backups\pre-baseline-*.dump`.
- **Reversión del paso 6** (solo toca `_prisma_migrations`):
  `cd backend; npx prisma migrate resolve --rolled-back 20261104192244_align_schema_with_migrations`.
- **Último recurso:** restaurar `pre-016.dump`. Reemplaza la base y requiere una confirmación aparte, así que conviene
  no borrar el respaldo hasta que todo funcione.
