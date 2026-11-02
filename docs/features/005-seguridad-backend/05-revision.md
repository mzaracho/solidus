# 05 — Revisión: 005-seguridad-backend

Revisor: sesión de revisión del 2026-11-02. Base: último commit `e0dfd99` más el working tree (58 archivos modificados, 8 eliminados
y los nuevos sin trackear). No se modificó código, no se ejecutó `dev.ps1` contra el `.env` real, no se levantó el stack, no hubo SQL,
stash, reset, checkout, commit ni push.

## Resumen

El feature cumple la spec (criterios 1 a 22; el 23 es del documentador) y el diseño técnico. La arquitectura es la aprobada: un solo
`JwtModule`, dos `APP_GUARD` en orden (autenticación y luego pertenencia), `@CurrentUserId`, `@OrgOptional`, redacción de logs,
CORS por lista blanca, `/health/liveness` y Swagger solo fuera de producción. No encontré bloqueantes ni mayores. Hay hallazgos
menores y sugerencias, todos de pulido.

## Comandos ejecutados

| Comando | Resultado |
|---|---|
| `cd backend && npx tsc --noEmit` | Sin errores |
| `cd backend && npx jest` | 12 suites, 134 tests, todos en verde |
| `cd frontend && npx tsc --noEmit` | Sin errores |
| `cd frontend && npm test` | 7 tests, 7 en verde |
| `powershell ... scripts\dev-lib.tests.ps1` | 1017 OK, 0 fallidos |
| `npx eslint` backend sobre los 20 archivos `.ts` preexistentes tocados, contra `HEAD` (`git show HEAD:<f> \| eslint --stdin --stdin-filename`) | En ningún archivo hay más errores que en `HEAD` (detalle en el punto 4) |
| `npx eslint` backend sobre archivos nuevos y reescritos (guards, interceptor, redact, runtime-env, cors, swagger, jwt-config, http-filter, módulos tocados, `org-access.service`, specs y helper) | 0 errores. 8 avisos de "unused eslint-disable" en 2 archivos (hallazgo m-3) |
| `npx eslint` frontend sobre los 13 archivos preexistentes tocados, contra `HEAD` | Ningún error nuevo (detalle en el punto 4) |
| `npx eslint` frontend sobre archivos nuevos (`session.ts`, `session.test.mts`, `session.server.ts`, `LoginForm`, `AccessDenied`, `sin-acceso`) | 0 errores, 2 avisos (hallazgo m-3) |

No corrí `npm run build` del frontend ni nada que requiera el stack: quedan para el tester (el desarrollador informa build OK).

## Puntos específicos pedidos por el PO

### 1. `scripts/dev-lib.tests.ps1` contra `HEAD`
Confirmado. `git diff --numstat` da **52 líneas agregadas y 0 eliminadas**. Ningún test previo se borró ni se modificó. El test
existente de `Get-BindExposureWarning` no cambió: sigue pasando porque el texto nuevo conserva "JWT" y "red"; los chequeos nuevos
del diseño se agregaron aparte (`Bind 005`). Todo el diff son aserciones nuevas (CORS, salud, aviso y `Invoke-SmokeTest`). La suite
pasó de 980 a 1017 aserciones. Los mocks de red del último bloque (`Get-HttpStatus`, `Test-DockerDaemon`) se redefinen al final a
propósito, y por eso la corrida no toca la red ni Docker. Solo queda el aviso LF/CRLF de Git.

### 2. Paso 9 (CORS, Swagger, `bootstrap.ts`) contra §3.8 y §3.9
Conforme.
- `cors-config.ts`: comas, regex idéntica a la del diseño, entradas vacías ignoradas, duplicados quitados, entrada inválida
  lanza y el backend no arranca. Lista vacía: en producción lanza ("CORS_ORIGIN es obligatorio en producción"); fuera de
  producción `warn` y `origin: []`. `credentials: false`, `maxAge: 600`, métodos y `allowedHeaders` como el diseño (`x-user-id`
  fuera), sin `origin: true`.
