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
| 35 | Upgrade a Nest 11 o superior. **Tras el 021** `proxy-addr` y los altos/críticos de producción están resueltos; quedan 4 moderados de producción (`@nestjs/core` SSE, `@nestjs/common`/`file-type`, `@nestjs/platform-express`) y los altos de desarrollo de la cadena `@nestjs/cli` 10 (`glob`, `picomatch`, `tmp`): se cierran con Nest 11/12 (022) | H-2 | L |
| 36 | **RESUELTO (feature 021):** `npm audit fix` en el frontend (`source-map-js` 1.2.2; `npm audit` = 0) | H-3 | S |
| 37 | **RESUELTO (feature 010).** Loguear requests fallidos (método, ruta, status, duración), incluidos los 401 y 403 de los guards, sin datos sensibles | B-3 | S |
| 38 | **RESUELTO (feature 010).** Bajar el límite del body (hoy 50 MB) a 1–2 MB (queda `BODY_SIZE_LIMIT`, default 1mb, máx 10mb) | B-4 | S |
| 39 | **RESUELTO (feature 011).** `ProductionController` y `ReportingController` (no registrados, tomaban `userId` de la query) borrados junto con sus queries; también se eliminó `PUT /api/profile` (`ProfileController`, mock no registrado; el front usa `PUT /pro/profile`). Guardia estructural: el test `(a2)` de `test/org-isolation.spec.ts` falla si un `@Controller` de `src/` no está registrado en un módulo | B-1 | S |

Notas del feature 010 (`docs/features/010-logs-y-limites/06-seguridad.md`):
- I-4: **resuelto (feature 013).** Se creyó que un error con otro status o sin `type` caía en el manejador por defecto
  de Express; en realidad los errores de `next(err)` los toman los filtros de Nest. Igual se agregó `finalErrorHandler`
  (`filters/final-error-handler.ts`) como defensa en profundidad.
- I-2: los UUID de recursos quedan en la ruta del log de acceso. Considerarlo en una política de retención de logs.
- El compose no pasa `BODY_SIZE_LIMIT` al contenedor (queda en 1mb): declararlo en el compose si hace falta hacerlo configurable.

## Candidatos surgidos del feature 007

Origen: `docs/features/007-aislamiento-organizaciones/` (06-seguridad, 05-revision, 07-testing).

| # | Ítem | Riesgo | Esfuerzo |
|---|---|---|---|
| 40 | **RESUELTO (feature 017):** forma única `{ beneficiary, type, value, roleLabel? }` y montos acotados al bruto. Motor de honorarios: unificar la forma de `splits` entre la UI (`{role, percentage, beneficiaryType}`) y `FeeResolutionService` (`{beneficiary, type, value}`) y acotar los montos `FIXED` al bruto de la atención (`computeAmounts`: limitar a `grossAmount - totalAllocated`, mínimo 0) | MEDIA-2 (007) | M |
| 41 | **RESUELTO (feature 009).** `settlements/calculate`: usar `@CurrentOrgId()` en lugar de `organizationId` de la query y sumar el controlador al invariante de `security-invariants.spec.ts`; evaluar `@RequireOrgRole('ADMIN')` en `settlements/calculate` y acceso por rol en el dashboard en modo organización | MENOR-1 e INFO-1 (007) | S |
| 42 | **RESUELTO (feature 013).** Mensajes de error 404 en español y sin JSON crudo en los toasts del front (`updateWorkItem`/`deleteWorkItem` en `data.ts`, `AtencionesTable`, `AdmisionesTable`, `WorkItemForm`) | m-4 (re-revisión 1) | S |
| 43 | **RESUELTO (feature 014): todos los comandos de update tienen DTO validado (enums, email, fechas, topes); restos en #67 y #70.** DTOs con class-validator en los comandos de update (`UpdatePatientCommand`, `UpdateActivityCommand`, `UpdateStaffCommand`: enums de pago, email, fechas) para evitar 500 de Prisma. Relacionado con #12 | S-2 / BAJA-2 resto | M |
| 44 | **RESUELTO (feature 008).** Ocultar "Eliminar" al MEMBER también en `workload/columns.tsx`: `canDeleteActivity` (`src/lib/activity-permissions.ts`) compartida con `AdmisionesTable`; ítem deshabilitado con tooltip. El bug de la tabla de work-items vacía ("No results", O-3 del 005) también quedó resuelto por el 008 | 007 §8.1 | S |
| 45 | **RESUELTO (feature 017):** monto y pagador editables si la atención no está cobrada (recálculo de participantes y splits; 409 si está cobrada). Editar atención: `PUT /activity/:id` ignora monto (`grossAmount`) y pagador (solo persiste `date`, `paymentStatus`, `paymentMethod`, `paymentDate`, `attendance`), pero `workload/RetroactiveModal` y otros formularios permiten cambiarlos y la UI informa éxito. Además el pagador faltante se muestra "—" y se reenvía como valor (M2). Definir si se pueden editar (recalcular splits) o deshabilitarlos en la UI. Relacionado con #17 y #40 (motor de honorarios) | 008 (M1, M2) | M |
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
| 53 | **RESUELTO (feature 013): `BadRequestException` 400 `first-load-required`.** `new Error(...)` en la regla de primera carga de `activity.service.ts` responde 500: pasar a `BadRequestException`/`ForbiddenException`. Relacionado con #13 | INFO-2 (seguridad 009) | S |
| 54 | Mover `ownProfessionalsFilter` de `application/features/patients/patient-read-access.ts` a `domain/features/patients/` (hoy `patients.service.ts` de infraestructura importa de `application/`) | MENOR-6 (revisión) / INFO-8 (seguridad) 009 | S |

