# Backlog priorizado

> Derivado de `RIESGOS.md` y `ESTADO.md` (2026-10-26). Cada ítem es candidato a un feature en
> `docs/features/<NNN-nombre>/` siguiendo el flujo del agente `po`.
> Esfuerzo: S (< 1 día), M (1–3 días), L (> 3 días).

## P0 — Bloqueantes antes de exponer el sistema fuera de la máquina de desarrollo

| # | Ítem | Riesgo | Esfuerzo |
|---|---|---|---|
| 1 | **RESUELTO (feature 005).** **Autenticación real**: un único `JwtModule` con `JWT_SECRET` obligatorio (fallar al arrancar si falta); `AuthGuard` global (`APP_GUARD`) que use `jwtService.verifyAsync`; `@Public()` solo en login; eliminar `VerifyTokenService` stub, `ApiKeyGuard` y `JwtAuthGuard` basado en `decode` | S1, S2, S5 | M |
| 2 | **RESUELTO (features 005, 007 y 009):** `userId` sale de `sub`, `x-org-id` se valida contra membresías y el modo (org/pro) lo resuelve `ViewModeGuard` según los vínculos del usuario; `x-mode` es solo una preferencia. **Contexto de tenant desde el token, no desde headers**: derivar `userId` de `sub` y validar `x-org-id` contra las membresías/Professional del usuario en un guard/interceptor; el modo (org/pro) se deduce del rol, no de `x-mode` | S3 | L |
| 3 | **RESUELTO (feature 007).** **Chequeo de pertenencia por recurso**: toda operación por `:id` (activity, patient, staff, payer, settlement, category, preset, activity type, merge) filtra por `organizationId` del contexto | S3 | M |
| 4 | **RESUELTO (feature 007).** **Aplicar en backend `canLoadActivities` y ownership**: rechazar `POST /activity` si el Professional no tiene permiso; ownership independiente de `x-mode`; definir política para `createdByUserId = null` | S4 | S |
| 5 | **RESUELTO (feature 007; `ConfigController` eliminado, escrituras de `org/*` con ADMIN verificado).** **Proteger o eliminar `ConfigController`** (duplica escrituras de `OrgController` sin guards) y aplicar `RequireOrgRole('ADMIN')` con rol verificado | S2 | S |
| 6 | **Rotar y purgar secretos/PII del repo raíz**: quitar `.claude/settings*.json` del índice (o limpiarlos), rotar contraseñas de prueba, sacar `seed_psicolsa.sql`/`seed_activities.sql` con datos reales del repo y evaluar reescritura de historial; agregar `.gitignore` en la raíz | S5, S6 | M |
| 7 | **RESUELTO (feature 005).** **Dejar de loguear secretos**: `LoggingInterceptor` sin headers/body/response (o con redacción de `authorization`, `password`, `token`), respetar nivel de log por entorno, quitar `console.log` de payloads | S7 | S |
| 8 | **RESUELTO (feature 005):** `next` 16.4.3 y `axios` 1.20.0. **Actualizar `next` a 16.4.3+** (CVE crítico de DoS) y `axios` a 1.20+ | Dependencias | S |

## Candidatos surgidos del feature 005

Origen: `docs/features/005-seguridad-backend/06-seguridad.md`. Ver los residuales en `RIESGOS.md`.

| # | Ítem | Riesgo | Esfuerzo |
|---|---|---|---|
| 34 | **RESUELTO (feature 006).** Usuarios con `User.deletedAt`: mismo 401 genérico en el login y chequeo en `OrgAccessService`/guard | M-1 | S |
| 35 | Upgrade a Nest 11 o superior (15 vulnerabilidades de `npm audit` en el backend, entre ellas `proxy-addr`) | H-2 | L |
| 36 | `npm audit fix` en el frontend (`source-map-js`) | H-3 | S |
| 37 | **RESUELTO (feature 010).** Loguear requests fallidos (método, ruta, status, duración), incluidos los 401 y 403 de los guards, sin datos sensibles | B-3 | S |
| 38 | **RESUELTO (feature 010).** Bajar el límite del body (hoy 50 MB) a 1–2 MB (queda `BODY_SIZE_LIMIT`, default 1mb, máx 10mb) | B-4 | S |
| 39 | `ProductionController` y `ReportingController`: reemplazar `userId` por query con `@CurrentUserId()` (o borrarlos) y agregar un test que lo vigile | B-1 | S |