- `swagger-config.ts`: solo si `shouldEnableSwagger` (falla cerrado), ruta `docs`, `addBearerAuth()`.
- `runtime-env.ts`: solo `development` y `test` exactos salen de producción; cualquier otro valor o su ausencia es producción.
- `bootstrap.ts`: sin imports sin usar (los 2 errores de lint preexistentes quedaron corregidos), interceptor con
  `debugEnabled`, CORS antes de Swagger, `listen-config.ts` con el comentario actualizado.
- Tests: `cors-config.spec.ts` cubre origen permitido, no permitido, preflight, variable vacía en desarrollo y en producción.
- `docker-compose.yml`, `.env.example` y `backend/.env.example` coinciden con §3.10. `CORS_METHODS` ya no se menciona.

### 3. `prettier --write` sobre 5 archivos no previstos
Confirmado: **solo cambió el fin de línea**. `git diff --numstat` da vacío (0 líneas agregadas y 0 eliminadas) para los cinco, y git
solo emite el aviso LF/CRLF. Archivos (todos en `backend/src/infrastructure.bootstrap/`):
1. `config/app/body-parser-config.ts`
2. `config/app/global-prefix-config.ts`
3. `config/app/logger-config.ts`
4. `config/app/pipes-config.ts`
5. `config/core/authentication/public-decorator.ts`

Aparecen como `M` en `git status` solo por el EOL. No hay riesgo funcional. Sugerencia: no incluirlos al commitear (ver S-1).

### 4. Lint: errores nuevos frente a preexistentes
Método: contar errores por regla del archivo actual contra `git show HEAD:<archivo>` pasado por `eslint --stdin`.

Backend (actual / `HEAD`): ninguno sube.
`activity-controller` 4/11, `org-controller` 1/1, `pro-controller` 1/3, `dashboard-controller` 2/3, `fee-rules-controller` 1/1,
`patients-controller` 2/3, `login-query-handler` 4/4, `update-organization-command` 12/12, `dispatcher` 5/6, `logger` 7/7,
`nest-logger-adapter` 5/5, `activity.service` 65/66, `base-controller`, `auth-controller` y `system-controller` 0/(1),
`bootstrap` 0/2, `cors-config` 0/4, `org-role-guard` 0/12, `logging.interceptor` 0/40. Los que quedan son prettier (CRLF, comas,
imports largos), `no-unsafe-*` y `no-unused-vars` del código viejo. El error que el desarrollador dice haber introducido y
corregido (`pro-controller`, `getMemberships`) ya no está: 1 prettier, que estaba en `HEAD`.

Frontend (actual / `HEAD`, errores): idénticos en todos los archivos (`profesionales` 5/5, `settings/general` 2/2,
`AtencionesTable` 10/10, `ActivityTypesManager` 3/3, `WorkItemForm` 34/34, `Sidebar` 1/1, `providers` 1/1, `data.ts` 13/13); en
`login/page.tsx` baja de 1 a 0 y en `Sidebar` y `data.ts` bajan los avisos. Todos son `no-explicit-any` y `react-hooks/*`
preexistentes. **No hay errores de lint nuevos introducidos por el feature, ni en backend ni en frontend.** Esto resuelve la
"línea base" que el desarrollador no pudo medir.

### 5. Desvíos declarados
Todos aceptables.
1. **`apiFetch(url, init)` solo clasifica; `getHeaders(slug, token)` arma los headers.** Aceptable: el efecto es el del diseño
   (`x-org-id` es el segmento de la URL, no se manda `x-user-id`, el servidor sin token lanza `ApiUnauthorizedError` sin llamar a
   la API) y evita tocar 36 sitios. Costo: el token viaja por dos caminos (`ctx` o cookie), lo cual es fácil de entender.
2. **`ApiContext` en las 36 funciones:** cumple lo que pide el diseño.
3. **`isHandledApiError` en 5 sitios en vez de 6:** correcto. El `catch` que muestra el mensaje está en `WorkItemForm` (compartido por
   las tres tablas) y no en `AdmisionesTable` ni `PacientesTable`.
4. **`createStaff`, `createPayer` y similares muestran el toast genérico además del de 403:** riesgo ya anotado en el diseño (§10);
   se registra como menor (m-4).
