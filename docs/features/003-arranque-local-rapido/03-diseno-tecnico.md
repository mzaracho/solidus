# 03 — Diseño técnico: 003-arranque-local-rapido

> Autor: arquitecto. Entrada: `01-spec.md`, `.claude/CLAUDE.md` (reglas 2, 3, 10 y 12) y, como
> antecedente, `002-sin-credenciales-en-repo/03-diseno-tecnico.md` y `09-cierre.md`.
> No se leyeron valores de `.env`, `backend/.env`, `.claude/settings.local.json` ni del backup
> `_backup_git`. De los `.env` solo se listaron **nombres** de variables y el formato del archivo.

## 1. Estado actual relevante (verificado)

| Pieza | Hallazgo |
|---|---|
| `.env` (raíz) | Variables: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `JWT_SECRET`. UTF-8 sin BOM, LF. |
| `backend/.env` | Variables: `NODE_ENV`, `PORT`, `NODE_TLS_REJECT_UNAUTHORIZED`, `APP_NAME`, `DATABASE_URL`, `CORS_ORIGIN`, `CORS_METHODS`, `JWT_SECRET`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`. UTF-8 sin BOM, LF. |
| `docker-compose.yml` (raíz) | `db` (5433, volumen `solidus_postgres_data`, `restart: always`), `backend` (8080, `DATABASE_URL` armado con `POSTGRES_*` hacia `db:5432`, `CORS_ORIGIN` con la IP de LAN), `frontend` (build arg `NEXT_PUBLIC_API_BASE_URL` con la IP de LAN, `INTERNAL_API_URL=http://backend:8080/api` en runtime). `version: '3.8'` obsoleto. |
| `backend/docker-compose.yml` | Solo `db` en 5433, volumen `postgres_data` (proyecto `backend`, o sea `backend_postgres_data`), lee `POSTGRES_*` de `backend/.env`. |
| Backend: carga de variables | `src/api/main.ts` hace `import 'dotenv/config'` y `AppModule` usa `ConfigModule.forRoot({ isGlobal: true })` sin `envFilePath` ni `expandVariables`: los dos leen `.env` del directorio de trabajo (`backend/`). El `Logger` exige `NODE_ENV` y `APP_NAME`. `jwt-config.ts` exige `JWT_SECRET` de 32+ caracteres. |
| Prisma | `schema.prisma`: `url = env("DATABASE_URL")`. Prisma 5.22 CLI carga `backend/.env` (o `prisma/.env`); no admite otra ruta sin herramientas externas (`prisma.config.ts` es de Prisma 6). |
| CORS | `cors-config.ts` lee `CORS_ORIGIN`/`CORS_METHODS` pero usa `origin: true`: la variable no tiene efecto. |
| Frontend | `services/data.ts`: SSR usa `INTERNAL_API_URL` o `http://backend:8080/api` (no existe fuera de Docker). Cliente y `login/page.tsx`: `NEXT_PUBLIC_API_BASE_URL` o `http://localhost:8080/api`. `next.config.ts` (rewrites): `INTERNAL_API_URL` o `http://localhost:8080/api`. No existe `frontend/.env.example` ni `frontend/.env.local`. `src/app/api/` está vacío. |
| Endpoints para humo | Swagger UI en `GET /` (fuera del prefijo `api`). Login público: `POST /api/v1/auth/login`, body `{ "user", "password" }`, responde 201 con `token`. `LoginQueryHandler` solo **lee** (`user.findUnique`, `professional.findFirst`): no escribe en la base. |
| Logs | `LoggingInterceptor` imprime en nivel debug headers, body y respuesta (incluye contraseña y token del login). Preexistente, BACKLOG ítem 7. |
| Seeds (grep de sentencias, sin leer datos) | `truncate.sql`: 1 `TRUNCATE` (todas las tablas). `seed.sql` y `seed_test_users.sql`: solo `INSERT`, sin `ON CONFLICT` (fallan por duplicados si ya hay datos). `seed_activities.sql`: 4 `DELETE FROM` (`ProfessionalCategory`, `WorkItemSplit`, `WorkItemParticipant`, `WorkItem`) e `INSERT ... ON CONFLICT`. `seed_psicolsa.sql`: 1 `TRUNCATE`. Orden documentado en `COMANDOS.md`: `truncate.sql` → `seed.sql` → `seed_test_users.sql`. `seed_activities.sql` y `seed_psicolsa.sql` no figuran en el orden y contienen datos personales reales (RIESGOS S6). |
| Entorno | Windows PowerShell 5.1.26100 disponible; **PowerShell 7 (`pwsh`) no está instalado**. Política `CurrentUser = RemoteSigned`. Node 24.13, npm 11.6, Docker Compose v5.6. Docker Desktop **no estaba corriendo** durante el diseño: no se pudo ver qué volúmenes existen. |
| `.gitignore` | Raíz: `.env`, `.env.*`, `!.env.example` (aplican en cualquier nivel). `frontend/.gitignore`: `.env*` y `!.env.example`. `.dockerignore` de backend y frontend excluyen `.env*` salvo `.env.example`. No hay `.ps1` versionados ni carpeta `scripts/`. |

## 2. Decisiones de diseño

### 2.1 Fuente única de credenciales (criterio 1)

**Elegido: el `.env` de la raíz es la única fuente editable. `dev.ps1` genera y sincroniza
`backend/.env` como archivo derivado en cada ejecución.** Sin cambios de código en el backend ni
dependencias nuevas.

| Opción | Nest | Prisma CLI manual (`npx prisma migrate dev`) | Costo | Decisión |
|---|---|---|---|---|
| A. `ConfigModule.forRoot({ envFilePath: ['.env','../.env'], expandVariables })` + `dotenv` con ruta | Sí | **No**: Prisma 5 no lee `../.env` | Cambio de código y sigue faltando Prisma | Descartada |
| B. `dotenv-cli` en scripts npm (`dotenv -e ../.env -- prisma ...`) | Sí | Solo vía script npm; `npx prisma ...` directo falla | Dependencia nueva, cambia `package.json` y hábitos | Descartada |
| C. Script exporta las variables al entorno de las ventanas que lanza | Sí | Solo dentro de esas ventanas | Comportamiento oculto; `npm run start:dev` manual o `launch.json` no funcionan | Descartada |
| **D. `backend/.env` generado por `dev.ps1`** | Sí (sin cambios) | Sí (sin cambios) | Un archivo derivado más, ignorado | **Elegida** |

Justificación: es la única opción que mantiene funcionando, sin tocar código, los tres consumidores
de `backend/.env` (Nest con `dotenv/config` y `ConfigModule`, Prisma CLI y `.claude/launch.json`),
y la spec lo admite expresamente ("lo genera o sincroniza el script"). El costo (archivo derivado
que puede quedar desactualizado si se edita `.env` y no se corre el script) se mitiga con una
cabecera de "archivo generado", la sincronización en cada ejecución y `.\dev.ps1 -Init`.

**Contenido de `backend/.env` generado** (los valores salen de `.env` raíz; aquí solo la forma):

```dotenv
# GENERADO por dev.ps1 a partir de ../.env. No editar DATABASE_URL ni JWT_SECRET aquí:
# editar el .env de la raíz y correr .\dev.ps1 -Init. Las demás variables se conservan.
DATABASE_URL="postgresql://<usuario>:<contraseña>@localhost:5433/<base>?schema=public"
JWT_SECRET=<igual al de ../.env>
NODE_ENV=development
APP_NAME="Solidus API"
PORT=8080
# --- Variables locales conservadas (no administradas por dev.ps1) ---
<líneas KEY=valor que ya existían y no son administradas ni obsoletas>
```

Clasificación de claves al sincronizar:

