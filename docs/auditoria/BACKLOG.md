# Backlog priorizado

> Derivado de `RIESGOS.md` y `ESTADO.md` (2026-10-26). Cada ítem es candidato a un feature en
> `docs/features/<NNN-nombre>/` siguiendo el flujo del agente `po`.
> Esfuerzo: S (< 1 día), M (1–3 días), L (> 3 días).

## P0 — Bloqueantes antes de exponer el sistema fuera de la máquina de desarrollo

| # | Ítem | Riesgo | Esfuerzo |
|---|---|---|---|
| 1 | **Autenticación real**: un único `JwtModule` con `JWT_SECRET` obligatorio (fallar al arrancar si falta); `AuthGuard` global (`APP_GUARD`) que use `jwtService.verifyAsync`; `@Public()` solo en login; eliminar `VerifyTokenService` stub, `ApiKeyGuard` y `JwtAuthGuard` basado en `decode` | S1, S2, S5 | M |
| 2 | **Contexto de tenant desde el token, no desde headers**: derivar `userId` de `sub` y validar `x-org-id` contra las membresías/Professional del usuario en un guard/interceptor; el modo (org/pro) se deduce del rol, no de `x-mode` | S3 | L |
| 3 | **Chequeo de pertenencia por recurso**: toda operación por `:id` (activity, patient, staff, payer, settlement, category, preset, activity type, merge) filtra por `organizationId` del contexto | S3 | M |
| 4 | **Aplicar en backend `canLoadActivities` y ownership**: rechazar `POST /activity` si el Professional no tiene permiso; ownership independiente de `x-mode`; definir política para `createdByUserId = null` | S4 | S |
| 5 | **Proteger o eliminar `ConfigController`** (duplica escrituras de `OrgController` sin guards) y aplicar `RequireOrgRole('ADMIN')` con rol verificado | S2 | S |
| 6 | **Rotar y purgar secretos/PII del repo raíz**: quitar `.claude/settings*.json` del índice (o limpiarlos), rotar contraseñas de prueba, sacar `seed_psicolsa.sql`/`seed_activities.sql` con datos reales del repo y evaluar reescritura de historial; agregar `.gitignore` en la raíz | S5, S6 | M |
| 7 | **Dejar de loguear secretos**: `LoggingInterceptor` sin headers/body/response (o con redacción de `authorization`, `password`, `token`), respetar nivel de log por entorno, quitar `console.log` de payloads | S7 | S |
| 8 | **Actualizar `next` a 16.4.3+** (CVE crítico de DoS) y `axios` a 1.20+ | Dependencias | S |

## P1 — Endurecimiento y consistencia

| # | Ítem | Esfuerzo |
|---|---|---|
| 9 | CORS desde `CORS_ORIGIN` (lista blanca), sin `origin: true` | S |
| 10 | Sesión en cookie `HttpOnly; Secure; SameSite=Lax` emitida por el backend (o route handler de Next); eliminar `'mock_token'`; middleware que valide expiración | M |
| 11 | Rate limiting en login (`@nestjs/throttler`) y respuesta 400 si faltan campos | S |
| 12 | `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`; DTOs explícitos para fee rules y settings de organización | M |
| 13 | Filtros de error sin `details` hacia el cliente; mapear errores de negocio a 400/403/404/409 (`BadRequestException`, etc.) en lugar de `Error` | S |
| 14 | Swagger solo fuera de producción (o detrás de auth); quitar `NODE_TLS_REJECT_UNAUTHORIZED=0`; bajar body limit a ~1 MB | S |
| 15 | Eliminar `/test-suite` del build de producción | S |
| 16 | Transacciones Prisma (`$transaction`) en `createActivity`, `MergePatientCommand` y borrado de staff; revisar que borrar staff no afecte membresías de otras orgs | M |
| 17 | Dinero con `Prisma.Decimal` de punta a punta en splits, KPIs y liquidaciones | M |
| 18 | Arreglar estructura del repo raíz: agregar `.gitmodules` con las URLs de GitHub (o documentar que son repos independientes y quitar los gitlinks), actualizar el puntero de `backend`, quitar el gitlink de `.claude/worktrees/*`, definir remoto | S |
| 19 | Docker: secretos por `.env`/secrets, Postgres no publicado o ligado a `127.0.0.1`, usuario no-root, `NEXT_PUBLIC_API_BASE_URL` parametrizable | S |

## P2 — Calidad y tests

| # | Ítem | Esfuerzo |
|---|---|---|
| 20 | Tests unitarios backend (Jest ya configurado): `ActivityService.createActivity`, `FeeResolutionService`, `DashboardService.getKpis`, `CalculateSettlementsQuery`, guards de ownership | L |
| 21 | Tests e2e backend reales: arreglar `test/jest-e2e.json` (`moduleNameMapper @src`), DB de test vía Docker, casos de autorización cruzada entre orgs | M |
| 22 | Framework de tests en frontend (Vitest + Testing Library) empezando por `WorkItemForm` y `services/data.ts` | M |
| 23 | Lint en verde: `npm run format` en backend (resuelve ~540 errores Prettier), luego tipar `any` críticos; separar script `lint` (sin fix) de `lint:fix` | M |
| 24 | CI (GitHub Actions) en cada repo: install, type-check, lint, test, build | S |
| 25 | `npm audit fix` no-breaking en ambos repos; plan de migración Nest 10 → 11/12 y Prisma 5 → 6/7 | M / L |

## P3 — Mantenibilidad y producto

| # | Ítem | Esfuerzo |
|---|---|---|
| 26 | Partir `services/data.ts` por dominio y usar react-query (ya instalado) para cache/invalidación | M |
| 27 | Refactor de `WorkItemForm.tsx` (858 líneas): extraer cálculo de precios a función pura testeada; revisar deps de efectos (`formData.type`/`rulesOrg` siguen en el efecto de bruto, distinto de lo que dice el refactor de abril) | M |
| 28 | Mover lógica de `ProController`/`OrgController.lookupStaffByCuit` a handlers CQRS | S |
| 29 | Unificar valores de modo (`PROFESSIONAL`/`pro`) y de estados de pago (`PENDING` no existe en Prisma) en un contrato compartido | S |
| 30 | Dashboard: agregaciones en DB (`groupBy`/SQL) en lugar de traer todos los WorkItems | M |
| 31 | Migrar `middleware.ts` → `proxy.ts` (Next 16); fuente Inter self-hosted (`next/font/local`) para builds offline | S |
| 32 | Limpiar logs viejos versionados en `frontend/` y actualizar READMEs (`migrate deploy` en vez de `db push`, contactos) | S |
| 33 | Seeds reproducibles: mover a `backend/prisma/seed.ts` con datos ficticios; scripts Python sin rutas absolutas | M |