5. **`noValidate` en el login:** aceptable y coherente con UX 1.3. Deja que el 400 del backend llegue al mensaje de campos
   faltantes. El `role="alert"` permanente y la gestión de foco compensan la pérdida de la validación nativa. El `required` queda
   como semántica para lectores de pantalla.
6. Los otros desvíos (`/health/liveness` fuera de `/api`, helper `login-app.ts`, mock de `bcrypt`, script `test` con
   `--no-warnings`) son razonables y están documentados.

### 6. Identidad y `console.*`
- `x-user-id` solo aparece en `authentication-guard.ts:81` (lo pisa con `sub`). El test `security-invariants.spec.ts` lo exige.
  Ningún controlador, handler ni servicio lo lee (grep sobre `backend/src` y `frontend/src`). Todos los controladores usan
  `@CurrentUserId()` y **asignan** `userId` después de `@Query()` o `@Body()` (`activity`, `dashboard`, `patients`, `fee-rules` y
  `pro`), así que un `?userId=` o `body.userId` del cliente se pisa.
- `console.*` en `backend/src` (sin specs): solo `config/core/logger.ts` (lógica central, líneas 25 a 41). No queda ninguno con
  payloads. `dispatcher`, `pro-controller`, `activity.service` y `update-organization-command` quedaron limpios, y
  `axios-logger-interceptor` está eliminado.
- Frontend: no queda el `console.log` del Bearer (`data.ts` no imprime headers) ni `mock_token` (solo un comentario en
  `middleware.ts:23`). Sigue un `console.log("Pay", items)` en `PacientesTable.tsx:181`, **preexistente** y sin relación con la
  sesión (m-5).

### 7. Secretos, tokens y datos reales
Sin hallazgos. Revisé con grep patrones de JWT, URLs con credenciales, claves privadas y `password = '...'` sobre
`backend/src`, `backend/test`, `frontend/src`, `scripts`, `docker-compose.yml`, `.env.example`, `backend/.env.example` y
`docs/features/005-seguridad-backend`. Solo aparecen valores ficticios ya presentes (`change-me`, `fakeuser`, `$FakeOldPass`) y
`password: 'cualquiera'` en `login.spec.ts:75`. Los tests usan secretos y usuarios generados en ejecución (`'k'.repeat(40)`,
`randomUUID`, `@example.test`, IPs `192.0.2.x` reservadas para documentación). `.claude/settings.json` figura como `M` pero no tiene
cambios de contenido (`git diff --numstat --ignore-space-at-eol` vacío): es solo EOL. Regla 12 sin novedades.

## Hallazgos

### Bloqueantes
Ninguno.

### Mayores
Ninguno.

### Menores

- **m-1 — El interceptor no registra los requests que fallan.**
  `backend/src/infrastructure.bootstrap/interceptors/logging.interceptor.ts:43`. `tap({ next })` solo escribe la línea cuando el
  handler responde bien. Una excepción (400, 403, 500) no deja la línea de método, ruta, status y duración. Los 401 y 403 de los
  guards ni siquiera pasan por el interceptor. Sugerencia: agregar `error: (e) => this.logger.log(`${method} ${path}
  ${e instanceof HttpException ? e.getStatus() : 500} ${ms}ms`)`. No loguear el mensaje ni el cuerpo del error. No afecta a la
  seguridad, solo a la operación.
- **m-2 — Título del test de login dice 200 y el código devuelve 201.**
  `backend/src/application/features/auth/login.spec.ts:91` (`it('200: ...')` con `expect(res.status).toBe(201)` en la línea 93).
  Es el comportamiento que ya tenía Nest para `POST` y el `ApiResponse` se corrigió a 201, pero la spec (criterios 9 y 20) habla de
  "200". Sugerencia: renombrar a `'201: ...'` o documentarlo en el informe del tester para que nadie lo tome por regresión.