| Tipo | Claves | Regla |
|---|---|---|
| Derivadas (siempre se reescriben desde `.env` raíz) | `DATABASE_URL`, `JWT_SECRET` | Valor calculado. |
| Con default (se respeta el valor existente) | `NODE_ENV`, `APP_NAME`, `PORT` | Si faltan: `development`, `"Solidus API"`, `8080`. |
| Obsoletas (se eliminan) | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Solo las usaba `backend/docker-compose.yml`, que se elimina. Quitarlas reduce la duplicación de credenciales. |
| Locales (se conservan tal cual) | Cualquier otra (hoy `NODE_TLS_REJECT_UNAUTHORIZED`, `CORS_ORIGIN`, `CORS_METHODS`) | Se copian línea por línea al bloque final. No se interpretan. |

**Cómo se arma `DATABASE_URL`:** `postgresql://` + `[Uri]::EscapeDataString(POSTGRES_USER)` + `:` +
`[Uri]::EscapeDataString(POSTGRES_PASSWORD)` + `@localhost:5433/` + `EscapeDataString(POSTGRES_DB)` +
`?schema=public`. El escape porcentual hace que funcione con cualquier carácter y que no queden `$`
literales (Prisma expande `${...}` en `.env`). Host y puerto son constantes del script (los mismos del
compose). Nadie escribe `DATABASE_URL` a mano.

**Escritura:** solo si el contenido nuevo difiere del actual (evita tocar el archivo en cada
ejecución). Siempre UTF-8 **sin BOM** y LF, con `[System.IO.File]::WriteAllText(ruta, texto,
(New-Object System.Text.UTF8Encoding $false))`. No usar `Set-Content`/`Out-File`: en PowerShell 5.1
agregan BOM y la primera clave quedaría ilegible para Docker Compose y dotenv.

**Migración de los valores existentes (sin perderlos ni mostrarlos):**

Un `backend/.env` es *heredado* si su primera línea no empieza con `# GENERADO por dev.ps1`.

| Caso | `.env` raíz | `backend/.env` | Acción |
|---|---|---|---|
| 1. Clon nuevo | no existe | no existe | Crear `.env` desde `.env.example` con secretos aleatorios (2.3). Generar `backend/.env`. |
| 2. Solo backend | no existe | heredado | Crear `.env` desde `.env.example` **tomando** `POSTGRES_USER/PASSWORD/DB` de `backend/.env` (si faltan, se extraen de su `DATABASE_URL`, decodificando) y `JWT_SECRET` si tiene 32+ caracteres (si no, se genera). No se generan credenciales de Postgres nuevas: el volumen existente las necesita. Respaldar y regenerar `backend/.env`. |
| 3. **Esta máquina** | existe | heredado | `.env` raíz tiene **prioridad**. Comparar en memoria `POSTGRES_*` (contra las `POSTGRES_*` de `backend/.env` y contra usuario, contraseña y base extraídos de su `DATABASE_URL`) y `JWT_SECRET`. Por cada diferencia, avisar **solo el nombre** de la variable. Si `DATABASE_URL` apuntaba a otro host, puerto o base, avisarlo también (sin mostrar la URL). Respaldar y regenerar. |
| 4. Régimen normal | existe | generado | Sincronizar (reescribir derivadas, conservar el resto). Sin respaldo. |

- **Respaldo:** antes de reemplazar un archivo heredado se copia a `backend/.env.pre-003.bak` (solo
  si ese archivo no existe ya, para no pisar un respaldo anterior). Queda ignorado por `.env.*` en el
  `.gitignore` raíz y en `backend/.dockerignore`. El mensaje sugiere borrarlo cuando todo funcione.
- **Prioridad del `.env` raíz, justificación:** `dev.ps1` levanta Postgres con el compose raíz
  (2.4), cuyo volumen se inicializó con las credenciales que el 002 copió al `.env` raíz. Es el
  valor coherente con la base que se va a usar. Un `JWT_SECRET` distinto solo invalida sesiones
  abiertas (y hoy los JWT ni se verifican, riesgo S1).
- **Ejemplo de aviso:** `Aviso: POSTGRES_PASSWORD y JWT_SECRET de backend/.env diferían de .env. Se
  usan los de .env (raíz). Copia del archivo anterior: backend\.env.pre-003.bak`.
- Si después `prisma migrate deploy` falla por autenticación (P1000), el mensaje de error remite a
  ese aviso y al respaldo.

**`backend/docker-compose.yml`: se elimina.** Mantenerlo obligaría a una segunda definición de la
base en el mismo puerto, con otro volumen y otro `.env`: es justamente la duplicación que el
criterio 1 quiere eliminar. El modo desarrollo usa `docker compose up -d db` del compose raíz, que
lee el mismo `.env` que el modo Docker. Consecuencia buscada: **los dos modos comparten la misma
base**. Condición previa: ver paso 0 del plan y riesgo R-1 (volumen `backend_postgres_data`).

### 2.2 Variables nuevas y SSR del frontend (criterios 2 y 3)

**Variables del `.env` raíz:**

| Variable | Estado | Quién la usa | Default al crear o agregar |
|---|---|---|---|
| `POSTGRES_USER` | existente | compose (`db`, `backend`), `dev.ps1` (`DATABASE_URL`, `psql -U`) | Al crear: `solidus` (no es secreto) |
| `POSTGRES_PASSWORD` | existente | compose, `dev.ps1` (`DATABASE_URL`) | Al crear: 24 bytes aleatorios en hex (48 caracteres) |
| `POSTGRES_DB` | existente | compose, `dev.ps1` | `solidus_db` (del ejemplo) |
| `JWT_SECRET` | existente | compose (`backend`), `backend/.env` | Al crear: 32 bytes aleatorios en hex (64 caracteres) |
| `NEXT_PUBLIC_API_BASE_URL` | **nueva** | compose: build arg del `frontend` (modo Docker) | `http://localhost:8080/api` |
| `SMOKE_USER` | **nueva** | `dev.ps1 -Smoke` | vacío (= se saltea el login) |
| `SMOKE_PASSWORD` | **nueva** | `dev.ps1 -Smoke` | vacío |

No se agregan: `CORS_ORIGIN` (se elimina del compose, ver abajo), variables de puertos (los puertos
quedan fijos: 5433, 8080, 3000 y 3001) ni `COMPOSE_PROJECT_NAME` (fijarlo haría que un clon en otra
carpeta compartiera el volumen real).

Se usa el mismo nombre `NEXT_PUBLIC_API_BASE_URL` en el `.env` raíz que en el frontend, para que se
reconozca a simple vista. Solo afecta al modo Docker (se hornea en el build). En modo desarrollo el
frontend usa sus defaults (`localhost`); para otro valor se usa `frontend/.env.local`.

**`.env.example` (raíz), contenido propuesto:**

```dotenv
# Configuración local. Copiar a .env (no se versiona) o dejar que .\dev.ps1 lo cree.
# Es la ÚNICA fuente de credenciales: dev.ps1 genera backend/.env a partir de este archivo.
# Lo leen docker compose (raíz) y dev.ps1.
POSTGRES_USER=change-me
POSTGRES_PASSWORD=change-me
POSTGRES_DB=solidus_db
# Mínimo 32 caracteres. dev.ps1 lo genera al crear el .env. A mano:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=change-me
# URL de la API vista desde el navegador en modo Docker (se hornea al construir el frontend).
# Para usar el frontend desde otro equipo de la red, poner la IP de esta PC y correr .\dev.ps1 -Docker.
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api
# Prueba de humo (.\dev.ps1 -Smoke): usuario de prueba de la base local. Vacíos = se saltea el login.
SMOKE_USER=
SMOKE_PASSWORD=
```

**`docker-compose.yml` (raíz), cambios:**

```yaml
# (se elimina la línea version: '3.8', obsoleta: solo genera un warning en cada comando)
services:
  db:
    restart: unless-stopped        # antes: always (ver nota)
    # environment, ports y volumes sin cambios
  backend:
    environment:
      # DATABASE_URL, JWT_SECRET, PORT, APP_NAME, NODE_ENV: sin cambios
      # CORS_ORIGIN: se elimina (el código lo ignora; BACKLOG ítem 9 lo reintroducirá)
  frontend:
    build:
      args:
        NEXT_PUBLIC_API_BASE_URL: "${NEXT_PUBLIC_API_BASE_URL:-http://localhost:8080/api}"
    environment:
      INTERNAL_API_URL: http://backend:8080/api   # sin cambios
```

