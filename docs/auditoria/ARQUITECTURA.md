# Arquitectura — HealthOps / Solidus

> Auditoría técnica del 2026-10-26. Solo lectura: no se modificó código fuente.
> Alcance: repo raíz `c:\Repositorios\healthops-gem` + repos anidados `backend/` y `frontend/`.

## 1. Qué es

Plataforma de gestión operativa y financiera para clínicas de salud mental ("Organizaciones",
p. ej. Psico LSA) y profesionales independientes. Registra atenciones (WorkItems), pacientes,
pagadores (obras sociales / particular), reglas de honorarios y calcula la distribución
(splits) entre organización y profesionales. Nombre comercial en código: **Solidus**
(`solidus-backend`, `solidus-frontend`, DB `solidus_db`). Especificación funcional:
`healthops_functional_spec.md`.

## 2. Estructura del repositorio

```
healthops-gem/                       repo git "paraguas" (rama master, SIN remoto configurado)
├── backend/                         gitlink -> github.com/mzaracho/solidus-backend (master)
├── frontend/                        gitlink -> github.com/mzaracho/solidus-frontend (master)
├── docker-compose.yml               db (postgres 16) + backend + frontend
├── seed.sql, seed_test_users.sql,   seeds SQL manuales (se aplican con psql vía docker exec)
│   seed_psicolsa.sql, seed_activities.sql, truncate.sql
├── generate_seed.py,                generadores de seeds (Python, openpyxl; lee un .xlsx local)
│   generate_seed_from_xlsx.py
├── healthops_functional_spec.md     spec funcional
├── docs/superpowers/{plans,specs}   planes/specs de features previas (abr–jun 2026)
└── .claude/                         agentes, skills, settings, worktrees
```

**Importante:** `backend` y `frontend` (y `.claude/worktrees/bold-meninsky-a75726`) están
registrados como gitlinks (modo 160000) pero **no existe `.gitmodules`**. `git submodule status`
falla con `fatal: no submodule mapping found in .gitmodules`. En la práctica son repos
independientes anidados; clonar el repo raíz no trae su contenido.

Estado de punteros al momento de la auditoría:

| Repo | HEAD real | Commit fijado en raíz | Comentario |
|---|---|---|---|
| backend | `43115ec` | `1420357` | raíz desactualizada (1 commit: `pro-controller.ts`) → `M backend` |
| frontend | `bd3932d` | `bd3932d` | sincronizado |

## 3. Backend (`backend/`)

### Stack
- Node 22 (Docker) / Node 24.13 local, TypeScript 5.9, **NestJS 10.4**.
- **Prisma 5.22** + PostgreSQL 16.
- Auth: `@nestjs/jwt` + `bcrypt`. Validación: `class-validator` / `class-transformer`.
- Swagger (`@nestjs/swagger`) servido en la raíz `/`.
- Jest 29 + ts-jest (configurado, sin tests), ESLint 9 flat config + Prettier.

### Capas (estilo "clean architecture" + CQRS casero)

```
src/
├── api/
│   ├── main.ts                       entrypoint -> bootstrap()
│   └── controllers/v1/<feature>/     controladores HTTP (finos: arman comando/query y despachan)
├── application/features/<feature>/   Commands/Queries + Handlers + DTOs (lógica de casos de uso)
├── domain/                           entidades (WorkItem, Patient), constantes, contratos
├── infrastructure/                   PrismaService y servicios con lógica pesada
│   └── features/{activity,dashboard,fee-engine,patients,auth}/*.service.ts
└── infrastructure.bootstrap/         bootstrap, config de app, CQRS dispatcher, guards,
                                      filtros, interceptores, módulos Nest
```

**CQRS propio:** cada request es una clase decorada con `@RequestHandler(XQuery)` en su
handler. Los controladores llaman `dispatcher.dispatch(obj)`; `Dispatcher` resuelve el
handler vía metadata + `ModuleRef.resolve`. El handler debe estar registrado como provider en
el módulo Nest correspondiente (si no, falla en runtime con "Handler not found").
A menudo el propio DTO de entrada (`@Body() command: XCommand`) es el comando.

### Módulos Nest (`infrastructure.bootstrap/modules`)
`AppModule` importa: `FeeEngineModule`, `ActivityModule`, `PrismaModule`, `AuthModule`,
`PatientsModule`, `DashboardModule`, `SettlementsModule`, `VerifyTokenModule` (global),
`ConfigModule` de features (`config/config-module.ts`), `LoggerModule`,
`@nestjs/config` (global) y `JwtModule` global.

