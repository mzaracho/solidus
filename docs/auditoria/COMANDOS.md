# Comandos — instalar, buildear, testear y correr

> Probado en Windows 11 (PowerShell / Git Bash), Node 24.13.0, npm 11.6.2.
> Docker usa Node 22-alpine. Rutas relativas al repo raíz `c:\Repositorios\healthops-gem`.

## 0. Arranque rápido (`dev.ps1`)

Desde la raíz del repo, en Windows PowerShell 5.1 o PowerShell 7:
```powershell
.\dev.ps1
```
Con Docker Desktop encendido, levanta Postgres (compose de la raíz), aplica las migraciones
(`prisma migrate deploy`, nunca `db push`), instala dependencias si cambió el `package-lock.json` y abre dos
ventanas con el backend y el frontend en modo desarrollo. En un clon nuevo crea el `.env` de la raíz desde
`.env.example` con secretos aleatorios (no se muestran) y genera `backend/.env`. Ayuda: `Get-Help .\dev.ps1`.

### Requisitos
- Node.js 22+ y npm.
- Docker Desktop (para PostgreSQL y/o el stack completo), con el daemon local.
- Python 3 + `openpyxl` solo si se regeneran seeds desde Excel.

### Flags
| Comando | Qué hace |
|---|---|
| `.\dev.ps1` | Modo desarrollo: Postgres en Docker; backend (http://localhost:8080/api, Swagger en http://localhost:8080/) y frontend (http://localhost:`FRONTEND_PORT`, 3000 por defecto) con hot reload en dos ventanas |
| `.\dev.ps1 -Docker` | Stack completo con `docker compose up --build -d`; frontend en http://localhost:3001 (puerto fijo). Si hay un modo desarrollo vivo, aborta (código 2): correr `-Stop` antes |
| `.\dev.ps1 -Stop` | Cierra las ventanas que lanzó el script y detiene los contenedores (`docker compose stop`). No usa `down` ni borra volúmenes: los datos se conservan |
| `.\dev.ps1 -Seed` | Con el modo desarrollo o con `-Docker`: carga los seeds locales (`truncate.sql` → `seed.sql` → `seed_test_users.sql`). Si la base puede tener datos pide confirmación (escribir `BORRAR` si hay un seed destructivo; sin consola interactiva cancela). `seed_activities.sql` y `seed_psicolsa.sql` no se cargan solos |
| `.\dev.ps1 -Smoke` | Prueba de humo: backend, frontend y login con `SMOKE_USER`/`SMOKE_PASSWORD` del `.env` (si faltan, saltea el login). No escribe en la base |
| `.\dev.ps1 -Init` | Solo crea o sincroniza los `.env` y valida la configuración; no levanta nada ni necesita el daemon de Docker |

`-Seed` solo se combina con el modo desarrollo o con `-Docker`; las demás combinaciones las rechaza PowerShell.

Si la ExecutionPolicy bloquea el script:
```powershell
powershell -ExecutionPolicy Bypass -File .\dev.ps1          # una sola vez
Unblock-File .\dev.ps1, .\scripts\*.ps1                     # o desbloquearlo
pwsh -File .\dev.ps1                                        # PowerShell 7, si está instalado
```

### Códigos de salida
| Código | Significado |
|---|---|
| 0 | OK (también si se cancelaron los seeds o se salteó el login de humo) |
| 1 | Configuración inválida (`.env`, plantilla faltante, `FRONTEND_PORT` inválido, `compose config`) o error inesperado |
| 2 | Prerrequisito faltante (Docker, Node 22+, npm) o puerto ocupado |
| 3 | Base de datos o build/arranque de compose: Postgres no responde, `migrate deploy` o `generate` fallaron, o `docker compose up` falló |
| 4 | `npm install` falló |
| 5 | El backend o el frontend no respondieron a tiempo |
| 6 | Un seed falló (la base puede haber quedado a medias) |
| 7 | La prueba de humo falló |
| 8 | El daemon de Docker no es local (contexto o `DOCKER_HOST` remotos); se aborta antes de tocar nada |

### Qué archivo editar
- Editar **solo el `.env` de la raíz** (única fuente de credenciales). `backend/.env` lo GENERA `dev.ps1`
  (empieza con `# GENERADO por dev.ps1`): no editarlo.
- Después de cambiar `.env`, correr `.\dev.ps1 -Init` (o cualquier modo, que también sincroniza).
- `dev.ps1` nunca cambia valores existentes del `.env`: solo agrega al final, bajo `# Agregadas por dev.ps1`,
  las variables que falten (`NEXT_PUBLIC_API_BASE_URL`, `SMOKE_USER`, `SMOKE_PASSWORD`, `BIND_ADDRESS`,
  `FRONTEND_PORT`).
- Si `POSTGRES_PASSWORD` tiene menos de 16 caracteres, avisa en cada ejecución; no la cambia. Para rotarla:
  `docker compose exec db psql -U <usuario> -d <base>`, `\password <usuario>`, actualizar `.env` y correr
  `.\dev.ps1 -Init`.

### Variables opcionales del `.env` raíz
- `FRONTEND_PORT` — puerto del frontend en **modo desarrollo**. Default 3000. Entero entre 1024 y 65535,
  distinto de 5433 y 8080; si no, el script termina con código 1 sin imprimir el valor (también en
  `-Docker`, porque la validación es común a todos los modos). No afecta a Docker, que usa 3001.
- `BIND_ADDRESS` — interfaz donde el modo **Docker** publica la API (8080) y el frontend (3001). Default
  `127.0.0.1` (solo esta PC). Postgres (5433) queda siempre en `127.0.0.1`.
  **Aviso:** con `0.0.0.0` la API queda expuesta en la red local con JWT sin verificar (RIESGOS S1) y CORS
  abierto (`origin: true`). Usarlo solo en redes de confianza, y en ese caso poner la IP de la PC en
  `NEXT_PUBLIC_API_BASE_URL` (se hornea al construir) y correr `.\dev.ps1 -Docker`.
- `NEXT_PUBLIC_API_BASE_URL` — URL de la API vista desde el navegador en modo Docker (default
  `http://localhost:8080/api`).
- `SMOKE_USER` / `SMOKE_PASSWORD` — usuario de prueba de la base local para `-Smoke`.

### Errores comunes
| Síntoma | Causa y solución |
|---|---|
| "Docker Desktop no esta corriendo" (código 2) | Abrir Docker Desktop, esperar "Engine running" y repetir |
| Puerto ocupado (código 2) | El mensaje indica puerto, PID y proceso. Si el 3000 lo usa otro proyecto: definir `FRONTEND_PORT` (por ejemplo 3002) en `.env`. Para 8080 o 5433, liberar el proceso |
| 5433 ocupado por un contenedor de otro proyecto | Típico: el `db` del viejo compose de `backend/` (que ya no existe). El mensaje nombra el contenedor; detenerlo con `docker stop <nombre>` |
| `P1000` en `migrate deploy` (código 3) | El volumen de Postgres se inicializó con otra contraseña distinta de la del `.env`. Revisar el aviso de migración y `backend/.env.pre-003*.bak`; no se borra el volumen automáticamente |
| `EPERM` en `prisma generate` (código 3) | Hay un backend con el motor de Prisma abierto. Cerrar los procesos node del backend (`.\dev.ps1 -Stop`) y repetir |
| `FRONTEND_PORT` inválido (código 1) | También aborta `-Docker`. Corregir el valor o quitarlo |
| `docker compose up --build` falla en `apk add` por "TLS: server certificate not trusted" (código 3) | Red o antivirus con inspección TLS. Es del entorno (se reproduce con `docker run --rm node:22-alpine apk add libc6-compat`); probar en otra red o instalar el certificado raíz. `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS` no ayuda (aplica a Next, no a `apk`) |
| Código 8 | `DOCKER_HOST` o el contexto activo apuntan a un daemon remoto. Usar el Docker Desktop local (`docker context use default`, quitar `DOCKER_HOST`). `-Stop` solo avisa y no toca contenedores |
| Código 7 en `-Smoke` | No hay nada levantado o el login falló (revisar `SMOKE_USER`/`SMOKE_PASSWORD`) |

### Archivos locales que deja `dev.ps1` (todos ignorados por git)
- `.dev/processes.json`: PIDs de las ventanas lanzadas (lo usa `-Stop`).
- `backend/.env.pre-003.bak` (y `backend/.env.pre-003.<fecha>.bak` si ya existía): copia del `backend/.env`
  anterior a la migración. **Contiene credenciales viejas**: borrarlo cuando todo funcione. Los comentarios y
  líneas no parseables de ese archivo no se migraron; solo quedan ahí.
- `node_modules/.dev-ps1-lock.sha256`: sello para saltear `npm install` si el lock no cambió.

### Volumen huérfano `backend_postgres_data`
El viejo `backend/docker-compose.yml` (eliminado en el 003) usaba el volumen `backend_postgres_data`. Si existe,
queda sin contenedor y **no se borra solo**: los datos de trabajo están en `healthops-gem_solidus_postgres_data`
(compose de la raíz) y `dev.ps1` avisa del huérfano en cada ejecución. Solo si el usuario decide descartarlo:
```powershell
docker volume ls --format '{{.Name}}'      # confirmar el nombre
docker volume rm backend_postgres_data     # IRREVERSIBLE; falla si algún contenedor lo usa
```
Nunca borrar `healthops-gem_solidus_postgres_data` ni usar `docker compose down -v`.

Más abajo (secciones 1 a 7) está el procedimiento manual, sin `dev.ps1`.

## 1. Obtener el código
Hay un único repo git; `backend/` y `frontend/` son carpetas comunes (no submódulos):
```bash
git clone https://github.com/mzaracho/solidus.git
cd solidus
```

### Variables de entorno (obligatorio antes de levantar nada)
Las credenciales no se versionan. Con `dev.ps1` (sección 0) no hay que copiar nada: `.\dev.ps1 -Init` crea el
`.env` de la raíz (secretos aleatorios) y genera `backend/.env`.

Sin `dev.ps1` (por ejemplo macOS o Linux): copiar `.env.example` a `.env` (raíz, lo lee docker compose) y
`backend/.env.example` a `backend/.env` (referencia: Nest y Prisma), y completar los valores a mano.
- Reemplazar todos los `change-me`. `POSTGRES_*` del `.env` raíz deben coincidir con el usuario, contraseña
  y base de `DATABASE_URL` en `backend/.env`.
- `JWT_SECRET` es obligatorio y debe tener 32 caracteres o más; el backend no arranca sin él.
  Generarlo con: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- El compose falla con un mensaje claro si falta una variable (`${VAR:?mensaje}`).
- `frontend/.env.example` (opcional): copiarlo a `frontend/.env.local` solo para cambiar las URLs de la API en
  `npm run dev`.

## 2. Base de datos (desarrollo local)
La base es el servicio `db` del compose de la raíz (ya no existe `backend/docker-compose.yml`); los modos
desarrollo y Docker comparten la misma base.
```bash
docker compose up -d db       # (raíz) postgres:16 en 127.0.0.1:5433; credenciales del .env de la raíz
cd backend
npx prisma migrate deploy     # aplica migraciones (el README dice "db push": no usar)
npx prisma generate           # regenera el cliente si cambió el schema
```
`backend/.env` debe existir (lo genera `.\dev.ps1 -Init`).
Para crear una migración nueva tras editar `prisma/schema.prisma`:
```bash
npx prisma migrate dev --name <descripcion>
```

### Seeds (SQL en la raíz)
Recomendado: `.\dev.ps1 -Seed` (o `.\dev.ps1 -Docker -Seed`). Aplica `truncate.sql` → `seed.sql` →
`seed_test_users.sql`, copia cada archivo al contenedor (sin pasar por la codificación de PowerShell) y pide
confirmación si la base puede tener datos. Solo opera sobre el `db` del compose local.

A mano, desde la raíz, con el servicio `db` (sin depender del nombre del contenedor; `<usuario>` y `<base>`
son `POSTGRES_USER` y `POSTGRES_DB` del `.env`):
```powershell
Get-Content truncate.sql        | docker compose exec -T db psql -U <usuario> -d <base>
Get-Content seed.sql            | docker compose exec -T db psql -U <usuario> -d <base>
Get-Content seed_test_users.sql | docker compose exec -T db psql -U <usuario> -d <base>
```
(En Windows PowerShell 5.1, `Get-Content | docker` puede alterar las tildes; `dev.ps1 -Seed` no tiene ese problema.)
`truncate.sql` y `seed_psicolsa.sql` hacen `TRUNCATE ... CASCADE` de todas las tablas.
`prisma/seed.ts` está deprecado (solo imprime un aviso).

> **Nota — archivos locales, no versionados:** los seeds (`seed*.sql`, `truncate.sql`) y los
> scripts generadores (`generate_seed*.py`) son locales y no se versionan (están en `.gitignore`).
> En un clon nuevo **no van a estar**: hay que obtenerlos por otro canal o regenerarlos.
> Las planillas de origen (`*.xlsx`, `*.xls`) y las exportaciones (`*.csv`, `*.dump`, `*.backup`)
> también están ignoradas. `backend/prisma/seed.ts` y las migraciones sí se versionan.

## 3. Backend (`backend/`)
```bash
npm install
# backend/.env necesario (no versionado; lo genera .\dev.ps1, no editar). Variables usadas:
#   NODE_ENV, APP_NAME (obligatorias: el Logger lanza error si faltan)
#   PORT=8080
#   DATABASE_URL="postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5433/solidus_db?schema=public"
#   JWT_SECRET=<obligatorio, mínimo 32 caracteres; el backend no arranca sin él>
#   (POSTGRES_* ya no van en backend/.env: viven solo en el .env de la raíz)
#   BODY_SIZE_LIMIT (opcional, default 50mb)
#   CORS_ORIGIN / CORS_METHODS (hoy ignoradas por el código)

npm run start:dev     # nest start --watch  -> http://localhost:8080/api ; Swagger en http://localhost:8080/
npm run build         # tsc --noEmit && nest build  (reescribe dist/)
npm run start:prod    # node dist/src/api/main.js
```

### Calidad
```bash
npx tsc --noEmit                              # type-check (hoy: OK)
npx eslint "{src,apps,libs,test}/**/*.ts"     # lint SIN modificar archivos (hoy: 768 errores)
npm run lint                                  # OJO: incluye --fix, reescribe archivos
npm run format                                # prettier --write sobre src/ y test/
```

### Tests
```bash
npm test              # jest (hoy: solo jwt-config.spec.ts)
npm run test:cov      # cobertura en backend/coverage
npm run test:e2e      # requiere DB; el único e2e es boilerplate roto
```

## 4. Frontend (`frontend/`)
```bash
npm install
# Variables:
#   NEXT_PUBLIC_API_BASE_URL  URL del backend vista desde el navegador (default http://localhost:8080/api)
#   INTERNAL_API_URL          URL del backend para SSR/rewrites (default http://localhost:8080/api tanto en
#                             rewrites como en services/data.ts; en Docker lo define docker-compose.yml
#                             como http://backend:8080/api)
# Ambas pueden sobrescribirse en frontend/.env.local (ver frontend/.env.example).

npm run dev           # next dev -> http://localhost:3000 (dev.ps1 usa `-p $FRONTEND_PORT`)
npm run build         # next build
npm run start         # next start (requiere build previo)
npx tsc --noEmit      # type-check (hoy: OK)
npm run lint          # eslint (sin --fix; hoy: 133 errores)
```
Si `next build` falla con `Failed to fetch 'Inter' from Google Fonts` (error TLS en esta máquina):
```powershell
$env:NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS = "1"; npm run build
```
```bash
NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 npm run build
```

No hay comando de tests en el frontend.

## 5. Stack completo con Docker (raíz)
```bash
# requiere el .env de la raíz (ver sección 1); sin POSTGRES_* o JWT_SECRET falla con un mensaje claro
docker compose up --build -d
# db:       localhost:5433
# backend:  localhost:8080 (corre prisma migrate deploy al iniciar)
# frontend: localhost:3001
```
Equivalente: `.\dev.ps1 -Docker`. Los puertos se publican en `${BIND_ADDRESS:-127.0.0.1}` (Postgres siempre en
`127.0.0.1`). `NEXT_PUBLIC_API_BASE_URL` sale del `.env` de la raíz (default `http://localhost:8080/api`) y se
hornea al construir el frontend: para usarlo desde otro equipo de la red, poner la IP de la red local de esta
PC en esa variable, `BIND_ADDRESS=0.0.0.0` y reconstruir (ver los avisos de la sección 0).

## 6. Usuarios de prueba
Definidos en `seed_test_users.sql` (`admin@solid.com`, `member@solid.com`, `camila@solid.com`)
con la contraseña documentada en ese archivo. `seed_test_users.sql` es un archivo local no
versionado (ignorado por `seed*.sql`): en un clon nuevo hay que obtenerlo por otro canal.
Ver `RIESGOS.md` (S5).

## 7. Debug desde Claude Code
`.claude/launch.json` define "Frontend (Next.js)" (`npm run dev`, puerto 3000) y
"Backend (NestJS)" (`npm run start:dev`, puerto 8080).