- `CORS_ORIGIN` se **elimina** en lugar de parametrizarse: una variable que no tiene efecto induce a
  error, y parametrizar un JSON dentro de un default de YAML es frágil. El nombre de la variable se
  sigue documentando como opcional en `backend/.env.example` (como hoy).
- `restart: unless-stopped` en `db`: con `always`, Docker vuelve a levantar la base al reiniciar
  Docker Desktop aunque el usuario la haya detenido con `-Stop`. Es la misma política que ya usan
  `backend` y `frontend`. Recrear el contenedor no afecta al volumen nombrado.
- Nombres de volúmenes: sin cambios.

**SSR del frontend en modo desarrollo (criterio 3): cambio de default en código, sin archivo
generado.**

`frontend/src/services/data.ts`, línea 4: el fallback de servidor pasa de `http://backend:8080/api`
a `http://localhost:8080/api`, con un comentario que explique que en Docker lo define
`docker-compose.yml`. Queda igual al default de `next.config.ts`.

- Funciona con `npm run dev` manual, desde `launch.json` o desde el script, sin generar nada.
- Modo Docker: el compose sigue definiendo `INTERNAL_API_URL=http://backend:8080/api` en runtime,
  así que el contenedor usa `backend`. Durante el `next build` del Dockerfile la variable no está
  definida en ninguno de los dos casos (antes ni ahora), así que el build no cambia.
- Descartado generar `frontend/.env.local`: otro archivo derivado más, y no arregla el arranque
  manual. `frontend/.env.local` queda como override opcional del usuario (ya ignorado por
  `frontend/.gitignore` y por `.env.*` en la raíz; excluido del build por `frontend/.dockerignore`).

**`frontend/.env.example` (nuevo, versionado), contenido propuesto:**

```dotenv
# Opcional. Solo para `npm run dev` fuera de Docker: copiar a frontend/.env.local si hace falta
# cambiar algo. Sin este archivo, los dos valores son http://localhost:8080/api.
# En modo Docker los define docker-compose.yml (NEXT_PUBLIC_API_BASE_URL sale del .env de la raíz).
# NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api
# INTERNAL_API_URL=http://localhost:8080/api
```

**`backend/.env.example`, reescrito** (se mantiene como referencia para quien no use `dev.ps1`, por
ejemplo en macOS o Linux):

```dotenv
# backend/.env lo GENERA .\dev.ps1 a partir del .env de la raíz. No hace falta copiar este archivo.
# Solo sin dev.ps1 (p. ej. macOS/Linux): copiar a backend/.env y usar los mismos valores que el
# .env de la raíz. Lo leen Nest (dotenv y ConfigModule) y Prisma CLI.
NODE_ENV=development
APP_NAME="Solidus API"
PORT=8080
DATABASE_URL="postgresql://change-me:change-me@localhost:5433/solidus_db?schema=public"
# Mínimo 32 caracteres; el mismo JWT_SECRET del .env de la raíz.
JWT_SECRET=change-me
# Opcionales
# BODY_SIZE_LIMIT=50mb
# CORS_ORIGIN=["http://localhost:3000"]   (hoy el código lo ignora)
# CORS_METHODS=["GET","POST"]             (hoy el código lo ignora)
```

### 2.3 `dev.ps1`

**Archivos:**
- `dev.ps1` (raíz): parámetros, flujo principal, manejo de errores y códigos de salida.
- `scripts/dev-lib.ps1`: funciones, sin efectos al cargarse. `dev.ps1` lo carga con
  `. "$PSScriptRoot\scripts\dev-lib.ps1"`. La separación existe para poder testear las funciones
  puras sin ejecutar el arranque (patrón nuevo, justificado por la regla 7).
- `scripts/dev-lib.tests.ps1`: tests sin dependencias (sección 4).

Las funciones reciben `$RootDir` como parámetro y no usan rutas relativas al directorio actual.
Las funciones no llaman a `exit`: lanzan un error con código (ver "Manejo de errores"), así los
tests pueden capturarlo.

**Parámetros** (`[CmdletBinding(DefaultParameterSetName = 'Dev')]`, ayuda basada en comentarios
para `Get-Help .\dev.ps1`):

| Invocación | Parameter set | Qué hace |
|---|---|---|
| `.\dev.ps1` | `Dev` | Modo desarrollo completo. |
| `.\dev.ps1 -Seed` | `Dev` | Igual, y carga seeds antes de lanzar el backend (2.4). |
| `.\dev.ps1 -Docker [-Seed]` | `Docker` | Stack completo en Docker. |
| `.\dev.ps1 -Stop` | `Stop` | Detiene procesos y contenedores. |
| `.\dev.ps1 -Smoke` | `Smoke` | Prueba de humo (2.5). |
| `.\dev.ps1 -Init` | `Init` | Solo crea o sincroniza los `.env` y valida la configuración. No levanta nada ni necesita el daemon de Docker. Sirve para el clon nuevo y para la prueba del tester. |

`-Docker`, `-Stop`, `-Smoke` e `-Init` son `Mandatory` en su set; `-Seed` pertenece a `Dev` y
`Docker`. Combinaciones inválidas las rechaza PowerShell. No se agrega ningún flag para saltear la
confirmación de seeds.

**Inicio del script (compatibilidad 5.1 y 7):**
- `Set-StrictMode -Version 2.0`; `$ErrorActionPreference = 'Stop'`;
  `$ProgressPreference = 'SilentlyContinue'` (en 5.1 la barra de progreso de `Invoke-WebRequest`
  lo vuelve muy lento).
- `$RootDir = $PSScriptRoot`; `Push-Location $RootDir` y `Pop-Location` en `finally`.
- Todas las llamadas a compose pasan `-f "$RootDir\docker-compose.yml"` (helper `Invoke-Compose`),
  así el proyecto es siempre el de la raíz (`healthops-gem` en esta máquina) y el `.env` es el de la
  raíz, aunque se invoque desde otra carpeta.
- npm y npx se invocan como `npm.cmd` y `npx.cmd`: en PowerShell, `npm` resuelve primero a
  `npm.ps1`, que la política de ejecución puede bloquear.
- Prohibido en el código: `??`, `?.`, ternario, `&&`/`||` entre comandos,
  `ConvertFrom-Json -AsHashtable`, `Join-Path` con más de dos partes,
  `RandomNumberGenerator::Fill`, `Start-Process -Environment` (todos posteriores a 5.1).
- **Codificación de los `.ps1`: UTF-8 con BOM.** PowerShell 5.1 lee los scripts sin BOM como ANSI y
  los mensajes con tildes saldrían rotos. El tester verifica los bytes `EF BB BF`.

**Flujo `Dev` (orden de pasos):**

1. `Initialize-Config`: crea o completa `.env` raíz (2.3.1), lo valida y sincroniza `backend/.env`
   (2.1).
2. `Test-Prerequisites -Mode Dev`: Docker CLI, daemon, Compose v2, Node 22+, npm (2.3.2).
3. Si ya hay procesos lanzados por `dev.ps1` vivos (archivo de PIDs, 2.3.4): avisar "El entorno ya
   está levantado", asegurar `db` arriba, ejecutar seeds si se pidió `-Seed`, mostrar las URLs y
   terminar con 0. No relanza ni corre `prisma generate` (en Windows falla con EPERM si el backend
   tiene el motor de Prisma abierto).
4. `Test-Ports -Mode Dev`: 5433, 8080 y 3000 (2.3.2).
5. `Update-NodeModules` en `backend/` (con `--legacy-peer-deps`, igual que su Dockerfile) y en
   `frontend/` (2.3.3).
