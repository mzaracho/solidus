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
- Hay un ÚNICO repo git (remoto `github.com/mzaracho/solidus`, rama `main`). `backend/` y
  `frontend/` son carpetas comunes, no repos ni submódulos: todos los cambios se versionan en el repo raíz.
- `backend/` — NestJS 10 + Prisma 5 + PostgreSQL 16.
- `frontend/` — Next.js 16 (App Router) + React 19.
- Raíz — `docker-compose.yml` (único compose: ya no existe `backend/docker-compose.yml`), `dev.ps1` y
  `scripts/` (arranque local), specs en `docs/`. Los seeds SQL y los scripts Python de seeds son
  locales: están en `.gitignore` y no se versionan. `docs/superpowers/` también es local e ignorada.

## Credenciales
- Viven solo en archivos locales ignorados por git: `.env` (raíz), `backend/.env` y
  `.claude/settings.local.json`.
- Única fuente: el `.env` de la raíz (lo leen docker compose y `dev.ps1`). `backend/.env` lo GENERA
  `dev.ps1` a partir de ese archivo: no se edita a mano. Tras cambiar `.env`, correr `.\dev.ps1 -Init`.
  `dev.ps1` deja esos archivos (y `.dev/`) con acceso solo del usuario actual, SYSTEM y Administradores.
- Plantillas versionadas, solo con placeholders: `.env.example` (raíz), `backend/.env.example`
  (referencia para quien no usa `dev.ps1`) y `frontend/.env.example` (opcional).
- `JWT_SECRET` es obligatorio, de 32 caracteres o más: el backend no arranca sin él.
  El compose también falla si falta una variable (`${VAR:?mensaje}`).

## Stack
- Backend: TypeScript 5.9, NestJS 10, Prisma 5.22, PostgreSQL 16, JWT (`@nestjs/jwt`), bcrypt,
  class-validator, Swagger, Jest 29 (specs de guards, login, logs, CORS, rutas, etc. en `src/` y `test/`), ESLint 9 + Prettier.
- Frontend: Next.js 16.1 (Turbopack), React 19.2, TypeScript strict, Tailwind 4, shadcn/ui (Radix),
  Zustand, Recharts, date-fns, sonner. Tests con `node --test` (`npm test`), sin framework.
- Infra: Docker Compose (db `postgres:16.11-alpine` en 5433, backend 8080, frontend Docker 3001→3000). En desarrollo el frontend
  corre en el host en `FRONTEND_PORT` (3000 por defecto).

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
- Endpoint nuevo con datos de una organización: usar `@CurrentUserId()` / `@CurrentOrgId()`, `requireOrgScope(ctx)`
  y `foundOr404` / `inScope` / `inOrg` (`infrastructure.bootstrap/config/core/authentication/org-resource.ts`);
  agregar el caso a `ID_ROUTE_CASES` de `test/org-isolation.spec.ts` (el test estructural falla si falta una ruta con
  parámetros) y clasificar los campos `*Id` nuevos en `security-invariants.spec.ts`. Si la ruta cambia qué datos
  devuelve según el modo org/pro: `@UsesViewMode()` en el controlador y `requireViewScope(ctx)` en el handler (009).
- Todo `@Controller` debe estar registrado en el `controllers` de un módulo Nest: lo vigila el test `(a2)` de
  `test/org-isolation.spec.ts` (011); un controlador huérfano responde 404 y no se debe dejar en el código.
- Atenciones (007): ADMIN puede todo; MEMBER edita y cobra cualquier atención de su organización pero borra solo las
  propias (`createdByUserId`); quien solo tiene un `Professional` edita/borra lo suyo y necesita `canLoadActivities`
  para crear. Detalle: `docs/features/007-aislamiento-organizaciones/00-estado.md`.
- `ConfigController` ya no existe: el front usa `org/*` (escrituras ADMIN) y `pro/*`.
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
- Modo org/pro (009): `src/lib/view-mode.ts` (`allowedViewModes`, `pickViewMode`, `canSeeRestrictedLinks`) decide
  solo qué ofrece la UI (selector "Ver como", enlaces restringidos a ADMIN); el front manda el modo como preferencia
  (`x-mode` / `?mode=`) y el backend decide.
- Permisos de UI de atenciones: `canDeleteActivity` en `src/lib/activity-permissions.ts` e identidad con
  `readSessionIdentity()` en `src/lib/session.ts`; solo presentación (el backend es la autoridad).