Nota sobre #12: resuelto en el 014; el `?mode=` que manda el front (INFO-1 de seguridad del 009) quedó declarado en los DTOs de esas queries.

## Candidatos surgidos del feature 011

Origen: `docs/features/011-controladores-huerfanos/06-seguridad.md`.

| # | Ítem | Origen | Esfuerzo |
|---|---|---|---|
| 55 | **RESUELTO (feature 018): handler registrado y test `cqrs-handlers.spec.ts`.** `LogoutCommandHandler` (`auth/logout-command-handler.ts`) no lleva `@RequestHandler` ni está registrado: el endpoint de logout probablemente responde "Handler not found". Preexistente; resolver en el feature 017 (cookie `HttpOnly`, ítem 10 de P1), que rehace el logout | MENOR-3 (seguridad 011) | S |

## Candidatos surgidos del feature 012

Origen: `docs/features/012-rate-limiting-login/06-seguridad.md` y `05-revision.md`.

| # | Ítem | Origen | Esfuerzo |
|---|---|---|---|
| 56 | Detrás de Docker Desktop, NAT o proxy todos los clientes comparten IP (la del gateway): 20 peticiones agotan el límite por IP de todos y 5 intentos con un email lo bloquean para todos. Configurar `trust proxy` con la lista exacta de proxies de confianza y tomar la IP real antes de exponer el servicio. Relacionado con #19 (docker-hardening) | M-2 (seguridad 012) | M |
| 57 | Almacén lleno (10.000 claves): ~480 IPv4 (cada una crea hasta 21 claves por ventana) o un /48 IPv6 bloquean los logins de IPs nuevas durante la ventana (denegación, sin bypass). Agregar `Logger.warn` con frecuencia limitada en los rechazos por almacén lleno (sin IPs ni emails), tope configurable o almacén compartido antes de exponer el servicio. Incluye N1 del revisor: la IPv6 mapeada en hexadecimal o `0:0:0:0:0:ffff:a.b.c.d` cae en el /64 de ceros en vez de tratarse como IPv4 (Node informa la forma con puntos, no se da en la práctica) | N-1 (seguridad 012) / N1 (revisión 012) | S |
| 58 | Bajos del rate limit: ráfaga doble en el borde de la ventana fija (B-1; ventana deslizante o backoff), sin límite por usuario independiente de la IP, lo que permite fuerza bruta distribuida (B-2; captcha, bloqueo de cuenta o 2FA) y máximos configurables altos que permiten debilitar el límite por error (I-5; advertir si se superan 100) | B-1, B-2, I-5 (seguridad 012) | M |

## Candidatos surgidos del feature 013

Origen: `docs/features/013-errores-sin-details/` (00-estado, 05-revision, 06-seguridad).