6. `Invoke-Compose up -d db` y `Wait-Postgres` (2.3.5).
7. `npx.cmd prisma migrate deploy` y `npx.cmd prisma generate` en `backend/`. Nunca `db push`.
8. Si `-Seed`: `Invoke-Seeds` (2.4).
9. `Start-DevWindow backend` → `Wait-Http http://localhost:8080/` (timeout 180 s).
10. `Start-DevWindow frontend` → `Wait-Http http://localhost:3000/login` (timeout 180 s; la primera
    compilación de Next tarda).
11. Mostrar el resumen: frontend `http://localhost:3000`, API `http://localhost:8080/api`,
    Swagger `http://localhost:8080/`, y "Detener: .\dev.ps1 -Stop · Probar: .\dev.ps1 -Smoke".

**Flujo `Docker`:** pasos 1 y 2 (sin Node), `Test-Ports -Mode Docker` (5433, 8080 y 3001; si hay
procesos de modo desarrollo vivos, error "Detené primero el modo desarrollo con .\dev.ps1 -Stop"),
`Invoke-Compose up --build -d`, `Wait-Http http://localhost:8080/` (240 s; si el contenedor
`backend` sale o reinicia, error con la pista `docker compose logs backend`),
`Wait-Http http://localhost:3001/login` (180 s), seeds si `-Seed` (el backend ya aplicó las
migraciones), resumen con `http://localhost:3001`.

**Flujo `Init`:** paso 1 y, si existe el CLI de Docker, `docker compose config --quiet` (sin
`--quiet` imprimiría los secretos interpolados). Resumen: qué archivo se creó o se mantuvo, qué
variables se agregaron (solo nombres), avisos de la migración. Código 0 si todo valida.

#### 2.3.1 Creación y completado del `.env` raíz

- **No existe:** si falta `.env.example`, error (código 1). Se lee la plantilla línea por línea y se
  reemplazan los valores `change-me` de `POSTGRES_USER` (por `solidus`), `POSTGRES_PASSWORD` y
  `JWT_SECRET` (aleatorios). El resto se copia igual, comentarios incluidos. Caso 2 de 2.1: se toman
  los valores del `backend/.env` heredado en lugar de generarlos.
- **Existe:** no se modifica ningún valor. Solo se **agregan al final** las variables de la plantilla
  que falten (`NEXT_PUBLIC_API_BASE_URL`, `SMOKE_USER`, `SMOKE_PASSWORD`), con su default y precedidas
  por `# Agregadas por dev.ps1`. Se garantiza un salto de línea antes de lo agregado y el contenido
  previo se conserva byte a byte. Excepción: si `JWT_SECRET` **falta o está vacío**, se genera y se
  agrega (no afecta al volumen). Si falta alguna `POSTGRES_*`, **error**, no se genera: una
  contraseña nueva rompería un volumen ya inicializado.
- **Generación de secretos:**
  ```powershell
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] $Count
  $rng.GetBytes($bytes); $rng.Dispose()
  ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  ```
  Funciona igual en .NET Framework (5.1) y .NET (7). El hex es seguro para URL y para la
  interpolación de compose. Los valores solo viven en variables locales y en el archivo: no pasan por
  `Write-Host`, `Write-Verbose`, el entorno del proceso ni la línea de comandos de otros procesos.
- **Lectura (`Read-DotEnv`):** `KEY=VALUE` por línea; ignora vacías y `#`; quita BOM si lo hubiera,
  espacios alrededor de la clave y comillas simples o dobles envolventes; en valores sin comillas,
  corta un comentario ` #...`. Devuelve un diccionario ordenado. Nunca imprime.
- **Validación:**
  - Errores (código 1): falta `POSTGRES_*`; `JWT_SECRET` con menos de 32 caracteres o `change-me` (el
    mensaje explica cómo generarlo; no se reemplaza solo, porque es un valor existente).
  - Avisos: `POSTGRES_USER` o `POSTGRES_PASSWORD` con `change-me`; `POSTGRES_PASSWORD` con caracteres
    fuera de `[A-Za-z0-9._~-]` (el modo desarrollo funciona por el escape, pero el compose interpola
    la contraseña sin escapar en el `DATABASE_URL` del modo Docker); `NEXT_PUBLIC_API_BASE_URL` que no
    empieza con `http://` o `https://`.
  - Variables `POSTGRES_*`, `JWT_SECRET` o `DATABASE_URL` definidas en el entorno del proceso: aviso
    (solo el nombre), porque tienen precedencia sobre los `.env` en compose, dotenv y Prisma.

#### 2.3.2 Prerrequisitos y puertos

| Chequeo | Cómo | Mensaje si falla (código 2) |
|---|---|---|
| Docker CLI | `Get-Command docker` | "No se encontró Docker. Instalá Docker Desktop: https://www.docker.com/products/docker-desktop/" |
| Daemon | `docker version --format '{{.Server.Version}}'` con código ≠ 0 | "Docker Desktop no está corriendo. Abrilo, esperá a que diga 'Engine running' y volvé a ejecutar." |
| Compose v2 | `docker compose version` | "Falta Docker Compose v2 (docker compose)." |
| Node 22+ (Dev) | `Get-Command node`; mayor de `node -v` ≥ 22 | "Se necesita Node.js 22 o superior (encontrado: vX)." |
| npm (Dev) | `Get-Command npm.cmd` | "No se encontró npm." |

**Puertos:** `Get-NetTCPConnection -State Listen -LocalPort <p> -ErrorAction SilentlyContinue`
(disponible en 5.1 y 7 en Windows, sin permisos de administrador), y nombre del proceso con
`Get-Process -Id OwningProcess`. Un puerto ocupado se considera **propio**, y no es conflicto, si:
- 5433: el servicio `db` de este proyecto está corriendo (`Invoke-Compose ps --status running
  --services` incluye `db`);
- 8080 o 3001 en modo Docker: lo mismo con `backend` o `frontend`.

Si está ocupado y no es propio: error (código 2) con puerto, PID y nombre del proceso. Para 5433
además se busca `docker ps --filter publish=5433 --format '{{.Names}}'`: si es un contenedor de
otro proyecto (por ejemplo el `db` del viejo compose de `backend/`), el mensaje lo nombra y sugiere
`docker stop <nombre>`. Se aborta en lugar de solo avisar porque continuar produce errores confusos
(EADDRINUSE, o Next eligiendo otro puerto). Si `Get-NetTCPConnection` no está disponible, se cae a un
intento de conexión con `System.Net.Sockets.TcpClient`, sin identificar el proceso.

#### 2.3.3 `npm install` condicional

Por cada carpeta (`backend`, `frontend`), sello en `node_modules\.dev-ps1-lock.sha256` con el SHA-256
(`Get-FileHash`) de `package-lock.json`. El sello vive dentro de `node_modules`: si se borra la
carpeta, se invalida solo, y no hace falta tocar `.gitignore`.

- Instalar si: no existe `node_modules`, o el sello no coincide con el hash actual.
- Sello ausente con `node_modules` presente (primera vez con el script en esta máquina): si
  `node_modules\.package-lock.json`, que npm actualiza en cada instalación, es más nuevo que
  `package-lock.json`, se considera al día y solo se escribe el sello. Si no, se instala. Así no se
  dispara un `npm install` innecesario que podría reescribir el lockfile.
- Comando: `npm.cmd install --legacy-peer-deps` en `backend/` y `npm.cmd install` en `frontend/`
  (los mismos que sus Dockerfiles). El sello se escribe **después** de instalar, con el hash del lock
  resultante. Si falla: código 4 y la pista "revisá la salida de npm; probá borrar node_modules".

#### 2.3.4 Lanzar y detener backend y frontend

**Lanzamiento (`Start-DevWindow`):**
```powershell
$exe = (Get-Process -Id $PID).Path        # powershell.exe en 5.1, pwsh.exe en 7
$cmd = "`$Host.UI.RawUI.WindowTitle = 'Solidus backend (dev.ps1)'; " +
       "Set-Location -LiteralPath '<ruta con comillas simples duplicadas>'; npm.cmd run start:dev"