### Endpoints (prefijo global `/api`)

| Controlador | Ruta base | Guard aplicado |
|---|---|---|
| AuthController | `v1/auth` (`login` público, `logout`) | `AuthGuard` |
| ActivityController | `activity` (CRUD) | `JwtAuthGuard` |
| ProductionController | `my-production` | ninguno (solo `ApiKeyGuard` = siempre true) |
| ReportingController | `work-items/reporting/{daily,debtors,monthly}` | ninguno |
| DashboardController | `dashboard/{kpis,chart,payers}` | `AuthGuard` |
| PatientsController | `v1/patients` (+ `:id/debt`, `:id/summary`, `:id/merge`) | `AuthGuard` |
| SettlementsController | `settlements` (+ `calculate`, `:id/details`) | ninguno |
| ConfigController | `config/*` (dictionaries, org-rules, categories, activity-types CRUD) | ninguno |
| OrgController | `org/*` (organización, categorías, presets, staff, activity-types) | `AuthGuard` + `OrgRoleGuard` en escrituras |
| ProController | `pro/{context,memberships,profile,payers}` | `AuthGuard` |
| ProfileController | `profile` (mock) | ninguno |
| SystemController | `system/professionals` | `AuthGuard` |
| FeeRulesController | `fee-rules` | `AuthGuard` |
| ProfessionalCategoryController | `fee-engine/professional-categories` | ninguno |

Ver `RIESGOS.md`: ninguno de estos guards valida realmente la firma del JWT.

### Contexto de tenant / usuario
El backend toma el contexto **de headers enviados por el cliente**:
`x-org-id`, `x-user-id`, `x-mode` (y a veces `?mode=` en query). Los valores `PROFESSIONAL`/`pro`
activan "modo profesional" (`isProfessionalMode()` en `domain/constants/app.constants.ts`).
Solo `ActivityController` usa `request.userId` derivado (sin verificar) del JWT.

### Modelo de datos (Prisma, `prisma/schema.prisma`)
Entidades principales: `Organization` (tipo `SOLO_PRACTICE` | `CLINIC`, `settings` JSON),
`OrganizationMember` (OrgRole `ADMIN`/`MEMBER`), `User`, `Role`/`UserRole`,
`Professional` (por org; `canLoadActivities`, `status`, soft delete `deletedAt`),
`ProfessionalCategory` (% de honorario), `Payer`, `Patient`, `FeeRule` (splits JSON),
`FeePreset`, `ActivityType` (roles JSON con `feeStrategy` FIXED/CATEGORY),
`WorkItem` (atención; montos `Decimal(10,2)`, `paymentStatus`, `attendance`, `createdByUserId`),
`WorkItemParticipant`, `WorkItemSplit` (beneficiario ORG/PROFESSIONAL), `Settlement`,
`Notification` (sin uso aparente).
8 migraciones en `prisma/migrations` (ene–abr 2026). `prisma/seed.ts` está deprecado: los
seeds reales son SQL en la raíz.

### Flujo principal: alta de una atención
1. Front `WorkItemForm` → `createWorkItem()` en `services/data.ts` → `POST /api/activity`
   con headers `Authorization`, `x-org-id`, `x-user-id`, `x-mode`.
2. `ActivityController.create` completa `mode`, `organizationId` (body tiene prioridad sobre
   header) y `userId` → `CreateActivityCommandHandler` → `ActivityService.createActivity`.
3. El servicio resuelve: settings de la org, ActivityType, montos (preset / activity type /
   manual), payer (autocrea "Particular" si falta), profesional (autocrea Professional en
   SOLO_PRACTICE), regla de "primera carga la hace la org", persiste WorkItem
   (`createdByUserId`), participantes y splits (`FeeResolutionService.calculateSplits` o
   regla de paciente privado). Todo en llamadas Prisma separadas, **sin transacción**.
4. Dashboard (`DashboardService`) agrega en memoria los WorkItems + splits para KPIs y gráficos.

## 4. Frontend (`frontend/`)

### Stack
- **Next.js 16.1.3** (App Router, Turbopack), **React 19.2**, TypeScript 5.9 (`strict`).
- Tailwind CSS 4, componentes estilo shadcn/ui (Radix UI) en `src/components/ui`.
- Zustand 5 (`store/useStore.ts`, persistido en localStorage como `solidus-storage`).
- `@tanstack/react-query` instalado y con provider, pero el fetch real es `fetch` manual en
  `services/data.ts` (949 líneas).