| # | Ítem | Origen | Esfuerzo |
|---|---|---|---|
| 59 | Errores únicos (P2002) y de clave foránea (P2003) de Prisma como 409 en lugar de 500 genérico; requiere analizar la enumeración por campos únicos | decisión 5 (013) | M |
| 60 | El 403 de "atención ya cobrada" pasarlo a 409 (hoy el cliente recibe el 403 genérico) | decisión 2 (013) | S |
| 61 | **RESUELTO (feature 021):** quitados `axios` y `@nestjs/axios` de `package.json` (un test de pisos comprueba que no vuelvan) | decisión 7 (013) | S |
| 62 | El CUIT de organización en `payer-commands.ts` enumera entre organizaciones (el mensaje distingue si existe en otra) | B-2 (seguridad 013) | S |
| 63 | Log de `error.message` de errores no Prisma en producción (hoy recortado a 200 y saneado): evaluar registrar solo la clase | B-3 (seguridad 013) | S |
| 64 | Test del orden `app.init()` / `app.use(finalErrorHandler)` / `listen` contra el bootstrap real (hoy se prueba con la misma secuencia en un spec) | M-4 (revisión 013) | S |
| 65 | Acoplamiento `body-parser-config.ts` ↔ `error-contract.ts` (textos y códigos genéricos): unificar la fuente | M-5 (revisión 013) | S |
| 66 | Mensajes de validación de class-validator salen en inglés (el front muestra un genérico en español): traducirlos o devolver un detalle por campo | decisión 4 (013) | M |

## P1 — Endurecimiento y consistencia