$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
$p = Start-Process -FilePath $exe -ArgumentList '-NoProfile','-NoExit','-EncodedCommand',$enc -PassThru
```
- `-EncodedCommand` evita los problemas de comillas de `-ArgumentList` en 5.1 con rutas con espacios.
- `-NoExit`: la ventana queda abierta con el log si el proceso cae. `-NoProfile`: la ventana hereda el
  `PATH` del script, así que no hace falta el perfil.
- Ninguna variable secreta se pasa por línea de comandos ni por entorno: el backend lee
  `backend/.env`.

**Archivo de PIDs:** `.dev/processes.json` (carpeta `.dev/` en la raíz, ignorada). Por proceso:
`name`, `pid` y `startTime` (ticks de `Process.StartTime`). Se escribe apenas se lanza cada ventana,
de forma atómica (archivo temporal y `Move-Item -Force`), para que `-Stop` funcione aunque el script
se interrumpa después. Un PID se considera vivo solo si existe, el nombre del proceso es
`powershell` o `pwsh` y su `StartTime` coincide (protege contra reutilización de PID).

**Espera de salud (`Wait-Http`):** `Invoke-WebRequest -UseBasicParsing -TimeoutSec 5` cada 2 s
hasta recibir 200 o agotar el timeout. Cualquier excepción cuenta como "todavía no". Si vence, error
código 5: "El backend no respondió en 180 s. Revisá la ventana 'Solidus backend (dev.ps1)'. Causas
comunes: JWT_SECRET inválido, la base no acepta las credenciales, puerto ocupado."

**Detener (`-Stop`, código 0 salvo error inesperado):**
1. Por cada proceso vivo del archivo de PIDs: `taskkill.exe /PID <pid> /T /F`, con la salida
   descartada. `/T` mata el árbol (ventana → `cmd` de npm → node); `Stop-Process` dejaría vivos los
   procesos node hijos. Después se borra el archivo.
2. Si 8080 o 3000 siguen ocupados por procesos que no lanzó el script, se informa sin matarlos.
3. Si el daemon de Docker responde: `Invoke-Compose stop` (detiene `db` y, si estaban, `backend` y
   `frontend`). **Nunca** `down -v` ni `volume rm`: los contenedores y los volúmenes quedan.
4. Mensaje final: "Listo. Se detuvieron N procesos y los contenedores. Los datos de la base se
   conservan."

#### 2.3.5 Espera de Postgres

`Invoke-Compose exec -T db pg_isready -h 127.0.0.1 -U <POSTGRES_USER> -d <POSTGRES_DB>` cada 2 s,
hasta 60 s. Se usa `-h 127.0.0.1` (TCP) a propósito: durante la primera inicialización de un volumen,
el entrypoint de la imagen levanta un servidor temporal **solo por socket**. Un `pg_isready` por
socket daría "listo" antes del reinicio final y `migrate deploy` podría fallar. Usuario y base no son
secretos. Si vence el tiempo: código 3, con la pista `docker compose logs db`.

Errores de `prisma migrate deploy` o `generate`: código 3. Pistas: P1000 (autenticación) → "las
credenciales de .env no coinciden con las del volumen; ver el aviso de migración y
backend\.env.pre-003.bak"; EPERM en `generate` → "cerrá procesos node del backend y reintentá".

#### 2.3.6 Manejo de errores y códigos de salida

- Helper `Invoke-Native -FilePath -ArgumentList -WorkingDirectory -Step -Hint -ExitCode`: dentro fija
  `$ErrorActionPreference = 'Continue'` (en 5.1, la salida de error de un comando nativo combinada con
  `Stop` y `2>&1` genera `NativeCommandError`; docker y npm escriben progreso en stderr), deja la
  salida ir a la consola y evalúa `$LASTEXITCODE`. Cuando hay que capturar la salida (por ejemplo
  `docker version`), lo hace sin `2>&1` o descartando stderr.
- Los errores se lanzan con
  `$e = New-Object System.Exception $msg; $e.Data['ExitCode'] = $code; $e.Data['Hint'] = $hint; throw $e`.
- `dev.ps1` envuelve todo en `try { ... } catch { ... } finally { Pop-Location }`: imprime
  `ERROR: <qué falló>` en rojo y `Cómo resolverlo: <pista>` en amarillo, y termina con `exit <código>`.
  Un error no previsto sale con código 1 y el mensaje de la excepción (los mensajes propios nunca
  contienen valores de los `.env`).

| Código | Significado |
|---|---|
| 0 | OK, incluso si el usuario canceló los seeds o se salteó el login de humo |
| 1 | Configuración inválida (`.env`, plantilla faltante, `compose config`) o error inesperado |
| 2 | Prerrequisito faltante o puerto ocupado |
| 3 | Base de datos: Postgres no responde, `migrate deploy` o `generate` fallaron |
| 4 | `npm install` falló |
| 5 | Backend o frontend no respondieron a tiempo |
| 6 | Un seed falló |
| 7 | La prueba de humo falló |

**Mensajes:** en español, con prefijos `==>` (paso), `OK`, `Aviso:` y `ERROR:`, vía `Write-Host`
con colores. Nunca imprimen valores de variables, solo nombres. No usar `Start-Transcript` ni
`Write-Verbose` con datos.

### 2.4 Seeds seguros (criterio 13)

- **Solo con `-Seed`**. Plan fijo, en el orden de `COMANDOS.md`: `truncate.sql` → `seed.sql` →
  `seed_test_users.sql`, buscados en la raíz. `seed_activities.sql` y `seed_psicolsa.sql` **no** se
  cargan (no están en el orden documentado, son destructivos y tienen datos personales reales, S6);
  si existen se informa "No se cargan automáticamente: … (aplicar a mano, ver COMANDOS.md)".
- **Archivos faltantes:** se verifican antes de tocar la base. Si no existe ninguno: "No hay seeds
  locales (en un clon nuevo no vienen; ver COMANDOS.md). Se continúa sin datos." y sigue el arranque.
  Si faltan algunos, se nombran y se sigue con los que existen.
- **Destructivo:** se detecta por contenido, no por nombre:
  `Select-String -Path <archivo> -Pattern '\b(TRUNCATE|DELETE\s+FROM|DROP\s+(TABLE|SCHEMA|DATABASE))\b' -Quiet`
  (no muestra el contenido). Hoy da verdadero para `truncate.sql`.
- **Base con datos:** la consulta va por **stdin** (no como argumento: PowerShell anterior a 7.3
  rompe las comillas dobles en argumentos nativos):
  ```powershell
  'SELECT (SELECT count(*) FROM "User") + (SELECT count(*) FROM "Organization") + (SELECT count(*) FROM "Patient") + (SELECT count(*) FROM "WorkItem");' |
    docker compose -f <raíz>\docker-compose.yml exec -T db psql -U <user> -d <db> -tA -v ON_ERROR_STOP=1
  ```
  `psql` dentro del contenedor entra por socket local sin contraseña (configuración de la imagen
  oficial), igual que el procedimiento documentado. Si la consulta falla: error código 6 (la base
  debería estar migrada en este punto).
- **Confirmación interactiva** (solo si el total es mayor que 0):
  - Si el plan tiene un seed destructivo: "La base local tiene datos (N filas en tablas principales).
    Se va a ejecutar truncate.sql, que BORRA TODOS LOS DATOS de la base local. No se puede deshacer."
    y `Read-Host "Escribí BORRAR para continuar (cualquier otra respuesta cancela)"`. Solo `BORRAR`,
    exacto, continúa.
  - Si no hay destructivos, pero la base tiene datos: "Los seeds pueden fallar por duplicados" y
    `Read-Host "¿Continuar? (s/N)"`.
  - Sin consola interactiva (`[Console]::IsInputRedirected` o `-not [Environment]::UserInteractive`):
    se cancela sin preguntar.
  - Cancelar: "Seeds cancelados. No se modificó la base." y el arranque continúa (código 0).
- **Ejecución**, por archivo, byte a byte y sin pasar por la codificación de PowerShell (en 5.1,
  `Get-Content | docker` convierte las tildes en `?`):
  `Invoke-Compose cp <archivo> db:/tmp/<nombre>` →
  `Invoke-Compose exec -T db psql -U <user> -d <db> -q -v ON_ERROR_STOP=1 -f /tmp/<nombre>` →
  `Invoke-Compose exec -T db rm -f /tmp/<nombre>` (también si falló). Si `psql` falla: código 6,
  indicando en qué archivo se cortó y que la base puede haber quedado a medias (por ejemplo, después
  del `TRUNCATE`).
- **Solo base local (regla 10):** la función no recibe host ni URL. Solo opera vía
  `docker compose exec` sobre el servicio `db` del compose de la raíz, y antes verifica que ese
  servicio esté corriendo.

### 2.5 Prueba de humo (criterio 14)

`.\dev.ps1 -Smoke`. No sincroniza archivos ni levanta nada. Solo lee `.env` raíz (si no existe:
"No existe .env; ejecutá .\dev.ps1 primero", código 1).

1. **Backend:** `GET http://localhost:8080/` (Swagger UI) → 200.
2. **Frontend:** puerto 3001 si `Invoke-Compose ps --status running --services` incluye `frontend`;
   si no, 3000. `GET http://localhost:<puerto>/login` → 200 (ruta pública del middleware).
