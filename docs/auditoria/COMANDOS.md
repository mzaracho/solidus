# Comandos — instalar, buildear, testear y correr

> Probado en Windows 11 (PowerShell / Git Bash), Node 24.13.0, npm 11.6.2.
> Docker usa Node 22-alpine. Rutas relativas al repo raíz `c:\Repositorios\healthops-gem`.

## 0. Requisitos
- Node.js 22+ y npm.
- Docker Desktop (para PostgreSQL y/o el stack completo).
- Python 3 + `openpyxl` solo si se regeneran seeds desde Excel.

## 1. Obtener el código
El repo raíz **no** tiene `.gitmodules`; `backend` y `frontend` son repos independientes:
```bash
git clone https://github.com/mzaracho/solidus-backend.git  backend
git clone https://github.com/mzaracho/solidus-frontend.git frontend
```
(`git submodule update --init` no funciona en el estado actual.)

## 2. Base de datos (desarrollo local)
```bash
cd backend
docker compose up -d          # postgres:16 en localhost:5433 (myuser/<POSTGRES_PASSWORD>, solidus_db)
npx prisma migrate deploy     # aplica migraciones (el README dice "db push": no usar)
npx prisma generate           # regenera el cliente si cambió el schema
```
Para crear una migración nueva tras editar `prisma/schema.prisma`:
```bash
npx prisma migrate dev --name <descripcion>
```

### Seeds (SQL en la raíz, aplicados a mano)
El nombre del contenedor depende del compose usado (`healthops-gem-db-1` con el compose raíz).
```powershell
Get-Content truncate.sql        | docker exec -i healthops-gem-db-1 psql -U myuser -d solidus_db
Get-Content seed.sql            | docker exec -i healthops-gem-db-1 psql -U myuser -d solidus_db
Get-Content seed_test_users.sql | docker exec -i healthops-gem-db-1 psql -U myuser -d solidus_db
```
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
# .env necesario (no versionado). Variables usadas:
#   NODE_ENV, APP_NAME (obligatorias: el Logger lanza error si faltan)
#   PORT=8080
#   DATABASE_URL="postgresql://myuser:<POSTGRES_PASSWORD>@localhost:5433/solidus_db?schema=public"
#   JWT_SECRET=<definirlo: hoy falta y se usa un fallback hardcodeado>
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
npm test              # jest (hoy: "No tests found", exit 1)
npm run test:cov      # cobertura en backend/coverage
npm run test:e2e      # requiere DB; el único e2e es boilerplate roto
```

## 4. Frontend (`frontend/`)
```bash
npm install
# Variables:
#   NEXT_PUBLIC_API_BASE_URL  URL del backend vista desde el navegador (default http://localhost:8080/api)
#   INTERNAL_API_URL          URL del backend para SSR/rewrites (default http://localhost:8080/api en rewrites,
#                             http://backend:8080/api en services/data.ts)

npm run dev           # next dev -> http://localhost:3000
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
docker compose up --build -d
# db:       localhost:5433
# backend:  localhost:8080 (corre prisma migrate deploy al iniciar)
# frontend: localhost:3001
```
`NEXT_PUBLIC_API_BASE_URL` está fijado en `docker-compose.yml` a `http://192.168.68.123:8080/api`
(IP LAN de la máquina de desarrollo): ajustarlo antes de construir en otro equipo.

## 6. Usuarios de prueba
Definidos en `seed_test_users.sql` (`admin@solid.com`, `member@solid.com`, `camila@solid.com`)
con la contraseña documentada en ese archivo. `seed_test_users.sql` es un archivo local no
versionado (ignorado por `seed*.sql`): en un clon nuevo hay que obtenerlo por otro canal.
Ver `RIESGOS.md` (S5).

## 7. Debug desde Claude Code
`.claude/launch.json` define "Frontend (Next.js)" (`npm run dev`, puerto 3000) y
"Backend (NestJS)" (`npm run start:dev`, puerto 8080).