| # | Ítem | Esfuerzo |
|---|---|---|
| 9 | **RESUELTO (feature 005).** CORS desde `CORS_ORIGIN` (lista blanca), sin `origin: true` | S |
| 10 | **RESUELTO (feature 018): cookie `solidus_session` `HttpOnly` emitida por el backend, CSRF por header y `Origin`, logout real, token fuera del JS.** Sesión en cookie `HttpOnly; Secure; SameSite=Lax` emitida por el backend (o route handler de Next); eliminar `'mock_token'`; middleware que valide expiración | M |
| 11 | **RESUELTO (features 005 y 012):** el 400 por campos faltantes es del 005; el rate limiting del login es del 012 (implementación propia sin `@nestjs/throttler`: 5 por IP + usuario y 20 por IP en 15 min, 429 con `Retry-After`; residuales en #56 a #58) | S |
| 12 | **RESUELTO (feature 014): `RequestValidationPipe` global con `whitelist`, `forbidNonWhitelisted` en bodies y DTOs explícitos (fee rules y settings de organización incluidos).** `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`; DTOs explícitos para fee rules y settings de organización | M |
| 13 | **RESUELTO (feature 013): contrato `{ code, errors }` sin `details`, `X-Error-Id` en 5xx, `axios-filter` borrado.** Filtros de error sin `details` hacia el cliente; mapear errores de negocio a 400/403/404/409 (`BadRequestException`, etc.) en lugar de `Error` | S |
| 14 | **RESUELTO (Swagger en el 005; `NODE_TLS_REJECT_UNAUTHORIZED` y body limit en el 010).** Swagger solo fuera de producción (hecho en el 005, en `/docs`); quitar `NODE_TLS_REJECT_UNAUTHORIZED=0`; bajar body limit a ~1 MB | S |
| 15 | Eliminar `/test-suite` del build de producción | S |
| 16 | **RESUELTO (features 007 y 015):** `createActivity`, la fusión de pacientes y el borrado de staff van en `$transaction` interactiva (el 007 las introdujo y el 015 agregó la guardia estática `transactions-invariants.spec.ts`, tests de atomicidad y el cierre de dos carreras). Transacciones Prisma en `createActivity`, `MergePatientCommand` y borrado de staff; revisar que borrar staff no afecte membresías de otras orgs | M |
| 17 | **RESUELTO (feature 017):** helper `money.ts` sobre `Prisma.Decimal` y guardia `money-invariants.spec.ts`. Dinero con `Prisma.Decimal` de punta a punta en splits, KPIs y liquidaciones | M |
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
| 25 | `npm audit fix` no-breaking en ambos repos **(RESUELTO en el 021, sin `--force`)**; sigue pendiente el plan de migración Nest 10 → 11/12 y Prisma 5 → 6/7 (022) | M / L |

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

## Candidatos surgidos del feature 014

Origen: `docs/features/014-validation-whitelist/` (00-estado decisiones 2, 3 y 7; 05-revision; 06-seguridad).

| # | Ítem | Origen | Esfuerzo |
|---|---|---|---|
| 67 | `PacientesTable` es un mock que manda un array a `POST activity` y recibe 400 (igual que antes del 014): conectarlo a un body válido o retirarlo | decisión 2 (014) | S |
| 68 | `PUT org` reemplaza el JSON de `settings` en vez de fusionarlo con lo guardado: fusionar claves | decisión 3 (014) | S |
| 69 | `paymentMethod` y otros textos libres (`serviceType`, `linkedType`, `code`, `role`, `professionalCategory`) hoy solo con tipo y largo máximo: convertir `paymentMethod` en enum y evaluar el resto | decisión 7 (014) | M |
| 70 | **RESUELTO (feature 015):** M-1 (`@IsOptionalNotNull()` en `canLoadActivities`), M-2 (tests de `null` en `roles`, ya daban 400), N1 y N3. Menores del 014 que se resuelven en el feature 015: M-1 (seguridad: `UpdateStaffCommand.canLoadActivities` con `null` da 500; usar `@IsOptionalNotNull()`), M-2 (seguridad: test de `null` dentro de `roles`), N1 (revisor: comentarios y Swagger desactualizados en `ActivityTypeRoleDto`) y N3 (revisor: prettier en dos imports) | M-1, M-2 (seguridad 014) / N1, N3 (revisión 014) | S |

`RetroactiveModal` (descarta `grossAmount` y `payerName` en el builder) ya está cubierto por #45.

## Candidatos surgidos del feature 015

Origen: `docs/features/015-transacciones/` (03-diseno-tecnico, 04-implementacion, 05-revision, 06-seguridad, 07-testing).

| # | Ítem | Origen | Esfuerzo |
|---|---|---|---|
| 71 | Limitaciones del detector `test/helpers/prisma-writes.ts`: alias de `this.prisma`, `$executeRaw` como plantilla, servicios fuera de `this.<x>Service`, arrow en propiedades de clase, una escritura dentro y otra fuera de la transacción (puede ir al 025) | 04/05 (015) | S |
| 72 | Deadlock en fusiones cruzadas de pacientes (A→B y B→A a la vez): hoy responde 500; reintentar o responder 409 | diseño/seguridad (015) | S |
| 73 | Restricciones únicas faltantes (pagador por defecto, fee rule por pagador y categoría, CUIT del profesional) y `onDelete: Restrict` en `WorkItem.activityType` y `WorkItem.patient` | hallazgos del arquitecto (015) | M |
| 74 | Ventana residual: durante la fusión de pacientes aún puede crearse una atención para el paciente origen | seguridad (015) | S |
| 75 | **RESUELTO (feature 017):** 409 `payer-has-fee-rules` y `payer-has-activities`, FK `Restrict`. Borrar un pagador con fee rules → reglas globales: decisión provisional 409; se resuelve en el feature 017 | 015 | S |
| 76 | **RESUELTO (feature 017):** baja lógica si hay participaciones o splits. Borrado físico de un staff que es participante de atenciones (500) o beneficiario de splits: se resuelve en el feature 017 | 015 | S |
| 77 | Dockerfile del backend: `migrate deploy; start:prod` con `;` (arranca aunque falle la migración); usar `&&` (al feature 020) | 015 | S |

## Candidatos surgidos del feature 016

Origen: `docs/features/016-schema-y-migraciones/` (05-revision, 06-seguridad, 07-testing). **RESUELTO en el 016:** la deriva entre
`schema.prisma` y las migraciones (migración `20261104192244_align_schema_with_migrations`, guardia `-CheckMigrations`,
baseline en la base local) y `User.cuit` sin migración (pendiente desde el 004). Los menores de `dev.ps1` (78, 79 y 81 a 86) se
agrupan en el feature 024-dev-ps1-node-env, por tocar el mismo script. Todos de prioridad baja.

| # | Ítem | Origen | Esfuerzo |
|---|---|---|---|
| 78 | Si falla el primer `resolve` de `-BaselineMigrations`, el hint de reversión sale vacío ("...desde backend: ."): decir que no se registró ninguna migración y conservar el aviso del respaldo | re-revisión 016, menor 1 | S |
| 79 | El respaldo `pre-baseline-<yyyyMMdd-HHmmss>.dump` tiene resolución de segundos (dos corridas en el mismo segundo lo sobrescriben): agregar sufijo aleatorio | re-revisión 016, menor 2 | S |
| 80 | `User.cuit` es dato personal con índice único: al usar la columna, validar formato y unicidad en el DTO, error genérico del contrato 013 sin revelar si existe y sin loguear el valor | seguridad 016, MENOR-2 | S |
| 81 | Tras fallar la verificación de `-BaselineMigrations`, el hint lista todas las migraciones aunque alguna pudiera no haberse marcado (`--rolled-back` sobre una no aplicada da error): listar solo las marcadas | re-revisión 016, menor 3 | S |
| 82 | Si `pg_dump` falla, queda un archivo parcial en `/tmp` del contenedor: ejecutar `rm -f` también en esa rama | seguridad 016, MENOR-5 | S |
| 83 | Si `docker cp` falla y deja un archivo parcial en `.dev/backups`, no se borra: borrarlo o aplicar la ACL antes de comprobar | seguridad 016, MENOR-6 | S |
| 84 | Regex de `dev-lib.migrations.ps1` con `$` (admite salto de línea final en .NET): usar `\z` | seguridad 016, MENOR-8 | S |
| 85 | Carrera de arranque: `.\dev.ps1 -Smoke` justo después de `.\dev.ps1` falló una vez en el frontend (exit 7; con ~20 s de espera dio OK): darle al smoke un reintento corto | tester 016, anomalía A | S |
| 86 | Ramas de `-BaselineMigrations` no ensayadas en base real: migración en estado fallido (P3018; ensayada solo en copia con el procedimiento manual) y salida 12 (solo tests de funciones puras) | tester 016, sección 8 | S |
| 87 | Integrar `.\dev.ps1 -CheckMigrations` al CI cuando exista (la spec del 016 pidió documentarlo; ver #24) | revisión 016, sugerencia | S |

## Candidatos surgidos del feature 017

Origen: `docs/features/017-dinero-y-motor-honorarios/` (04-implementacion, 05-revision, 06-seguridad, 07-testing). **RESUELTO en el 017:**
#17, #40, #45, #75 y #76. Los mensajes 400 de validación en inglés (heredado) ya están registrados como #66.

| # | Ítem | Origen | Prioridad / esfuerzo | Feature sugerido |
|---|---|---|---|---|
| 88 | Reglas con `professionalCategory: 'all'` que el motor no aplica: el deslizador de `PayerRulesManager` no tiene efecto (el 017 no tocó la coincidencia; un test la fija) | decisión 1 del PO (017) | MEDIA / M | 031 y siguientes |
| 89 | Los pagadores creados desde `PayerRulesManager` crean una regla en el alta y, por el 409 de #75, no se pueden borrar desde la UI (no hay forma de quitar reglas). Se resuelve junto con #88 (misma pantalla) | pregunta 1 del desarrollador (017) | MEDIA / S | 031 y siguientes |
| 90 | Discrepancia entre el honorario del participante y el split del profesional (ej. regla 33/67: split 521.11 vs participante 505.55): los participantes usan la config por rol y los splits usan la regla (comportamiento heredado) | revisión 017 | BAJA / M | 031 y siguientes |
| 91 | 42 atenciones `PAID` sin `paymentDate` en la base local: se completan a mano desde la edición (informativo, sin cambio de código) | decisión del usuario (017) | INFO / S | sin feature |
| 92 | Cuando se persistan las liquidaciones, sumar `settlementId`/`lockedAt` a la condición "no cobrada" de la edición (`NOT_COLLECTED_WHERE`) | diseño 03 (017) | BAJA / S | 031 y siguientes |
| 93 | `PacientesTable`: carga de datos rota (`getWorkItems` devuelve `{ items, total }` y se hace `items.map` sobre el objeto, campos inexistentes `patient`/`gross`/`paid`, `professionalSplit` fijo en 0.70). Arreglar y luego conectar el cobro (la acción "Registrar Cobro" quedó oculta). Relacionado con #67 | pregunta 4 del desarrollador (017) | MEDIA / M | 031 y siguientes |
| 94 | Pagador "Particular" duplicado por una carrera (no hay unicidad por organización): se resuelve con #73 | MENOR-1 (seguridad 017) | BAJA / S | 031 y siguientes (con #73) |
| 95 | Descobrar (PAID a UNPAID) y luego editar el monto elude el bloqueo de edición: definir si revertir un cobro requiere permiso | MENOR-2 (seguridad 017) | MEDIA / S | 029 |
| 96 | Al pasar PAID a UNPAID se conserva la fecha vieja y al volver a PAID sin fecha por API se reutiliza: poner `paymentDate` en null al descobrar o exigir fecha en el pedido | MENOR-1 (seguridad 017, vuelta 1) | BAJA / S | 029 |
| 97 | `eventRole` queda fijo en `TITULAR` al recalcular participantes en la edición | diseño 03 / MENOR-8 (revisión 017) | BAJA / S | 031 y siguientes |
| 98 | La guardia `money-invariants` no ve `.toNumber()`, el `+` unario ni caminos de dinero fuera de sus 8 archivos (`MONEY_FILES`) | MENOR-4 (revisión 017) | BAJA / S | 031 y siguientes |
| 99 | Avisos `prettier/prettier` en las líneas agregadas de archivos viejos sin formatear (2 a 10 por archivo) | MENOR-3 (revisión 017) | BAJA / S | 025 |
| 100 | Cobro múltiple en `AtencionesTable` y `AdmisionesTable`: ante un fallo parcial no refresca ni informa cuáles se cobraron (heredado; `DeudoresTable` ya lo resuelve con `bulk-payment.ts`) | MENOR-2 (revisión 017) | BAJA / S | 031 y siguientes |
| 101 | El diálogo de cobro múltiple puede ofrecer una atención que otro usuario cobró mientras tanto | MENOR-10 (revisión 017) | BAJA / S | 031 y siguientes |
| 102 | `test/nest-build-compat.spec.ts` no tiene control positivo (no prueba que la regla detecte un re-export con alias) | MENOR-1 (vuelta 2, 017) | BAJA / S | 031 y siguientes |
| 103 | **RESUELTO (feature 021): Next 16.4.6, `experimental.agentUpgrade: false`; arranque en frío sin `SecurityFatalError`.** Next 16.4.3 a 16.4.6 (GHSA-mfr8-8qww-v76h, GHSA-vc7v-qv4w-wrv8; no explotables hoy) y `source-map-js` alto transitivo. El 018 sumó: el aviso `SecurityFatalError` de Next 16.4.3 corta el primer `next build`/`next dev` (repetir funciona) y `npm audit` del backend marca `proxy-addr` (crítico), `body-parser`, `multer`, `path-to-regexp`, `express` y `qs` | INFO (seguridad 017, vuelta 2) | MEDIA / S | 021 |
| 104 | `docker compose build backend` se corta con "additional privileges requested: --allow=fs.read" (buildx bake) en la máquina del usuario. El 018 tampoco pudo verificarse en Docker (`AUTH_COOKIE_SECURE=false` del compose, SSR con Bearer desde el contenedor): repetir esa prueba al resolverlo | tester 017 y 018 | BAJA / S | 020 |
| 105 | El resumen de `dev.ps1` mostró una vez "Swagger: deshabilitado (NODE_ENV=production)" con el entorno ya levantado | tester 017 | BAJA / S | 024 |

## Candidatos surgidos del feature 018

Origen: `docs/features/018-cookie-httponly/` (04-implementacion, 05-revision, 06-seguridad, 07-testing). **RESUELTO en el 018:** #10 y #55.
Las pruebas de Docker del 018 se suman al #104 y el aviso de Next 16.4.3 al #103 (no se duplican).

| # | Ítem | Origen | Prioridad / esfuerzo | Feature sugerido |
|---|---|---|---|---|
| 106 | Revocación del JWT antes de `exp`: hoy el logout solo borra la cookie y el JWT (también como Bearer) vale hasta 8 h. Opciones: `User.sessionsRevokedAt` o `jti` contra `iat`. La baja de usuario sí corta (el guard consulta `deletedAt`) | P2 (diseño 018), INFO seguridad | MEDIA / M | 031 y siguientes |
| 107 | Front y API en hosts distintos (subdominios en producción): la cookie host-only no llega al middleware ni al SSR. Resolver en el despliegue (Domain, proxy inverso o mismo host) | P4 (diseño 018) | MEDIA / M | despliegue (031 y siguientes) |
| 108 | `GET /login?reason=session_expired` borra la cookie (cierra la sesión por un enlace ajeno). Borrar solo si el token venció o no se decodifica; para inválido-no-vencido usar un marcador de un solo uso | MENOR-1 seguridad / m-3 revisión 018 | BAJA / S | 031 y siguientes |
| 109 | El borrado de la cookie desde el middleware sale sin `Secure` cuando el backend la emite con `Secure` (`NODE_ENV=local`): un navegador puede ignorarlo. Replicar el criterio del backend (probado: sin bucle, el login nuevo reemplaza la cookie) | MENOR-2 seguridad / m-1 revisión 018 | BAJA / S | 024 |
| 110 | Logout con token vencido o inválido responde 401 y no borra la cookie: hacer el logout `@Public()` con la misma verificación de `Origin` que el login | MENOR-3 seguridad / m-2 revisión 018 | BAJA / S | 031 y siguientes |
| 111 | El middleware y el `matcher` (`missing` de prefetch) no tienen test automático (se probaron con HTTP real) | m-4 revisión 018 | BAJA / S | 028 |
| 112 | `frontend/AGENTS.md` lo regenera `next dev`: decidir si se versiona o se ignora | m-5 revisión 018 | BAJA / S | 024 |
| 113 | `dev.ps1` considera el frontend "ya levantado" por la ventana y no por el puerto, y `Wait-Http` acepta un frontend que muere enseguida: un segundo `.\dev.ps1` no lo relanza | tester 018, hallazgo 2 | BAJA / S | 024 |
| 114 | Las páginas SSR con nombre y email en el payload RSC no deben cachearse en caches compartidos (proxy/CDN) | INFO seguridad 018 | BAJA / S | despliegue (031 y siguientes) |

## Candidatos surgidos del feature 021

Origen: `docs/features/021-audit-fix/`. **RESUELTO en el 021:** #36, #61, #103 y `npm audit fix` sin cambios incompatibles de #25.
Los moderados de producción restantes (`@nestjs/core` SSE, `@nestjs/common`/`file-type`, `@nestjs/platform-express`) y los
altos de desarrollo de la cadena `@nestjs/cli` 10 ya están cubiertos por #25/#35 (022): no se duplican.

| # | Ítem | Origen | Prioridad / esfuerzo | Feature sugerido |
|---|---|---|---|---|
| 115 | Retirar los `overrides` (`express`, `body-parser`, `multer`) de `backend/package.json` al pasar a Nest 11, y el test `dependency-floors.spec.ts` que los vigila (o ajustarlo) | diseño 021 | MEDIA / S | 022 |
| 116 | Lint del backend: +29 `no-unnecessary-type-assertion` por `typescript-eslint` 8.73 en archivos sin tocar (nueva base 755 errores / 153 avisos; frontend 140 / 42) | pregunta 1 (implementación 021) | BAJA / S | 025 |
| 117 | `npm audit` periódico y en el CI: con `agentUpgrade: false` el aviso de actualización de Next ya no avisa, la detección depende de `npm audit` | decisión 1 (PO 021) | MEDIA / S | 026 |
| 118 | La imagen Docker de runtime incluye dependencias de desarrollo: `npm prune --omit=dev` conservando `prisma` | seguridad 021 | BAJA / S | 020 |
| 119 | Telemetría `@scarf/scarf` en `postinstall`: desactivar con `SCARF_ANALYTICS=false` en `dev.ps1` y en el Dockerfile | decisión 3 (PO 021) | BAJA / S | 020 o 024 |
| 120 | `npm ls` del backend muestra `invalid` en subdependencias de `express` (qs, http-errors, on-finished, type-is, mime-types) por los `overrides`; benigno (`npm ci` y los tests pasan). Informativo, desaparece con #115 | implementación 021 | INFO | 022 |
| 121 | `body-parser-gzip.spec.ts` usa esperas fijas (150 ms) que pueden ser frágiles en CI; además no reproduce el fallo con body-parser 1.20.4 en Node 24 (guarda de comportamiento; la protección real son los pisos) | implementación / testing 021 | BAJA / S | 027 |
| 122 | `npm audit fix --legacy-peer-deps` del backend necesita dos pasadas para converger (informativo, al regenerar el lock) | implementación 021 | INFO | — |