3. **Login:** si `SMOKE_USER` o `SMOKE_PASSWORD` están vacíos o con `change-me`: "Aviso: SMOKE_USER y
   SMOKE_PASSWORD no están definidos en .env; se saltea la prueba de login." Si están definidos:
   ```powershell
   $json  = @{ user = $smokeUser; password = $smokePassword } | ConvertTo-Json -Compress
   $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)   # en 5.1, un string se envía como ISO-8859-1
   $resp  = Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/api/v1/auth/login' `
              -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 15
   ```
   OK si `$resp.PSObject.Properties['token']` existe y no está vacío. Se imprime "Login OK" sin el
   usuario, el token ni la respuesta. Si falla, se imprime solo el código HTTP
   (`[int]$_.Exception.Response.StatusCode`, válido en 5.1 y 7) y una pista: 401 → "revisá
   SMOKE_USER/SMOKE_PASSWORD en .env o cargá los usuarios de prueba"; sin respuesta → "backend caído".
   Después se ponen en `$null` `$json`, `$bytes`, `$resp` y la contraseña.
4. Resumen `Backend OK · Frontend OK · Login OK|saltado`. Código 0, o 7 si algo falló (el login
   salteado no es falla).

**No escribe en la base:** las dos primeras son lecturas de páginas estáticas. El login solo lee
(`findUnique` y `findFirst`, verificado en `login-query-handler.ts`). No se llama a `logout` ni a
endpoints autenticados.

**Limitación conocida (preexistente, BACKLOG ítem 7):** `LoggingInterceptor` imprime en debug el
body (con la contraseña) y la respuesta (con el token) en la ventana del backend, o en
`docker compose logs backend` en modo Docker. El script no los muestra, pero el log del backend sí,
igual que con cualquier login desde el navegador. Corregirlo cambia código del backend y queda fuera
de este feature.

### 2.6 `.gitignore` y documentación

**`.gitignore` raíz:** agregar
```gitignore
# --- Estado local de dev.ps1 (PIDs) ---
.dev/
```
Ya cubiertos (no tocar; el tester lo verifica con `git check-ignore -v`): `.env`, `backend/.env`,
`backend/.env.pre-003.bak` (`.env.*`), `frontend/.env.local` (`.env.*` en la raíz y `.env*` en
`frontend/`). `frontend/.env.example` queda incluido por `!.env.example` en `frontend/.gitignore`.
Los sellos de npm están dentro de `node_modules/` (ignorado). `.dockerignore`: sin cambios.

**Documentación (documentador; criterio 17):**
- `.claude/CLAUDE.md`, sección Credenciales: una sola fuente (`.env` raíz); `backend/.env` es
  generado; plantillas `.env.example`, `backend/.env.example` (referencia) y `frontend/.env.example`.
  Sección Comandos: arranque rápido (`.\dev.ps1`, `-Docker`, `-Stop`, `-Seed`, `-Smoke`, `-Init`),
  ExecutionPolicy, quitar "lee `backend/.env`" del `docker compose up -d` en `backend/`.
- `docs/auditoria/COMANDOS.md`: nueva sección 0 "Arranque rápido" con la tabla de flags y códigos de
  salida, qué archivo editar (`.env` raíz y nunca `backend/.env`), "si cambiás `.env`, corré
  `.\dev.ps1 -Init`", `powershell -ExecutionPolicy Bypass -File .\dev.ps1` y `Unblock-File .\dev.ps1,
  .\scripts\*.ps1`, `pwsh -File .\dev.ps1`. Errores comunes: Docker apagado, puerto ocupado (incluido
  el contenedor viejo de `backend/`), P1000 por volumen con otra contraseña, EPERM de Prisma, fuentes
  de Google en el build Docker. Actualizar §1 (ya no se copia `backend/.env.example`), §2 (base con el
  compose raíz `docker compose up -d db`), §3, §4 (defaults de `INTERNAL_API_URL`), §5 (sin IP fija:
  `NEXT_PUBLIC_API_BASE_URL` en `.env`) y seeds (`.\dev.ps1 -Seed`, `docker compose exec -T db` en vez
  del nombre de contenedor fijo). Mencionar que el volumen `backend_postgres_data` quedó huérfano si
  existe, y cómo borrarlo solo si el usuario lo decide.
- `docs/auditoria/ARQUITECTURA.md` §5: sin IP de LAN, desarrollo local con `dev.ps1` y la base del
  compose raíz, `backend/.env` generado.
- Quitar la IP de LAN de `COMANDOS.md:123` y `ARQUITECTURA.md:168` (dejan de ser ciertas).

## 3. Archivos

| Archivo | Acción |
|---|---|
| `dev.ps1` | Crear (UTF-8 con BOM) |
| `scripts/dev-lib.ps1` | Crear (UTF-8 con BOM) |
| `scripts/dev-lib.tests.ps1` | Crear (UTF-8 con BOM) |
| `docker-compose.yml` | Modificar: sin `version`, sin `CORS_ORIGIN`, build arg parametrizado, `db` con `restart: unless-stopped` |
| `backend/docker-compose.yml` | **Eliminar** (después del paso 0) |
| `.env.example` | Modificar (variables nuevas y comentarios) |
| `backend/.env.example` | Reescribir (referencia; sin `POSTGRES_*`) |
| `frontend/.env.example` | Crear |
| `frontend/src/services/data.ts` | Modificar línea 4 (default SSR `localhost`) y agregar comentario |
| `.gitignore` | Agregar `.dev/` |
| `.claude/CLAUDE.md`, `docs/auditoria/COMANDOS.md`, `docs/auditoria/ARQUITECTURA.md` | Documentador |
| Locales, por el script (no versionados) | `.env` (se agregan variables), `backend/.env` (regenerado), `backend/.env.pre-003.bak`, `.dev/processes.json`, `node_modules/.dev-ps1-lock.sha256` |

Sin cambios: código del backend, `schema.prisma` (no hay migraciones), Dockerfiles, `.dockerignore`,
`next.config.ts`, `login/page.tsx` (su default ya es correcto), `.claude/launch.json`.
**Contratos de API y modelo de datos: sin cambios.**

## 4. Estrategia de tests

**Unitarios (`scripts/dev-lib.tests.ps1`, sin Pester).** Windows trae Pester 3.4, cuya sintaxis es
incompatible con Pester 5. Se usa un runner mínimo propio (`Assert-Equal`, `Assert-True`, contador de
fallos, `exit 1` si hay alguno). Todo corre en carpetas nuevas bajo `$env:TEMP` con valores
**ficticios**, y se limpian al final. Ejecutar con
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-lib.tests.ps1` (y con `pwsh` si
está disponible). Casos:
- `Read-DotEnv`: comillas, comentarios, BOM, `=` dentro del valor, líneas vacías, CRLF.
- `New-RandomHex`: largo `2*n`, solo `[0-9a-f]`, dos llamadas distintas.
- `Build-DatabaseUrl`: escape de `@ : / % $ #` y espacio; host y puerto fijos.
- `Initialize-RootEnv`: crea desde la plantilla (sin `change-me` en usuario, contraseña ni JWT;
  JWT de 64 caracteres; contraseña de 48); segunda ejecución sin cambios (mismo hash); con `.env`
  existente agrega solo las faltantes y el prefijo queda byte a byte igual; error si falta
  `POSTGRES_PASSWORD`; genera `JWT_SECRET` si falta; error si es corto; archivo sin BOM.