Notas del feature 010 (`docs/features/010-logs-y-limites/06-seguridad.md`):
- I-4: un error del parser con otro status o sin `type` cae en el manejador por defecto de Express (fuera de producción
  puede mostrar el stack). Agregar un manejador final genérico; relacionado con #13.
- I-2: los UUID de recursos quedan en la ruta del log de acceso. Considerarlo en una política de retención de logs.
- El compose no pasa `BODY_SIZE_LIMIT` al contenedor (queda en 1mb): declararlo en el compose si hace falta hacerlo configurable.

## Candidatos surgidos del feature 007

Origen: `docs/features/007-aislamiento-organizaciones/` (06-seguridad, 05-revision, 07-testing).

| # | Ítem | Riesgo | Esfuerzo |
|---|---|---|---|
| 40 | Motor de honorarios: unificar la forma de `splits` entre la UI (`{role, percentage, beneficiaryType}`) y `FeeResolutionService` (`{beneficiary, type, value}`) y acotar los montos `FIXED` al bruto de la atención (`computeAmounts`: limitar a `grossAmount - totalAllocated`, mínimo 0) | MEDIA-2 (007) | M |
| 41 | **RESUELTO (feature 009).** `settlements/calculate`: usar `@CurrentOrgId()` en lugar de `organizationId` de la query y sumar el controlador al invariante de `security-invariants.spec.ts`; evaluar `@RequireOrgRole('ADMIN')` en `settlements/calculate` y acceso por rol en el dashboard en modo organización | MENOR-1 e INFO-1 (007) | S |
| 42 | Mensajes de error 404 en español y sin JSON crudo en los toasts del front (`updateWorkItem`/`deleteWorkItem` en `data.ts`, `AtencionesTable`, `AdmisionesTable`, `WorkItemForm`) | m-4 (re-revisión 1) | S |
| 43 | DTOs con class-validator en los comandos de update (`UpdatePatientCommand`, `UpdateActivityCommand`, `UpdateStaffCommand`: enums de pago, email, fechas) para evitar 500 de Prisma. Relacionado con #12 | S-2 / BAJA-2 resto | M |
| 44 | **RESUELTO (feature 008).** Ocultar "Eliminar" al MEMBER también en `workload/columns.tsx`: `canDeleteActivity` (`src/lib/activity-permissions.ts`) compartida con `AdmisionesTable`; ítem deshabilitado con tooltip. El bug de la tabla de work-items vacía ("No results", O-3 del 005) también quedó resuelto por el 008 | 007 §8.1 | S |
| 45 | Editar atención: `PUT /activity/:id` ignora monto (`grossAmount`) y pagador (solo persiste `date`, `paymentStatus`, `paymentMethod`, `paymentDate`, `attendance`), pero `workload/RetroactiveModal` y otros formularios permiten cambiarlos y la UI informa éxito. Además el pagador faltante se muestra "—" y se reenvía como valor (M2). Definir si se pueden editar (recalcular splits) o deshabilitarlos en la UI. Relacionado con #17 y #40 (motor de honorarios) | 008 (M1, M2) | M |
| 46 | UX menor en `workload/columns.tsx`: el tooltip (`title`) del ítem "Eliminar" deshabilitado no se ve (`data-[disabled]:pointer-events-none` del `DropdownMenuItem`; envolver en `<span title>` o `Tooltip`) y "Eliminar" aparece habilitado hasta hidratar el rol (`orgRole` null; el backend responde 403; tratar `null` como no habilitado). Mismo patrón en `pro/atenciones/columns.tsx` y `AdmisionesTable` | 008 (M3, M4) | S |

## Candidatos surgidos del feature 009

Origen: `docs/features/009-modo-desde-rol/` (decisiones del PO en `00-estado.md`, revisión 05 y seguridad 06).

