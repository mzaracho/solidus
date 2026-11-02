# 04 — Implementación: 005-seguridad-backend

> Autor: desarrollador (sesión de continuación). Entrada: `00-estado.md`, `01-spec.md`, `02-ux.md`, `03-diseno-tecnico.md`.
> No se ejecutó `dev.ps1` contra el `.env` real, no se levantó el stack, no hubo SQL ni seeds, no se tocó el 3000, no se
> modificaron `.env`, `backend/.env` ni `.claude/`. No hay commit ni push. Sin schema nuevo.
> Convención del documento: **[S1]** = venía de la sesión anterior (verificado ahora); **[AHORA]** = hecho en esta sesión.

## 1. Estado

**Completo** (pasos 1 a 13), con los desvíos de la sección 6. Quedan para el tester las pruebas en vivo (plan 9.5) y para
el documentador la sección "Documentación" del diseño.

## 2. Qué se hizo por paso del plan

| Paso | Contenido | Origen |
|---|---|---|
| 1 Dependencias | `next` y `eslint-config-next` 16.4.3 exactos (lock coherente); `axios` `^1.20.0` con lock en 1.20.0. Backend y frontend compilan | [S1], verificado [AHORA] |
| 2 Logs | `runtime-env.ts`, `redact.ts`, `Logger`, `NestLoggerAdapter`, `LoggingInterceptor`, limpieza de `console.*` (dispatcher, pro-controller, activity.service, update-organization, axios-logger-interceptor eliminado). Hoy `console.*` solo existe en `logger.ts` | [S1] código; **[AHORA] tests** (`redact.spec`, `runtime-env.spec`, `logging.interceptor.spec`) |
| 3 JWT | `jwt-config.ts` (HS256, issuer, audience, 8 h, `verifyOptions`), un único `JwtModule` en `app-module`, `auth-module` sin `JwtModule` | [S1] código; **[AHORA]** `jwt-config.spec.ts` ajustado |
| 4 Autenticación | `AuthenticationGuard` global, `guard-provider`, `auth-context`, `@CurrentUserId`, `@OrgOptional`, `@Public` leído de handler y clase, `HealthModule` (`GET /health/liveness`), guards viejos eliminados, `BaseController` vacío con `@ApiBearerAuth` | [S1] código; **[AHORA]** `authentication-guard.spec.ts` |
| 5 Identidad | `@CurrentUserId()` en Activity, Dashboard, Patients, FeeRules y Pro; `x-user-id` solo aparece en el guard | [S1] código; **[AHORA]** `security-invariants.spec.ts` |
| 6 Pertenencia | `OrgAccessService`, `OrgAccessGuard` (fuentes header, query y body; UUID; obligatoria salvo `@OrgOptional`), `HttpFilter` con `code` | [S1] código; **[AHORA]** `org-access-guard.spec.ts` (incluye el servicio) |
| 7 Rol | `OrgRoleGuard` con el rol de la base para cada organización pedida | [S1] código; **[AHORA]** `org-role-guard.spec.ts`, `guard-chain.spec.ts` |
| 8 Login | `LoginRequestDto` (`@Transform` crudo), `BadRequestException`, hash ficticio para igualar tiempos, `Professional` filtrado por `deletedAt` y `status` | [S1] código; **[AHORA]** `login.spec.ts` |
| 9 CORS y Swagger | **[AHORA]** `cors-config.ts` reescrito (lista por comas, regex, falla en producción si falta, `credentials:false`, `x-user-id` fuera de `allowedHeaders`, `maxAge` 600), `swagger-config.ts` (solo fuera de producción, en `/docs`, `addBearerAuth`), `bootstrap.ts` (sin imports sin usar, interceptor con `debugEnabled`, CORS antes que Swagger), comentario de `listen-config.ts`; `cors-config.spec.ts` | **[AHORA]** (ver nota) |
| 10 dev.ps1 y compañía | **[AHORA]** `ConvertTo-CorsOriginList`, `Get-DevCorsOrigin`, `CORS_ORIGIN` generado en `backend/.env` (clave derivada, reemplaza líneas locales, cabecera actualizada), `CORS_EXTRA_ORIGINS` validada en `Test-RootEnv`, texto nuevo de `Get-BindExposureWarning`, `$script:BackendHealthPath`, los dos `Wait-Http` y `Invoke-SmokeTest` usan `/health/liveness`, `Show-Urls -SwaggerUrl` (Docker: "deshabilitado"), `docker-compose.yml` con `CORS_ORIGIN`, `.env.example`, `backend/.env.example` | **[AHORA]** |
| 11 Front, base | **[AHORA]** `lib/session.ts` (sin imports) y `session.test.mts`, `constants.ts` (`ROUTES`, `API_ERROR_CODE`, `SESSION_MESSAGES`), `data.ts` (transporte único, `ApiContext`, errores tipados, notificador, `login`, `rethrowServerAuthError`), `session.server.ts`, `work-items/page.tsx` con `withServerSession` | **[AHORA]** |
| 12 Front, UI | **[AHORA]** `LoginForm` + `login/page.tsx` (Server Component), `middleware.ts`, `/sin-acceso` + `AccessDenied`, `app/page.tsx`, `Sidebar`, `providers.tsx`, 5 componentes con `isHandledApiError` | **[AHORA]** |
| 13 Calidad | Sección 5 | **[AHORA]** |