- `Sync-BackendEnv`: casos 1 a 4 de 2.1. Conserva claves locales, elimina `POSTGRES_*`, respeta
  `NODE_ENV`/`APP_NAME`/`PORT` existentes, crea `.env.pre-003.bak` una sola vez, avisos con nombres
  y **sin valores** (se verifica que ningún valor ficticio aparezca en los avisos), no reescribe si
  no hay cambios.
- Seeds: plan ordenado con archivos faltantes, exclusión de `seed_activities`/`seed_psicolsa`,
  detección de destructivos con archivos ficticios (`TRUNCATE`, `delete from`, solo `INSERT`).
- Smoke: `SMOKE_*` vacío o `change-me` → se saltea.
- `Test-DevProcessAlive`: PID inexistente y `StartTime` distinto → no vivo.

**Estáticos:** `[System.Management.Automation.Language.Parser]::ParseFile` sin errores para los tres
`.ps1` en 5.1 (y en 7 si está). BOM presente. `Invoke-ScriptAnalyzer` solo si está instalado
(opcional). `grep` en los `.ps1` sin `??`, `?.`, `-AsHashtable` ni `::Fill(`.

**Calidad (criterio 16):** `npx tsc --noEmit` en `frontend/` y `backend/`; `npm run lint` del
frontend sin errores nuevos en `data.ts`; `docker compose config --quiet` código 0; prueba negativa
con `--env-file` vacío fuera del repo (sigue fallando con los mensajes de `:?`).

## 5. Plan de pruebas del tester (criterio 15)

Restricciones: no leer ni imprimir valores de `.env`/`backend/.env` (comparaciones solo en memoria
o por hash). No cargar seeds contra la base real. Nunca `down -v`. Salida de los comandos capturada,
si hace falta, en el scratchpad de la sesión, y borrada al terminar.

**A. Línea base (Docker encendido, antes de la primera ejecución real):**
1. SHA-256 de `.env` y `backend/.env`; nombres de variables de cada uno.
2. `docker volume ls --format '{{.Name}}'` (solo los volúmenes del proyecto).
3. Conteo de filas de solo lectura de `User`, `Organization`, `Patient` y `WorkItem` (con la base que
   use hoy, por `docker compose exec -T db psql ... -tA` con la consulta por stdin).
4. `npx prisma migrate status` en `backend/` (solo lectura): si hay migraciones pendientes, avisar
   al PO antes de seguir, porque `.\dev.ps1` las aplicaría.
5. El usuario completa `SMOKE_USER` y `SMOKE_PASSWORD` en `.env` si quiere probar el login. El
   tester no los escribe.

**B. Esta máquina, modo desarrollo** (Windows PowerShell 5.1; requiere el OK del PO, porque es la
primera vez que el script modifica `.env` y `backend/.env`, regla 2):
1. `.\dev.ps1` → código 0. Avisos de migración solo con nombres. Existe `backend/.env.pre-003.bak`.
   `backend/.env` empieza con la cabecera de generado y no contiene `POSTGRES_*`. Conserva
   `NODE_TLS_REJECT_UNAUTHORIZED`, `CORS_ORIGIN` y `CORS_METHODS` (por nombre). El `.env` nuevo
   empieza con los bytes exactos del anterior (hash del prefijo = hash de la línea base) y solo
   agrega `NEXT_PUBLIC_API_BASE_URL`, `SMOKE_USER` y `SMOKE_PASSWORD`.
2. Se abren dos ventanas. URLs mostradas. `http://localhost:8080/` responde 200.
3. **SSR:** login en `http://localhost:3000` desde el navegador y carga del dashboard con datos. En la
   ventana del frontend no aparece `ENOTFOUND backend` ni `ECONNREFUSED`.
4. `.\dev.ps1 -Smoke` → Backend OK, Frontend OK (3000), Login OK o saltado. Código 0.
5. Segunda ejecución de `.\dev.ps1` → "ya está levantado" y no abre ventanas nuevas.
6. `.\dev.ps1 -Seed` con base con datos → aparece la advertencia; responder `no` → "Seeds
   cancelados". Conteos iguales a A.3. Repetir con la entrada redirigida → cancela sin preguntar.
7. `.\dev.ps1 -Stop` → ventanas y node cerrados, 8080/3000 libres, `db` detenido (`ps -a` lo
   muestra `Exited`), mismos volúmenes que en A.2.
8. Conteos iguales a A.3. `git status`: solo los archivos esperados (sección 3). `git check-ignore -v`
   para `.env`, `backend/.env`, `backend/.env.pre-003.bak`, `.dev/processes.json` y
   `frontend/.env.local`.
9. Captura de toda la salida de 1 a 7: buscar en memoria los valores de `POSTGRES_PASSWORD`,
   `JWT_SECRET` y `SMOKE_PASSWORD` (leídos sin imprimir) → 0 coincidencias.

**C. Esta máquina, modo Docker:**
1. Con el modo desarrollo levantado, `.\dev.ps1 -Docker` → error de puerto o "detené primero" (código 2).
2. `.\dev.ps1 -Stop` y luego `.\dev.ps1 -Docker` → código 0 y URL `http://localhost:3001`. Si el
   build falla por Google Fonts (TLS), registrarlo como preexistente.
3. `.\dev.ps1 -Smoke` → frontend en 3001. Login en el navegador en 3001.
4. `docker compose config --quiet` → 0. En `docker compose config` sin interpolar (no ejecutar sin
   `--quiet`), la inspección del archivo muestra que no hay IP de LAN (`git grep -n "192\.168\."` vacío
   salvo en `docs/features/`).
5. `.\dev.ps1 -Stop` → contenedores `Exited`, volúmenes intactos.

**D. Clon nuevo simulado (sin tocar la base real):**
1. Copiar a `%TEMP%\solidus-clone-003` los archivos versionados y nuevos no ignorados:
   `git ls-files -co --exclude-standard`, copiando cada ruta y creando las carpetas. Así se incluyen
   los cambios sin commitear y se excluyen `.env`, seeds y `node_modules`. Verificar que no existan
   `.env` ni `backend/.env`.
2. `powershell -NoProfile -ExecutionPolicy Bypass -File <clon>\dev.ps1 -Init` → código 0. Crea
   `.env` (sin `change-me` en usuario, contraseña ni JWT; JWT de 64+ caracteres y contraseña de 48,
   midiendo solo largos) y `backend/.env` generado con `DATABASE_URL` hacia `localhost:5433`
   (verificar el host sin imprimir la URL). Ningún valor aparece en la salida. `docker compose
   config --quiet` en el clon da 0.
3. Segunda ejecución de `-Init`: hashes sin cambios.
4. Borrar `SMOKE_USER` del `.env` del clon y volver a ejecutar `-Init` → se vuelve a agregar y el
   resto queda igual.
