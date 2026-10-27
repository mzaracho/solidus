> **OBSOLETO:** este borrador quedó desactualizado (describe `backend` y `frontend` como repos
> propios, lo cual es incorrecto). La guía vigente es `.claude/CLAUDE.md`. No usar este archivo.
> Tampoco vale su `docker compose up -d` en `backend/`: `backend/docker-compose.yml` ya no existe desde el
> feature 003 (la base se levanta con `docker compose up -d db` desde la raíz o con `.\dev.ps1`).

# HealthOps (Solidus) — Guía del proyecto

Plataforma de gestión operativa y financiera para clínicas de salud y profesionales
independientes: atenciones (WorkItems), pacientes, pagadores, reglas de honorarios,
distribución de montos (splits), dashboard y liquidaciones.
Spec funcional: `healthops_functional_spec.md`. Auditoría técnica: `docs/auditoria/`.

## Flujo de trabajo
Los pedidos de funcionalidades los atiende el agente `po`, que orquesta:
ux-ui → arquitecto → desarrollador → revisor → seguridad → tester → documentador.
Los traspasos se guardan en docs/features/<NNN-nombre>/. Nadie hace commit ni push
salvo que el usuario lo pida.

## Estructura
- `backend/` — repo propio (github.com/mzaracho/solidus-backend). NestJS 10 + Prisma 5 + PostgreSQL 16.
- `frontend/` — repo propio (github.com/mzaracho/solidus-frontend). Next.js 16 (App Router) + React 19.
- Raíz — docker-compose, seeds SQL, scripts Python de seeds, specs y planes en `docs/`.
- El repo raíz NO tiene `.gitmodules`: `backend` y `frontend` son repos git independientes.
  Los cambios de código se hacen y versionan dentro de cada uno.

## Stack
- Backend: TypeScript 5.9, NestJS 10, Prisma 5.22, PostgreSQL 16, JWT (`@nestjs/jwt`), bcrypt,
  class-validator, Swagger, Jest 29 (configurado, sin tests todavía), ESLint 9 + Prettier.
- Frontend: Next.js 16.1 (Turbopack), React 19.2, TypeScript strict, Tailwind 4, shadcn/ui (Radix),
  Zustand, Recharts, date-fns, sonner. Sin framework de tests.
- Infra: Docker Compose (db 5433, backend 8080, frontend 3001→3000).

## Convenciones — backend
- Capas: `api/controllers/v1/<feature>` (controladores finos) → `application/features/<feature>`
  (commands/queries + handlers + DTOs) → `infrastructure/` (PrismaService y servicios) ;
  `domain/` para entidades y constantes; `infrastructure.bootstrap/` para módulos, guards, filtros.
- CQRS propio: clase request + handler con `@RequestHandler(Request)` e `@Injectable()`, y el
  handler registrado en `providers` del módulo Nest de la feature. El controlador llama
  `this.dispatcher.dispatch(request)`. Si no se registra el handler: "Handler not found" en runtime.
- Alias de imports `@src/*` → `src/*`.
- Cambios de schema solo vía migración Prisma (`npx prisma migrate dev --name ...`), nunca `db push`.
- Dinero: columnas `Decimal(10,2)`; preferir `Prisma.Decimal` en cálculos nuevos.
- Constantes de dominio en `src/domain/constants/app.constants.ts`; usar `isProfessionalMode()`
  (acepta `PROFESSIONAL` y `pro`).
- Errores de negocio con excepciones HTTP de Nest (`BadRequestException`, `ForbiddenException`,
  `NotFoundException`), no `throw new Error`.
- Prettier: comillas simples, trailing commas (`.prettierrc`).

## Convenciones — frontend
- Rutas bajo `src/app/(dashboard)/[orgSlug]/...`; secciones `org/*` (organización) y `pro/*` (profesional).
- Todo acceso a la API pasa por `src/services/data.ts` (`getHeaders()` agrega `Authorization`,
  `x-org-id`, `x-user-id`).
- Strings de dominio desde `src/lib/constants.ts` (PAYMENT_STATUS, ATTENDANCE, WORK_ITEM_TYPE, ...);
  no hardcodear literales.
- UI con componentes de `src/components/ui` (shadcn); componentes de negocio en
  `src/components/domain/<área>`.
- Refrescar datos con `router.refresh()`, no `window.location.reload()`.
- Alias `@/*` → `src/*`.

## Comandos
Backend (`cd backend`):
- `docker compose up -d` — Postgres local en 5433
- `npm install` · `npx prisma migrate deploy` · `npx prisma generate`
- `npm run start:dev` — API en http://localhost:8080/api, Swagger en http://localhost:8080/
- `npx tsc --noEmit` — type-check
- `npx eslint "{src,apps,libs,test}/**/*.ts"` — lint sin modificar archivos
- `npm run lint` — ATENCIÓN: aplica `--fix` y reescribe archivos
- `npm test` — Jest (hoy no hay tests; falla con "No tests found")
- `npm run build` — reescribe `dist/`

Frontend (`cd frontend`):
- `npm install` · `npm run dev` (http://localhost:3000)
- `npx tsc --noEmit` · `npm run lint`
- `npm run build` — si falla la descarga de Google Fonts por TLS:
  `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 npm run build`

Stack completo (raíz): `docker compose up --build -d`.
Seeds: `Get-Content seed.sql | docker exec -i healthops-gem-db-1 psql -U myuser -d solidus_db`
(ver `docs/auditoria/COMANDOS.md`; `truncate.sql` y algunos seeds borran TODAS las tablas).

## Reglas del proyecto
1. No hacer commit ni push salvo pedido explícito del usuario (ver Flujo de trabajo).
2. No modificar `.env`, credenciales ni configuración de `.claude/` sin pedido explícito.
3. Nunca agregar secretos, tokens, contraseñas ni datos reales de pacientes/profesionales
   a archivos versionados (incluye seeds, specs, docs y settings de Claude). Usar datos ficticios.
4. Seguridad (estado actual, ver `docs/auditoria/RIESGOS.md`): los JWT no se verifican y el
   tenant se toma de headers del cliente. Todo endpoint nuevo o modificado debe:
   - estar protegido por autenticación,
   - filtrar por la organización del usuario autenticado,
   - verificar pertenencia del recurso al operar por `:id`,
   - aplicar permisos en el backend (ocultar un botón en el front no es control de acceso).
5. Operaciones que escriben varias tablas van dentro de `prisma.$transaction`.
6. Cambios de schema: migración Prisma + `prisma generate` + mencionar en la spec del feature.
7. Antes de dar por terminado un cambio: `npx tsc --noEmit` en el repo afectado sin errores,
   lint sin errores nuevos en los archivos tocados, y tests del área (agregar tests si no existen).
8. No ejecutar `npm run lint` del backend sin intención de reformatear (usa `--fix`).
9. No usar `/test-suite` del frontend contra datos reales: escribe en la base.
10. No hacer `TRUNCATE`/seeds contra una base que no sea la local de desarrollo.
11. Documentación y mensajes al usuario en español; código e identificadores en inglés
    (convención existente).