| # | Ítem | Origen | Esfuerzo |
|---|---|---|---|
| 47 | Menús según el rol de la primera membresía del token: hoy el front ofrece "Ver como" y oculta enlaces con `orgRole`/`roles` del token, que corresponden a la primera membresía del token; el backend decide y responde 403. Hidratar `professionalId` y el rol por organización | decisión 8 / INFO-3 (009) | M |
| 48 | `GET fee-rules` filtra por categoría también en la vista org (residual aceptado del 009) | decisión 9 / INFO-4 (009) | S |
| 49 | `org/config` abierto a cualquier vínculo con la organización (devuelve emails y CUIT del staff): exigir ADMIN o recortar la respuesta | decisión 11 / INFO-1 (007) | S |
| 50 | Listado de pacientes en pro: el orden de deudores (`debtorWhere`) mira deuda de otros profesionales; permite inferir deuda ajena por la posición, sin montos. Acotar con `ownProfessionalsFilter` en organizaciones sin membresía | MENOR-7 (revisión 009) | S |
| 51 | El `MEMBER` ve comisión y montos por atención en org (decisión 1 del 009, aceptada): feature que oculte montos por rol | BAJA-1 (seguridad 009) | M |
| 52 | El modo se valida contra la organización del header y `POST /activity` puede apuntar a otra en el body (documentado). Quitar `organizationId` del body o rechazarlo si difiere del header; mientras tanto el front no lo manda | BAJA-2 (seguridad 009) | S |
| 53 | `new Error(...)` en la regla de primera carga de `activity.service.ts` responde 500: pasar a `BadRequestException`/`ForbiddenException`. Relacionado con #13 | INFO-2 (seguridad 009) | S |
| 54 | Mover `ownProfessionalsFilter` de `application/features/patients/patient-read-access.ts` a `domain/features/patients/` (hoy `patients.service.ts` de infraestructura importa de `application/`) | MENOR-6 (revisión) / INFO-8 (seguridad) 009 | S |

Nota para #12 (whitelist): con `forbidNonWhitelisted` el `?mode=` que manda el front en dashboard, work-items y pacientes daría 400
(INFO-1 de seguridad del 009); declarar el campo en los DTOs de esas queries antes de activarlo.

## P1 — Endurecimiento y consistencia

| # | Ítem | Esfuerzo |
|---|---|---|
| 9 | **RESUELTO (feature 005).** CORS desde `CORS_ORIGIN` (lista blanca), sin `origin: true` | S |
| 10 | Sesión en cookie `HttpOnly; Secure; SameSite=Lax` emitida por el backend (o route handler de Next); eliminar `'mock_token'`; middleware que valide expiración | M |
| 11 | **PARCIAL (feature 005):** el 400 por campos faltantes está hecho; falta el rate limiting. Rate limiting en login (`@nestjs/throttler`) y respuesta 400 si faltan campos | S |
| 12 | `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`; DTOs explícitos para fee rules y settings de organización | M |
| 13 | Filtros de error sin `details` hacia el cliente; mapear errores de negocio a 400/403/404/409 (`BadRequestException`, etc.) en lugar de `Error` | S |
| 14 | **RESUELTO (Swagger en el 005; `NODE_TLS_REJECT_UNAUTHORIZED` y body limit en el 010).** Swagger solo fuera de producción (hecho en el 005, en `/docs`); quitar `NODE_TLS_REJECT_UNAUTHORIZED=0`; bajar body limit a ~1 MB | S |
| 15 | Eliminar `/test-suite` del build de producción | S |
| 16 | Transacciones Prisma (`$transaction`) en `createActivity`, `MergePatientCommand` y borrado de staff; revisar que borrar staff no afecte membresías de otras orgs | M |
| 17 | Dinero con `Prisma.Decimal` de punta a punta en splits, KPIs y liquidaciones | M |
| 18 | ~~Arreglar estructura del repo raíz (`.gitmodules`, gitlinks, remoto)~~ **RESUELTO (features 001/002):** hay un único repo (remoto `github.com/mzaracho/solidus`, rama `main`) con `backend/` y `frontend/` como carpetas; sin gitlinks. Pendiente fuera de este ítem: confirmar el remoto antes del push (ver `docs/features/002-sin-credenciales-en-repo/06-seguridad.md`, M-1) | S |
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