5. `-Smoke` en el clon sin nada levantado → código 7 con mensajes claros.
6. **No** ejecutar `.\dev.ps1` completo en el clon. Usaría el proyecto `solidus-clone-003` con su
   propio volumen nuevo y competiría por el puerto 5433. Solo si el PO lo pide, con el stack real
   detenido, y limpiando después únicamente ese proyecto
   (`docker compose -p solidus-clone-003 down -v`, verificando el nombre antes).
7. Borrar la carpeta del clon (contiene secretos generados de prueba).

**E. PowerShell 7:** `pwsh` no está instalado en esta máquina. Si el usuario autoriza instalarlo
(`winget install Microsoft.PowerShell`), repetir B.1, B.4, B.7 y D.2 con `pwsh -File`. Si no, dejar
el criterio "compatible con 7" verificado solo de forma estática (parser y lista de construcciones
prohibidas) y marcarlo así en el informe.

## 6. Plan de implementación (pasos chicos)

0. **Puerta previa (con Docker encendido, solo lectura):** listar los volúmenes
   `healthops-gem_solidus_postgres_data` y `backend_postgres_data`, y qué contenedores los usan
   (`docker ps -a --filter volume=<nombre>`). Si existen los dos, contar filas de solo lectura en
   cada uno, levantándolos de a uno con su compose actual, antes de borrar `backend/docker-compose.yml`.
   - Si el volumen raíz tiene los datos de trabajo (o ninguno tiene datos): seguir.
   - Si **solo** `backend_postgres_data` tiene los datos de trabajo: frenar y que el PO consulte al
     usuario (R-1). No mover datos sin decisión.
   Informar solo nombres y conteos.
1. `docker-compose.yml`: los cuatro cambios de 2.2. Validar `docker compose config --quiet` y la
   prueba negativa.
2. Plantillas: `.env.example`, `backend/.env.example`, `frontend/.env.example`.
3. `frontend/src/services/data.ts`: default SSR. `npx tsc --noEmit` y lint del frontend.
4. `.gitignore`: `.dev/`.
5. `scripts/dev-lib.ps1` (configuración): `Read-DotEnv`, `New-RandomHex`, `Write-Utf8NoBom`,
   `Build-DatabaseUrl`, `Initialize-RootEnv`, `Test-RootEnv`, `Sync-BackendEnv`. Junto con sus tests
   en `scripts/dev-lib.tests.ps1`. Correr los tests.
6. `dev.ps1`: parámetros, `try/catch`, códigos de salida, carga de la biblioteca y flujo `-Init`.
   Probar **solo en una copia temporal** (5.D), no en la raíz.
7. Prerrequisitos y puertos; `Update-NodeModules` con sello; tests de las partes puras.
8. Base: `Invoke-Compose`, `Invoke-Native`, `Wait-Postgres`, migrate y generate.
9. Ventanas, archivo de PIDs, `Wait-Http`, resumen; `-Stop`.
10. `-Docker`.
11. Seeds: plan, detección, conteo, confirmación, ejecución con `cp` + `psql -f`. Tests de las partes puras.
12. `-Smoke`.
13. Eliminar `backend/docker-compose.yml` (según el paso 0).
14. Convertir los `.ps1` a UTF-8 con BOM (por ejemplo, releer y reescribir con
    `New-Object System.Text.UTF8Encoding $true`), parser OK y tests OK.
15. Entregar al revisor sin ejecutar `.\dev.ps1` sobre los `.env` reales: la primera ejecución real
    la hace el tester (5.B) con el OK del PO.

## 7. Impacto

- **Rendimiento de la aplicación:** ninguno. Script: primera ejecución dominada por `npm install` y
  la compilación. Las siguientes, unos segundos de `migrate deploy` y `generate`, más el arranque de
  Nest y Next. Sin `npm install` si el lock no cambió.
- **Compatibilidad:**
  - Modo Docker: igual, salvo que desde otro equipo de la red hay que definir
    `NEXT_PUBLIC_API_BASE_URL` con la IP en `.env` (antes estaba fija) y que `CORS_ORIGIN` deja de
    existir en el contenedor (sin efecto, el código lo ignoraba).
  - Modo desarrollo: la base sale del compose raíz (mismo volumen que el modo Docker).
  - Arranque manual (`npm run start:dev`, `launch.json`): sigue funcionando con el `backend/.env`
    generado.
  - `docker compose up -d` desde `backend/` deja de existir.
  - `JWT_SECRET` pasa a ser el mismo en los dos modos.
- **Seguridad:** sin secretos en archivos versionados, en consola ni en líneas de comando. Los
  secretos generados son criptográficamente aleatorios. Seeds con opt-in, confirmación fuerte y solo
  contra el contenedor local. Seguridad debería revisar: el default `POSTGRES_USER=solidus` en el
  script (no es secreto), la conservación de `NODE_TLS_REJECT_UNAUTHORIZED` en el `backend/.env`
  generado (BACKLOG 14) y el respaldo `.env.pre-003.bak` (local e ignorado; contiene los secretos
  viejos).

## 8. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R-1 | **Los datos de desarrollo pueden estar en `backend_postgres_data`** (compose de `backend/`, según `ARQUITECTURA.md`) mientras el script usa el volumen del compose raíz (donde `COMANDOS.md` cargaba los seeds). No se pudo verificar: Docker estaba apagado. | Paso 0 obligatorio. El volumen viejo no se borra nunca. El script, si existe `backend_postgres_data`, avisa en cada ejecución: "Existe el volumen backend_postgres_data del compose viejo de backend/. dev.ps1 usa la base del compose raíz. No se borró nada; ver COMANDOS.md." |
| R-2 | Credenciales distintas entre los dos `.env` (en el 002 el `JWT_SECRET` pudo quedar distinto). | Prioridad del `.env` raíz, aviso con nombres, respaldo, pista ante P1000. |
| R-3 | `.env` editado sin correr el script → `backend/.env` desactualizado. | Cabecera de generado, sincronización en cada ejecución, `-Init` documentado. |
| R-4 | Codificación: BOM en `.env`, tildes en scripts y seeds en 5.1. | Escritura sin BOM con `[IO.File]`; `.ps1` con BOM; seeds por `docker compose cp` + `psql -f`. |
| R-5 | Procesos huérfanos o reutilización de PID. | `taskkill /T`, verificación de nombre y `StartTime`, archivo de PIDs escrito apenas se lanza cada ventana. |
| R-6 | `npm install` reescribe `package-lock.json` (diff no deseado). | Instalación solo si cambió el lock o falta `node_modules`; heurística del lockfile oculto de npm en la primera ejecución. El tester revisa `git status`. |
| R-7 | Contraseña y token en el log del backend al hacer login (preexistente). | Documentado; BACKLOG ítem 7. |
| R-8 | PowerShell 7 no disponible para probar. | Verificación estática y prueba real si el usuario autoriza instalarlo (5.E). |
| R-9 | `ExecutionPolicy` restrictiva o archivos bloqueados. | Documentar `-ExecutionPolicy Bypass` y `Unblock-File`; `npm.cmd` para no depender de `npm.ps1`. |
| R-10 | `.claude/settings.json` se ensucia con permisos aprobados durante la implementación (regla 12). | Revisar `git diff .claude/settings.json` antes de cualquier commit. |

## 9. Puntos para el PO (no bloquean)

1. Resultado del paso 0 (R-1) antes de eliminar `backend/docker-compose.yml`.
2. OK explícito del usuario para que la primera ejecución real modifique `.env` (agregado) y
   `backend/.env` (regenerado con respaldo). Lo pide la spec, pero toca la regla 2.
3. `seed_activities.sql` y `seed_psicolsa.sql` quedan fuera de `-Seed` por no estar en el orden
   documentado (y por S6). Si el usuario los quiere en el flujo, hay que documentar su orden primero.
4. Que el usuario complete `SMOKE_USER`/`SMOKE_PASSWORD` en su `.env` para la prueba de login.

VEREDICTO: APROBADO