Nota sobre el paso 9: el 00-estado solo señalaba que `backend/.env.example` mencionaba `CORS_ORIGIN`; al revisar, `cors-config.ts`, `swagger-config.ts` y `bootstrap.ts` estaban **sin cambiar** (`origin: true`, Swagger en `/`, imports sin usar). Se rehicieron en esta sesión.

## 3. Archivos

**Creados** (backend): `guards/authentication-guard.ts`, `guards/org-access-guard.ts`, `config/providers/guard-provider.ts`,
`config/core/authentication/{auth-context,current-user-decorator,org-optional-decorator}.ts`, `config/core/redact.ts`,
`config/app/runtime-env.ts`, `infrastructure/features/auth/services/org-access.service.ts`,
`application/features/auth/dtos/login-request.dto.ts`, `api/controllers/health/health-controller.ts`,
`modules/features/health/health-module.ts`. Tests [AHORA]: `authentication-guard.spec.ts`, `org-access-guard.spec.ts`,
`org-role-guard.spec.ts`, `guard-chain.spec.ts`, `login.spec.ts`, `logging.interceptor.spec.ts`, `redact.spec.ts`,
`runtime-env.spec.ts`, `cors-config.spec.ts`, `src/security-invariants.spec.ts` y el helper `backend/test/helpers/login-app.ts`
(fuera del build: `tsconfig.build.json` excluye `test`).

**Creados** (frontend) [AHORA]: `lib/session.ts`, `lib/session.test.mts`, `services/session.server.ts`,
`components/domain/auth/{LoginForm,AccessDenied}.tsx`, `app/sin-acceso/page.tsx`.

**Modificados**: los listados en el diseño (sección 4) más `frontend/tsconfig.json` (`allowImportingTsExtensions`),
`frontend/package.json` (script `test`), `scripts/dev-lib.tests.ps1` (+37 aserciones), `scripts/dev-lib.{core,env,process}.ps1`,
`dev.ps1`, `docker-compose.yml`, `.env.example`, `backend/.env.example`.
`WorkItemForm.tsx` se modificó además de lo previsto (ver desvío 3).

**Eliminados** [S1]: `api-key-guard.ts`, `jwt-auth-guard.ts`, `auth-guard-provider.ts`, `interceptor-provider.ts`,
`axios-logger-interceptor.ts`, `verify-token-module.ts`, `verify-token-service.ts`, `i-verify-token-service.ts`.

**Restaurado**: `scripts/dev-lib.tests.ps1` figuraba **borrado** en el working tree (sin stage) al empezar esta sesión: la sesión
anterior lo eliminó por error. Se volvió a crear desde `HEAD` (`git show HEAD:...`, sin `checkout`) y se le agregaron los tests nuevos.

Efecto lateral inofensivo: `prettier --write` pasó por cinco archivos no tocados (`body-parser-config`, `global-prefix-config`,
`logger-config`, `pipes-config`, `public-decorator`). `git diff` no muestra cambios de contenido en ellos, solo el aviso LF/CRLF.

## 4. Dependencias (versiones finales)

| Paquete | Versión | `npm audit --omit=dev` |
|---|---|---|
| `next` (frontend) | 16.4.3 exacta | sin avisos |
| `eslint-config-next` | 16.4.3 exacta | n/a (dev) |
| `axios` (backend) | `^1.20.0`, lock en 1.20.0 | sin avisos |