- **m-3 — Avisos de lint evitables en archivos nuevos.**
  - `backend/src/security-invariants.spec.ts:1` y `backend/test/helpers/login-app.ts:1`: el `eslint-disable` de reglas
    `no-unsafe-*`, `no-explicit-any`, `unbound-method` y `require-await` se reporta como directiva sin uso (8 avisos). Sugerencia:
    quitar las reglas que no se disparan.
  - `frontend/src/lib/session.ts:11`: `eslint-disable-next-line no-control-regex` sin uso.
  - `frontend/src/components/domain/auth/AccessDenied.tsx:44`: aviso `no-location-assign-relative-destination` por
    `window.location.assign('/')`. La navegación completa es intencional (se vuelve a evaluar la sesión), así que sugiero un
    `// eslint-disable-next-line` con ese motivo, o `<a href="/">`.
- **m-4 — Doble aviso de 403 en funciones que capturan el error** (`createStaff`, `createPayer` y similares de
  `frontend/src/services/data.ts`). Desvío 4 del desarrollador, ya previsto en el diseño §10. Sugerencia: en una vuelta posterior,
  hacer que esos `catch` relancen `ApiForbiddenError` con `handled`, o llamar a `isHandledApiError` antes del toast propio.
- **m-5 — `console.log("Pay", items)` preexistente** en `frontend/src/components/domain/org/pacientes/PacientesTable.tsx:181`.
  No es parte del feature (existe igual en `HEAD`) y no vuelca credenciales, pero sí datos de atenciones. Sugerencia: quitarlo en el
  próximo cambio que toque ese archivo.
- **m-6 — Formato de `data.ts`.** `getDashboardStats` quedó con la firma pegada (`chartBasis ... = 'ACCRUED', ctx?: ApiContext) {`) y
  con dos líneas en blanco antes de `rethrowServerAuthError` (cerca de la línea 255). Es cosmético. Sugerencia: acomodar al pasar
  por ahí.

### Sugerencias

- **S-1 — Qué no commitear.** `.vscode/settings.json` está **sin trackear y sin ignorar** (`python.terminal.useEnvFile: true`).
  No tiene secretos, pero no es parte del feature. Al commitear, usar `git add` explícito y dejarlo fuera, o ignorarlo. Lo
  mismo aplica a los 5 archivos con cambio solo de EOL (punto 3) y a `.claude/settings.json` (solo EOL).
- **S-2 — Arranque real de `AppModule`.** Los tests de guards usan Prisma mockeado y `guard-chain.spec.ts` comprueba el orden de los
  `APP_GUARD` por metadata. La inyección real de `OrgAccessService` (que necesita `PrismaService` de `PrismaModule`) es correcta
  por lectura (`PrismaModule` exporta el servicio y `AppModule` lo importa), pero nada la ejercita sin base. El tester debería
  confirmarla en vivo, junto con que la consulta de `OrgAccessService` se comporta contra Postgres (el desarrollador solo verificó la
  forma del `where`).
- **S-3 — Prueba directa de `HttpFilter.resolveCode`.** Hoy solo se cubre indirectamente (`login.spec`, `guard-chain.spec`). Un test
  unitario con un código inválido (`'Bad_Code'`, 50 caracteres, número) fijaría el comportamiento de fallback a
  `'unhandled-exception'`.
- **S-4 — Contraste (UX §5).** El desarrollador no midió `text-amber-300` sobre `bg-amber-950/30` ni `text-red-400`. Queda para el
  tester o UX.
- **S-5 — Tiempo de `navigateOnce`.** La promesa que nunca resuelve deja a los componentes en estado "cargando" hasta que termina la
  navegación completa. Es aceptable y está documentado; solo conviene que el tester lo mire con una red lenta.

## Cobertura frente al criterio 20 y a §9 del diseño