## Comandos
Arranque rápido (raíz, Windows PowerShell 5.1 o 7): `.\dev.ps1`. Primera vez crea el `.env` de la raíz
desde `.env.example` con secretos aleatorios (no se muestran) y genera `backend/.env`; no se copia nada a
mano. Detalle, códigos de salida y errores comunes: `docs/auditoria/COMANDOS.md` sección 0.
- `.\dev.ps1` — modo desarrollo: Postgres en Docker + backend y frontend con hot reload en dos ventanas
- `.\dev.ps1 -Docker` — stack completo en Docker (frontend en http://localhost:3001)
- `.\dev.ps1 -Stop` — detiene procesos y contenedores (no borra volúmenes)
- `.\dev.ps1 -Seed` (con o sin `-Docker`) — seeds locales; pide confirmación si la base tiene datos
- `.\dev.ps1 -Smoke` — prueba de humo (backend, frontend, login si hay `SMOKE_USER`/`SMOKE_PASSWORD`)
- `.\dev.ps1 -Init` — crea/sincroniza los `.env`, restringe sus permisos, activa el hook `pre-commit` y valida
  (correrlo tras editar `.env`)
- `.\dev.ps1 -CreateSmokeUser` — crea/actualiza el usuario de humo en la base local (credenciales al azar en
  `.env`, sin mostrarlas; sin organización ni membresía; idempotente). Necesario para el login de `-Smoke`
- `.\dev.ps1 -ExportCa [-Yes]` — exporta a `.dev/certs/extra-ca.pem` (ignorado) la CA de un antivirus/proxy que
  inspecciona TLS; `-Docker` la usa sola en los builds y no queda en las imágenes. Sin el PEM el build es el normal
- `.\dev.ps1 -RotateDbPassword [-Yes]` / `-RotateJwtSecret [-Yes]` — rotan la contraseña de Postgres / `JWT_SECRET`
  (piden `ROTAR` o `-Yes`; código 10 si queda a medias, ver COMANDOS.md)
- Códigos de salida: 0 a 10 (9 = falló `docker compose up --build`, 10 = rotación incompleta); tabla en COMANDOS.md.
- Hook `pre-commit` (`.githooks/`, lo activa `-Init`): rechaza `.env`, `.bak`, `.sql` fuera de migraciones, claves y
  certificados, valores de secretos del `.env` local y patrones de secretos; no imprime valores. `--no-verify` existe
  pero no se usa con secretos. Segunda barrera pendiente: push protection de GitHub (acción del usuario).
- Si la ExecutionPolicy bloquea el script: `powershell -ExecutionPolicy Bypass -File .\dev.ps1` o
  `Unblock-File .\dev.ps1, .\scripts\*.ps1`.
- CORS: `CORS_ORIGIN` (lista separada por comas, sin comodines; obligatoria con `NODE_ENV=production`) la genera
  `dev.ps1` en `backend/.env`; `CORS_EXTRA_ORIGINS` (opcional, `.env` raíz) agrega orígenes, p. ej. al usar `BIND_ADDRESS`.
- `BODY_SIZE_LIMIT` (opcional, `<número>[b|kb|mb]`, default 1mb, máx 10mb; inválido = el backend no arranca; en Docker queda en 1mb).
  `NODE_TLS_REJECT_UNAUTHORIZED=0` está prohibida: el backend no arranca y `-Init` la quita de `backend/.env`; ante
  TLS de antivirus/proxy usar `-ExportCa`. Todo request deja una línea de acceso `METHOD ruta STATUS Nms` (sin query ni datos).
- Swagger en http://localhost:8080/docs solo con `NODE_ENV` `development` o `test` (otro valor cuenta como
  producción). Salud pública sin auth: `GET /health/liveness` (fuera de `/api`).
- Variables opcionales del `.env` raíz: `FRONTEND_PORT` (puerto del frontend en desarrollo, default 3000;
  entero 1024-65535, distinto de 5433 y 8080) y `BIND_ADDRESS` (interfaz de API y frontend, default 127.0.0.1;
  Postgres siempre en 127.0.0.1). El modo desarrollo escucha solo en loopback: backend vía `LISTEN_HOST`
  (que `dev.ps1` genera en `backend/.env`; default 127.0.0.1, el compose lo fija en 0.0.0.0 dentro del contenedor)
  y `next dev -H`. En modo Docker `BIND_ADDRESS` debe ser IPv4 (IPv6: código 1).