Residuales fuera de alcance: frontend, 1 alta en `source-map-js` (transitiva); backend, avisos de Nest 10 y transitivas (`proxy-addr`
crítico, `body-parser`, `multer`, `qs`, `path-to-regexp`, `lodash`, `js-yaml`, `file-type`, `fflate`, `@nestjs/core`), todos ya conocidos y que requieren un
upgrade mayor.

## 5. Resultados de calidad

| Control | Resultado |
|---|---|
| `npx tsc --noEmit` backend | Sin errores |
| `npx tsc --noEmit` frontend | Sin errores |
| `npm test` backend | **12 suites, 134 tests, todos en verde** (antes: 2 suites) |
| `npx eslint` backend (archivos nuevos y reescritos) | Sin errores. Los specs y el helper llevan un `eslint-disable` de las reglas `no-unsafe-*` (las mismas que ya ignora `jwt-config.spec.ts` con comentarios) |
| `npx eslint` backend (archivos preexistentes tocados) | Quedan errores **preexistentes**: prettier del código viejo (CRLF, comas, imports largos), `no-unsafe-*` y `no-unused-vars` en controladores, `activity.service.ts` (65), `update-organization-command.ts`, `dispatcher.ts`, `logger.ts`, `nest-logger-adapter.ts`. No se reformatearon: la regla 8 prohíbe `--fix` masivo y sería ruido en el diff. Se corrigió el único error que introduje (`pro-controller.ts`, línea de `getMemberships`) |
| `npm run lint` frontend | 143 errores y 54 avisos en total (197 problemas); todos los archivos nuevos están limpios. En los archivos tocados quedan solo `no-explicit-any` y `react-hooks/*` preexistentes. No hay línea base previa medida (no se puede revertir para medirla) |
| `npm run build` frontend | OK, Next 16.4.3 (Turbopack). Sin error de Google Fonts. Aviso de deprecación de `middleware` (BACKLOG 31). Rutas nuevas: `/sin-acceso` y `/login` dinámica |
| `npm test` frontend (`node --no-warnings --test`) | 7 tests, 7 en verde. **Funciona el plan A** de §9.3 (Node 24 local) |
| `dev-lib.tests.ps1` | **1017 OK, 0 fallidos** (980 previos + 37 nuevos) |
| `docker compose config --quiet` | OK, con y sin `docker-compose.extra-ca.yml` |

Cobertura de los criterios de Jest (§9.1): los 10 specs pedidos existen. En `guard-chain.spec.ts` el orden se verifica con el
estado HTTP (sin token da 401 y no 403) y con `Reflect.getMetadata('providers', AppModule)`, que contiene los dos `APP_GUARD` en orden.
`logging.interceptor.spec.ts` captura `console.*`, `process.stdout` y `process.stderr`; el caso del criterio 11 (login con
contraseña y token ficticios) comprueba que ni la contraseña, ni el token, ni su firma, ni el header `Authorization`, ni la cookie aparecen, y que sí aparece `[REDACTED]`.

## 6. Desvíos respecto del diseño

1. **`apiFetch(url, init)` en lugar de `apiFetch(url, init, { orgSlug, token })`.** Los headers los sigue armando `getHeaders(slug, token)`,
   que toma el token de `ctx` o de la cookie, y `apiFetch` solo clasifica la respuesta (401 y 403). Es interno y evita reescribir los 36
   sitios de llamada. El resultado es el mismo: `x-org-id` es el segmento de la URL, no se envía `x-user-id`, el servidor sin token no llama a la API.
2. **`ApiContext` es el último parámetro opcional de las 36 funciones exportadas de `data.ts`**, no solo de las que usa el servidor.
   Lo pide el diseño ("en todas las funciones").
3. **`isHandledApiError` en `WorkItemForm.tsx`, no en `AdmisionesTable` ni `PacientesTable`.** El `catch` que muestra
   `error.message` de `createWorkItem` está en `WorkItemForm` (lo comparten las tres tablas) y, además, en `AtencionesTable` (donde
   se conserva el re-throw para que el formulario no se cierre). `AdmisionesTable` y `PacientesTable` no tienen `catch` propio. Son
   cinco sitios (`WorkItemForm`, `AtencionesTable`, `profesionales`, `settings/general`, `ActivityTypesManager`) en vez de los seis del diseño.