- Recharts (gráficos), date-fns, sonner (toasts), cmdk.
- Sin framework de tests.

### Estructura
```
src/
├── app/
│   ├── page.tsx                      redirige según JWT (dashboard / pro / org)
│   ├── login/page.tsx                login; guarda token en cookie `auth_token` desde JS
│   ├── test-suite/page.tsx           página de "pruebas" manuales que escribe datos reales
│   └── (dashboard)/[orgSlug]/        dashboard, org/{admisiones,at,liquidaciones,pacientes,
│                                     profesionales}, pro/{atenciones,deudores,resumen},
│                                     settings/{categories,fees,general}, patients, work-items
├── components/
│   ├── ui/                           primitivas shadcn
│   ├── domain/<área>/                componentes de negocio (tablas, formularios, modales)
│   └── layout/Sidebar.tsx            navegación según modo/rol
├── lib/constants.ts                  constantes de dominio (PAYMENT_STATUS, ATTENDANCE, ...)
├── services/data.ts                  TODA la capa de acceso a la API
├── store/useStore.ts                 estado global (viewMode, orgSlug, orgRole)
└── middleware.ts                     redirige a /login si falta la cookie (no valida token)
```

### Comunicación con el backend
- En navegador: `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8080/api`).
- En servidor: `INTERNAL_API_URL` (default `http://backend:8080/api`).
- `next.config.ts` además define un rewrite `/api/:path*` → backend.
- `getHeaders()` decodifica el JWT en el cliente y envía `x-org-id = payload.organizationId`
  (la primera membresía del usuario; el `orgSlug` de la URL queda como fallback) y
  `x-user-id = payload.sub`.

## 5. Despliegue / ejecución

- **Docker Compose (raíz):** `db` (postgres:16-alpine, puerto host 5433), `backend` (8080;
  espera DB con `nc`, corre `prisma migrate deploy` y `node dist/src/api/main.js`),
  `frontend` (host 3001 → 3000; `NEXT_PUBLIC_API_BASE_URL` horneado en build con IP LAN
  `192.168.68.123`).
- **Local:** `backend/docker-compose.yml` levanta solo Postgres; backend con `npm run start:dev`
  y frontend con `npm run dev` (ver `COMANDOS.md`). `.claude/launch.json` define ambos.
- Seeds: SQL aplicados manualmente (`Get-Content seed.sql | docker exec -i healthops-gem-db-1 psql -U myuser -d solidus_db`).

## 6. Dependencias entre piezas

```
Navegador ──(cookie auth_token, headers x-*)──> Frontend Next.js ──fetch──> Backend NestJS ──Prisma──> PostgreSQL
                                                   (SSR usa INTERNAL_API_URL)       │
                                                                                    └─ Swagger UI en "/"
Scripts Python (xlsx local) ──genera──> seed_*.sql ──psql──> PostgreSQL
```

Sin integraciones externas activas (hay `@nestjs/axios`, filtros/interceptores de Axios y un
`VerifyTokenService` stub preparado para un verificador externo que nunca se implementó).

## 7. Verificación del refactor de abril 2026

| Ítem | Estado en código |
|---|---|
| `Professional.canLoadActivities` (schema + migración `20260414191804`) | Presente |
| `WorkItem.createdByUserId` persistido en `ActivityService` | Presente (`activity.service.ts:197`) |
| Ownership guard en update/delete (`ForbiddenException`) | Presente, pero solo si `x-mode` es profesional y el `userId` sale de un JWT no verificado; registros con `createdByUserId = null` quedan editables por cualquiera |
| `canLoadActivities` aplicado en backend al crear | **No**. Solo el front oculta el botón; el backend lo usa únicamente para eximir la regla de "primera carga" |
| Staff create/update con `canLoadActivities` | Presente (`staff-commands.ts`) |
| Fallback dashboard sin splits → todo a ORG | Presente (3 lugares en `dashboard.service.ts`) |
| `GET /pro/context` | Presente (usa header `x-user-id`) |
| Front: switch en profesionales, `AtencionesTable` con `canLoadActivities`/`currentUserId`, edit/delete deshabilitado si no es dueño | Presente |
| Front: `WorkItemForm` sin `formData.type` en deps del cálculo de bruto | **Divergente**: `formData.type` y `rulesOrg` siguen en las deps del efecto de cálculo (línea 278); sí se quitó `rulesOrg` del efecto de reset |
| `lib/constants.ts`, eliminación de `window.location.reload()` | Presente (0 usos de `reload`) |