- Tests de `dev.ps1`: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-lib.tests.ps1`.

Manual, sin `dev.ps1`:

Backend (`cd backend`):
- `docker compose up -d db` (desde la raíz) — Postgres local en 5433; requiere `backend/.env` ya generado
  (`.\dev.ps1 -Init`)
- `npm install` · `npx prisma migrate deploy` · `npx prisma generate`
- `npm run start:dev` — API en http://localhost:8080/api, Swagger en http://localhost:8080/docs
- `npx tsc --noEmit` — type-check
- `npx eslint "{src,apps,libs,test}/**/*.ts"` — lint sin modificar archivos
- `npm run lint` — ATENCIÓN: aplica `--fix` y reescribe archivos
- `npm test` — Jest (32 suites)
- `npm run build` — reescribe `dist/`

Frontend (`cd frontend`):
- `npm install` · `npm run dev` (http://localhost:3000; con `dev.ps1`, el puerto de `FRONTEND_PORT`)
- `npx tsc --noEmit` · `npm run lint` · `npm test` (`node --test`)
- `npm run build` — si falla la descarga de Google Fonts por TLS:
  `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 npm run build`
- El build Docker (`apk`, `npm`, Prisma, Google Fonts) falla por TLS detrás de un antivirus/proxy que inspecciona
  HTTPS: correr `.\dev.ps1 -ExportCa` y luego `.\dev.ps1 -Docker` (sale con código 9 y esa pista). Nunca se desactiva
  la verificación TLS.

Stack completo manual (raíz, requiere el `.env` de la raíz): `docker compose up --build -d`.
Seeds (archivos locales, no versionados): `.\dev.ps1 -Seed`; manual con `docker compose exec -T db psql`
(ver `docs/auditoria/COMANDOS.md`; `truncate.sql` y algunos seeds borran TODAS las tablas).

## Reglas del proyecto
1. No hacer commit ni push salvo pedido explícito del usuario (ver Flujo de trabajo).
2. No modificar `.env`, credenciales ni configuración de `.claude/` sin pedido explícito.
3. Nunca agregar secretos, tokens, contraseñas ni datos reales de pacientes/profesionales
   a archivos versionados (incluye seeds, specs, docs y settings de Claude). Usar datos ficticios.
   Ninguna credencial, ni siquiera de prueba o de desarrollo, puede subirse a GitHub.
4. Seguridad (ver `docs/auditoria/RIESGOS.md`): el JWT se verifica (005) y el aislamiento entre organizaciones está
   resuelto (007). Reglas vigentes para todo endpoint nuevo o modificado:
   - autenticación (guard global) y organización tomada SOLO de `@CurrentOrgId()` / `RequestContext` (segundo
     parámetro de `execute`, lo pasa el Dispatcher); nunca de `@Headers('x-org-id')`, query ni body (lo vigila
     `src/security-invariants.spec.ts`),
   - recursos por `:id` y ids referenciados verificados contra la organización (helper `org-resource.ts`); si no
     pertenece, 404 genérico idéntico al de un id inexistente,
   - permisos en el backend con el rol de la base: las escrituras de `org/*` exigen `@RequireOrgRole('ADMIN')`;
   - modo org/pro (009): lo resuelve `ViewModeGuard` (tercer guard global: autenticación, organización, modo), único
     lector de `x-mode` / `?mode=` (lo vigila `security-invariants.spec.ts`). Las rutas que dependen del modo llevan
     `@UsesViewMode()` y sus handlers usan `requireViewScope(ctx)` (sin decorador: 403). El modo es una preferencia: si
     el pedido no corresponde a los vínculos del usuario, 403 sin degradar a otro modo; valor inválido: 400
     `invalid-mode`. Los datos financieros de la organización (dashboard en org, `settlements/calculate`) son solo ADMIN.
   Pendiente (ver BACKLOG): cookie `HttpOnly`, rate limiting en login.
5. Operaciones que escriben varias tablas van dentro de `prisma.$transaction`.
6. Cambios de schema: migración Prisma + `prisma generate` + mencionar en la spec del feature.
7. Antes de dar por terminado un cambio: `npx tsc --noEmit` en el repo afectado sin errores,
   lint sin errores nuevos en los archivos tocados, y tests del área (agregar tests si no existen).
8. No ejecutar `npm run lint` del backend sin intención de reformatear (usa `--fix`).
9. No usar `/test-suite` del frontend contra datos reales: escribe en la base.
10. No hacer `TRUNCATE`/seeds contra una base que no sea la local de desarrollo.
11. Documentación y mensajes al usuario en español; código e identificadores en inglés
    (convención existente).
12. Los permisos "permitir siempre" que incluyan tokens, contraseñas, headers `Authorization`,
    ids o URLs con credenciales van solo en `.claude/settings.local.json` (ignorado), nunca en
    `.claude/settings.json`. Antes de cada commit se revisa `git diff .claude/settings.json`.