4. **`createStaff`, `createPayer` y similares** que capturan el error y devuelven `null` o `{ success: false }` siguen mostrando su
   toast genérico además del de 403 (UX 3.5, riesgo ya anotado en §10 del diseño).
5. **Aviso de `Get-BindExposureWarning`:** dice que la API exige JWT y organización pero queda accesible en la red, y que hay que
   agregar `http://<IP>:<puerto>` a `CORS_EXTRA_ORIGINS`. El test existente sigue exigiendo "JWT" y "red", y se agregaron las
   comprobaciones del diseño. `ConvertTo-CorsOriginList` no muestra el valor inválido en el mensaje (consistente con el resto de `Test-RootEnv`).
6. **`/health/liveness` fuera de `/api`:** se confirmó con `guard-chain.spec.ts` (200 sin token; `/api/health/liveness` da 404).
7. **`backend/test/helpers/login-app.ts`** es un helper compartido entre `login.spec` y `logging.interceptor.spec`, que el diseño no listaba.
   Está fuera del build.
8. **`bcrypt.compare` espiado con `jest.mock`:** el namespace de `bcrypt` no admite `jest.spyOn` con `esModuleInterop`; el mock envuelve la función real.
9. El script de frontend `test` usa `node --no-warnings --test` para ocultar el aviso `MODULE_TYPELESS_PACKAGE_JSON`.

## 7. Cómo probarlo

- Backend: `cd backend && npx tsc --noEmit && npx jest`.
- Frontend: `cd frontend && npx tsc --noEmit && npm test && npm run build`.
- dev-lib: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-lib.tests.ps1`.
- En vivo: plan 9.5 del diseño (a cargo del tester). Puntos que conviene mirar especialmente:
  - `-Init` genera una sola línea `CORS_ORIGIN` con los orígenes de `FRONTEND_PORT` (3002);
  - `-Smoke` ahora consulta `/health/liveness`; `/` da 404 y `/docs` 200 solo en desarrollo;
  - en Docker, `NODE_ENV=production` exige `CORS_ORIGIN` (lo define el compose) y no monta Swagger.

## 8. Pendientes y riesgos para el revisor y el tester

- **Sin prueba en vivo:** nada de esto se ejecutó contra Postgres, el stack ni el navegador. Los specs usan Prisma mockeado.
  La consulta de `OrgAccessService` se verificó solo por la forma del `where`.
- **Archivo `dev-lib.tests.ps1` borrado y restaurado** (sección 3): el revisor debería comparar con `HEAD` que el diff sean solo líneas agregadas.
- **Líneas CRLF/LF:** varios archivos preexistentes tienen finales mixtos; los que reescribí con `prettier`/`Write` quedan en LF. Git avisa del reemplazo. No afecta al comportamiento.
- **`x-org-id` ahora es la organización de la URL.** Si algún componente pasa un `orgSlug` que no es un UUID (por ejemplo `/test-suite` usa `'default-org-id'`), recibe 403 (antes 500). Es lo esperado según el diseño.
- **`Sidebar`** usa el `orgSlug` de la URL para `getProfessionalContext`; el estado persistido en el store ya no se consulta ahí.
- **Revisar `LoginForm`** (UX): foco tras 400/401/red, `role="alert"` siempre presente, doble Enter, `noValidate` (agregado para que el 400 del backend llegue al mensaje UX 1.3 en lugar de la validación nativa; el campo vacío ya no lo bloquea el navegador).
- **Contraste** (UX §5): el aviso ámbar usa `text-amber-300` sobre `bg-amber-950/30` y el error `text-red-400`. No se midieron los ratios; queda para el tester/UX.
- **Middleware**: la rotación `middleware` a `proxy` sigue pendiente (BACKLOG 31); Next 16.4 lo avisa en el build.
- **Residuales declarados en el diseño (§11, punto 7):** IDOR por `:id`, `ConfigController` sin `ADMIN`, `x-mode`, usuarios con `deletedAt` que pueden loguearse.
- **Seguridad:** `Authorization` nunca se loguea; `data.ts` ya no imprime headers. Las cookies de sesión siguen sin `HttpOnly` (BACKLOG 10).
- **Si el revisor quiere línea base de lint del front:** comparar contra `HEAD` en un worktree aparte (no se hizo para respetar la prohibición de `stash`/`checkout`).