| Pedido | Dónde | Estado |
|---|---|---|
| Guard: sin token, firma inválida, expirado, `alg none`, pública, válido | `authentication-guard.spec.ts` (17 casos: header no string, sin Bearer, 2 partes, >4096, otro secreto, expirado, none, HS512, sin `iss`, `aud` distinto, `sub` no UUID, sin `exp`, `@Public` en handler y clase, válido, `bearer` en minúsculas) | Cubierto, más que lo pedido |
| `x-user-id` pisado por `sub` | `authentication-guard.spec.ts` ("pisa x-user-id con sub") y `security-invariants.spec.ts` | Cubierto |
| Pertenencia: miembro, `Professional`, ajeno, UUID y "slug" | `org-access-guard.spec.ts` (17 casos, incluidas fuentes en query y body, arrays, header repetido, obligatoriedad y `@OrgOptional`, y la forma de la consulta de `OrgAccessService`) | Cubierto |
| Rol | `org-role-guard.spec.ts`, `guard-chain.spec.ts` (401 antes que 403, orden de guards, `/health/liveness` 200 sin token) | Cubierto |
| Login 400, 401 y 200 | `login.spec.ts` (`it.each` de 400, 401 con cuerpos idénticos y `bcrypt.compare` en ambos caminos, 201) | Cubierto (ver m-2) |
| Redacción de logs y criterio 11 | `redact.spec.ts`, `logging.interceptor.spec.ts` (captura `console.*`, `stdout` y `stderr`) | Cubierto |
| CORS: permitido, no permitido, vacío | `cors-config.spec.ts` | Cubierto |
| Entorno y Swagger | `runtime-env.spec.ts` | Cubierto |
| Invariantes estáticos (sin `decode`, sin `origin: true`, un solo `JwtModule`, sin `@UseGuards` de autenticación) | `security-invariants.spec.ts` | Cubierto |
| Frontend (`session.ts`) | `session.test.mts` (7 tests: `from` seguro, `exp`, decodificación, `buildLoginPath`) | Cubierto |
| `dev-lib` | `dev-lib.tests.ps1` (+52 líneas, sin modificar ni borrar existentes) | Cubierto |

Calidad de los tests (criterio 21): usan datos generados en ejecución, no tocan red ni base, verifican comportamiento y no solo
la existencia de código, y los casos de fallo comparan el cuerpo del error para asegurar que es genérico.

## Conformidad con el diseño y la UX

- Autenticación (§3.1): HS256, `iss`, `aud`, 8 h, regex de Bearer, límite de 4096, `sub` UUID y `exp` numérico. Cualquier excepción
  es 401 genérico, sin loguear el motivo.
- Pertenencia (§3.3): cinco fuentes, valores no-string y no-UUID dan 403 sin consultar la base, se validan todos los distintos,
  obligatoria salvo `@OrgOptional` (solo `logout` y `pro/memberships`), una consulta indexada sin cache entre requests.
- Rol (§3.4): `OrgRoleGuard` ya no usa `JwtService`; el rol sale de la base para cada organización pedida.
- Login (§3.5): DTO con `@Transform` crudo, `BadRequestException`, hash ficticio para igualar tiempos, `Professional` filtrado por
  `deletedAt` y `status`.
- Errores (§3.6): `HttpFilter` usa el `code` solo si cumple `^[a-z][a-z-]{0,40}$`.
- Logs (§3.7): una línea por request sin query, `params`, `query` y `body` redactados solo en debug, nunca headers ni respuestas.
- Frontend (§3.11 y UX): `session.ts` sin imports, cookie con `max-age` limitado por `exp` y por 8 h, sin `mock_token`, 401 borra
  la cookie y va a `/login?reason=session_expired`, 403 de organización va a `/sin-acceso`, `from` saneado contra open redirect,
  `withServerSession` fuera de los `try` de `data.ts` para que `redirect()` no se trague.
- Convenciones: alias `@src/*` y `@/*`, constantes en `lib/constants.ts`, errores con excepciones Nest, sin `db push`, sin schema
  nuevo (datos intactos por construcción), mensajes en español.

## Pendientes para las etapas siguientes (no bloquean)
- Seguridad: residuales declarados en el diseño (IDOR por `:id`, `ConfigController` sin `ADMIN`, `x-mode`, usuarios con `deletedAt`
  que pueden loguearse, cookie sin `HttpOnly`, Swagger público en desarrollo, `proxy-addr` crítico transitivo de Nest 10).
- Tester: plan 9.5 en vivo, `-Smoke` en ambos modos, `npm run build` en Docker con la CA extra, conteos de la base 9 / 3 / 72 / 324 /
  1483, prueba de `AppModule` real contra Postgres (S-2) y contraste (S-4).
- Documentador: criterio 23 completo (`CLAUDE.md` regla 4, `COMANDOS.md`, `RIESGOS.md`, `BACKLOG.md`).

VEREDICTO: APROBADO
