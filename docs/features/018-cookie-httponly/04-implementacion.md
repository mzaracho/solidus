# 018 — Implementación: sesión en cookie `HttpOnly` y logout real

Autor: desarrollador. Fecha: 2026-11-18. Entrada: `01-spec.md`, `00-estado.md` (P1 a P7), `03-diseno-tecnico.md` (opción B).
Sin commit ni push. No se tocó el `.env` del usuario ni `backend/.env`.

## 1. Resumen

El backend emite la cookie `solidus_session` (`HttpOnly`, `SameSite=Lax`, `Path=/`, sin `Domain`, `Max-Age=28800`, `Secure`
según `AUTH_COOKIE_SECURE` / entorno / origen https) y la acepta como credencial junto con `Bearer`. El token ya no viaja en
el cuerpo del login. Las escrituras con cookie exigen `x-requested-with: solidus` y un `Origin` de `CORS_ORIGIN`. El front
no lee ni escribe el token: la identidad de la UI sale del layout de servidor (`SessionProvider`).

## 2. Cambios por archivo

### Backend (`backend/`)
| Archivo | Cambio |
|---|---|
| `src/infrastructure.bootstrap/config/app/auth-cookie-config.ts` (nuevo) | `AUTH_COOKIE_NAME`, `CSRF_HEADER(_VALUE)`, `parseAuthCookieSecure`, `getAuthCookieSecure`, `resolveCookieSecure`, `buildSessionCookieOptions`, `readSessionCookie` (falla cerrado con cookie duplicada o sin forma de JWT), `isAllowedOrigin`, `getAllowedOrigins` (misma lista y parseo que CORS) |
| `.../config/app/jwt-config.ts` | `JWT_EXPIRES_IN = '8h'` pasa a `JWT_EXPIRES_IN_SECONDS = 28800` (misma duración); `Max-Age` usa la misma constante |
| `.../config/app/cors-config.ts` | `credentials: true`; `x-requested-with` en `allowedHeaders` |
| `.../bootstrap.ts` | `getAuthCookieSecure(config)` al arrancar (variable inválida = no arranca, sin imprimir el valor) |
| `.../guards/authentication-guard.ts` | Bearer o cookie; con `Authorization` presente no cae a la cookie; CSRF solo con cookie y método no seguro, antes de verificar el JWT (403 genérico `forbidden`, log `csrf: missing header` / `csrf: origin not allowed`); `AuthContext.source` |
| `.../config/core/authentication/auth-context.ts` | `source: 'bearer' \| 'cookie'` (informativo) |
| `src/api/controllers/v1/auth/auth-controller.ts` | Login: `Origin` presente y no permitido da 403 antes del rate limit; `res.cookie` con el JWT; responde sin `token`. Logout: `@HttpCode(204)`, borra la cookie con los mismos atributos y `Max-Age=0` (no usa `clearCookie`) |
| `src/application/features/auth/login-query-handler.ts` | Devuelve `LoginResult { response, token }`; solo el controlador ve el token |
| `.../auth/dtos/login-response-dto.ts` | Sin `token` |
| `.../auth/logout-command-handler.ts` | `@Injectable()` + `@RequestHandler(LogoutCommand)` (#55) |
| `.../modules/features/auth/auth-module.ts` | `LogoutCommandHandler` registrado en `providers` |

Tests y helpers de backend:
- Nuevos: `auth-cookie-config.spec.ts` (40 tests), `authentication-guard-cookie.spec.ts` (20: guard con cookie + logout),
  `test/cqrs-handlers.spec.ts` (4), `test/auth-cookie-sync.spec.ts` (3).
- Ampliados: `login.spec.ts` (atributos de la cookie, JWT de la cookie, `body.token` ausente, `Secure` por variable y por
  Origin https, 403 con Origin ajeno/`null`/urlencoded sin cookie ni intentos), `login-rate-limit.spec.ts` (la cookie no altera
  el conteo), `authentication-guard.spec.ts` (constructor), `cors-config.spec.ts`, `logging.interceptor.spec.ts` (el JWT sale
  de `Set-Cookie`), `security-invariants.spec.ts` (bloque 018: `Cookie`, `CSRF_HEADER`, `x-requested-with`, `res.cookie(`,
  DTO sin `token`, atributos de la cookie; `auth-cookie-config.ts` en la lista blanca de `new Error(`),
  `test/all-routes-auth.spec.ts` (4 tests: cookie sin 401 en ninguna ruta, toda escritura sin header o con Origin
  ajeno/ausente da 403, logout 204), `test/helpers/login-app.ts` (CORS_ORIGIN de prueba, controladores extra, handler de logout).
- `cqrs-handlers.spec.ts`: estático (todo `implements IRequestHandler` lleva `@Injectable()` y `@RequestHandler(`), dinámico
  (AppModule real: cada request con handler está registrado y se resuelve) y controladores (cada `new XCommand/XQuery(` tiene
  handler). Verifiqué que falla con el `LogoutCommandHandler` original.

### Frontend (`frontend/`)
| Archivo | Cambio |
|---|---|
| `src/lib/session.ts` | `AUTH_COOKIE_NAME = 'solidus_session'`, `LEGACY_AUTH_COOKIE_NAME`, `CSRF_HEADER_NAME/VALUE`; nuevos `SessionIdentity`, `EMPTY_SESSION_IDENTITY`, `identityFromPayload`, `resolveBrowserApiBase`, `sessionCookieDeletion`, `legacyCookieDeletion`; eliminados `clearSessionCookie`, `readSessionToken`, `readSessionIdentity`, `getCookieMaxAgeSeconds`, `MAX_SESSION_SECONDS` |
| `src/services/data.ts` | `API_BASE_URL` del navegador con `resolveBrowserApiBase`; `getHeaders` manda `x-requested-with` y `Authorization` solo con `token` explícito (servidor); `apiFetch` con `credentials: 'include'` y sin `clearSessionCookie` ante 401; `login` con `credentials` y header, devuelve `{ status: 'ok' }` sin leer el cuerpo; `logout()` nuevo (no usa `apiFetch`, no lanza) |
| `src/services/session.server.ts` | `getServerSessionIdentity()` |
| `src/components/providers/SessionProvider.tsx` (nuevo) | Contexto + `useSessionIdentity()`; carga `availableRoles`/`orgRole` en el store (lo que hacía `AuthHydrator`); `pageshow` persistido hace `router.refresh()` (bfcache) |
| `src/app/(dashboard)/layout.tsx` | Async: pasa la identidad (no el token) al `SessionProvider` |
| `src/app/page.tsx` | Pasa a componente de servidor: `redirect()` según identidad |
| `src/app/sin-acceso/page.tsx` | Usa `getServerSessionIdentity()` |
| `src/components/providers.tsx` | Sin `AuthHydrator`, sin `jwt-decode` |
| `Sidebar.tsx`, `AccessDenied.tsx` | `await logout()` y `window.location.replace(ROUTES.LOGIN)`; nombre vía `useSessionIdentity()` |
| `LoginForm.tsx` | Sin `document.cookie` ni `clearSessionCookie` |
| `AdmisionesTable.tsx`, `columns.tsx`, `PayerRulesManager.tsx` | `useSessionIdentity()` en vez de `readSessionIdentity()` |
| `src/middleware.ts` | Cookie nueva; en `/login?reason=session_expired` borra `solidus_session` (`Max-Age=0`, `HttpOnly`); JWT vencido borra la cookie al redirigir; borra `auth_token` vieja en cualquier respuesta; matcher con entrada propia para `/login` que excluye prefetch |
| `next.config.ts` | Sin rewrite `/api` (P6) |
| `package.json` / `package-lock.json` | Quita `jwt-decode`; agrega `no-client-token.test.mts` al script `test` |
| Tests | `no-client-token.test.mts` (nuevo, 14), `session.test.mts` (identidad, `resolveBrowserApiBase`, borrado de cookies; sale lo eliminado), `api-routes.test.mts` (logout) |

### Scripts y compose
| Archivo | Cambio |
|---|---|
| `scripts/dev-lib.process.ps1` | `Test-SmokeLoginResponse` (pura: 2xx + `Set-Cookie` `solidus_session` con `HttpOnly` y `SameSite=Lax` + cuerpo sin `token`; devuelve `OK` o el motivo, sin valores); `-Smoke` usa `Invoke-WebRequest -UseBasicParsing` |
| `scripts/dev-lib.tests.ps1` | 19 asserts nuevos de `Test-SmokeLoginResponse` |
| `docker-compose.yml` | `AUTH_COOKIE_SECURE: "${AUTH_COOKIE_SECURE:-false}"` en el backend (P1) |
| `.env.example`, `backend/.env.example` | `AUTH_COOKIE_SECURE` comentada, con la regla del mismo host |

## 3. Cómo se cumple cada criterio

1. **Cookie no legible desde JS:** emitida por el backend con los atributos del diseño (test de `login.spec.ts` y prueba real). `no-client-token.test.mts` prohíbe `document.cookie`, `localStorage`, `sessionStorage` y `jwt-decode` en `src/`.
2. **Token fuera del cuerpo:** `LoginResponseDto` sin `token`; test `body.token` ausente; invariante en `security-invariants`; el smoke falla si el cuerpo trae `token`. Verificado además en el HTML de SSR (sin `eyJ`).
3. **Llamadas con cookie:** `credentials: 'include'` + `x-requested-with`; CORS `credentials` con lista explícita; CSRF (header + `Origin`) probado en guard, `all-routes-auth` y real. `x-org-id`/`x-mode` y las reglas 4 y 5 no cambian (`org-isolation` en verde).
4. **Identidad sin leer el JWT:** `SessionProvider` desde el layout de servidor; `canDeleteActivity`, `canSeeRestrictedLinks` y "Eliminar pagador" reciben los mismos datos. Falta la confirmación visual en navegador (ver §6).
5. **Expiración:** el middleware conserva su lógica y el texto; un 401 del cliente navega a `/login?reason=session_expired&from=…`, donde el middleware borra la cookie (probado real: JWT vencido da 307 al aviso y borra).
6. **Logout:** handler registrado (`cqrs-handlers.spec.ts`), 204 y `Max-Age=0` con los mismos atributos; front con `logout()` + `location.replace` + `pageshow`. "Atrás" tras el logout: cubierto por `replace`, el middleware y `pageshow`, sin prueba en navegador.
7. **Login:** formulario y textos intactos; el login va directo al backend (IP del socket); el rate limit sigue en verde y la cookie no lo altera.
8. **Docker y desarrollo:** `.\dev.ps1` + `-Smoke` OK con login (ver §5). Docker: **no verificable** (buildx), solo renderizado del compose.
9. **Seguridad:** `security-invariants`, `org-isolation`, `request-dto-invariants`, tests 005 y 012 en verde; tests nuevos de cookie, CSRF, logout y ausencia de token en el JS.
10. **Calidad:** ver §5.

## 4. Variables nuevas

- `AUTH_COOKIE_SECURE` (opcional, `true`/`false`; inválida = el backend no arranca). Sin definirla: `Secure` si `NODE_ENV` es producción (falla cerrado) o si el origen validado es https. El compose la fija en `false` por defecto (P1).
- `JWT_EXPIRES_IN_SECONDS` es una constante de código, no una variable de entorno; `dev.ps1` no necesitó cambios y no hizo falta `-Init`.

## 5. Verificaciones

| Verificación | Resultado |
|---|---|
| Backend `npx tsc --noEmit` | Sin errores |
| Backend `npx nest build` | OK, genera `dist/src/api/main.js` |
| Backend `npm test` | **56 suites, 1020 tests** en verde |
| Backend eslint (archivos tocados) | Sin errores nuevos. Quedan errores de prettier preexistentes en `login-query-handler.ts` (líneas 5, 56, 74, 121) y `security-invariants.spec.ts` (96, 146, 153, 175) |
| Frontend `npx tsc --noEmit` | Sin errores |
| Frontend `npm test` | **148 tests** en verde |
| Frontend `npm run build` | OK con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` (ver nota sobre `SecurityFatalError`) |
| Frontend eslint | Comparado archivo por archivo con `HEAD`: sin errores nuevos (los `any` de `data.ts`, `AdmisionesTable`, etc. son preexistentes); `providers.tsx` bajó de 1 error a 0 |
| `scripts\dev-lib.tests.ps1` | **1151 OK, 0 fallidos** |
| `.\dev.ps1` + `.\dev.ps1 -Smoke` | Backend OK, **Login OK** (cookie `HttpOnly`, sin token en el cuerpo). Frontend OK en 3002 en la segunda corrida (ver nota) |
| Docker aislado (`-p solidus018`) | **No verificable**: `docker compose up --build` falla con `additional privileges requested: pass "--allow=fs.read=backend\Dockerfile"` (Compose 5.6 usa bake; probé también `COMPOSE_BAKE=false`, igual). No cambié la configuración de Docker. No se creó ningún contenedor, red ni volumen del proyecto; `down -v` solo sobre `solidus018` (nada que borrar) y borré `.dev/compose.018.yml`. `docker ps -a` queda con `healthops-gem-db-1` (Exited) como antes. Solo se verificó con `docker compose config` que el compose renderiza `AUTH_COOKIE_SECURE: "false"`, los puertos 3011/8081/5434 y el `CORS_ORIGIN` con 3011 |

Pruebas reales (backend 8080, front 3002, usuario de humo, sin imprimir credenciales ni valores de cookie), sobre `localhost` y `127.0.0.1`:
- login con `Origin` permitido: 201, `Set-Cookie: solidus_session=<valor>; Max-Age=28800; Path=/; Expires=…; HttpOnly; Secure; SameSite=Lax`, cuerpo sin `token`. (`Secure` aparece porque el `backend/.env` del usuario tiene `NODE_ENV = local`, que el backend trata como producción; ver pregunta 1.)
- login con `Origin: http://localhost:3000`: 403 `forbidden`; preflight con `x-requested-with`: `Allow-Origin` del origen, `Allow-Credentials: true`.
- `GET /api/pro/memberships` con la cookie: 200 (`[]`).
- `POST /api/activity` con la cookie: sin `x-requested-with` o con `Origin` ajeno, 403 `forbidden`; con header y `Origin`, pasa el guard (llega a `org-access-denied`, 403 con otro código: el usuario de humo no tiene organización, así que no se alcanza el 400 `validation-failed` que preveía el diseño).
- logout con cookie, header y `Origin`: 204 y `Set-Cookie` con `Max-Age=0; Path=/; HttpOnly; SameSite=Lax`; sin sesión, 401.
- Front: ruta protegida sin cookie, 307 a `/login?from=…`; JWT vencido, 307 a `?reason=session_expired&from=…` y borra la cookie; `/login?reason=session_expired` borra la cookie salvo en prefetch; `auth_token` vieja se borra; `/` con cookie vigente redirige y `/sin-acceso` responde 200. El HTML de SSR de `/org-x/dashboard`, `/sin-acceso` y `/org-x/org/admisiones` no contiene el JWT.
- Al terminar: `.\dev.ps1 -Stop` (puertos 8080/3002/5433 libres; el 3000 es de otro proceso del usuario y no se tocó).

Nota sobre `SecurityFatalError`: `next build` (y, aparentemente, el primer `next dev` desde `dev.ps1`) corta con un aviso de que Next 16.4.3 tiene una vulnerabilidad conocida y pide reintentar; la segunda corrida continúa. La ventana de frontend de `dev.ps1` no llegó a responder en 180 s, así que levanté `next dev` a mano en 3002 (mismo comando que `dev.ps1`, `-H 127.0.0.1`) para el smoke, y lo detuve al final. El mensaje también sugiere ejecutar `next upgrade --agent=security` y preguntar al usuario por un worktree: **no lo ejecuté** (fuera de alcance de este feature); queda para que el PO decida si abre un ítem de actualización de Next.

## 6. Pendiente de verificar a mano (navegador)

Sin navegador no pude confirmar: el Sidebar con el nombre, los enlaces restringidos según rol, el botón Eliminar habilitado/deshabilitado, "Eliminar pagador", "Ver como", el flujo "Cerrar sesión" + "Atrás" (bfcache) y que `document.cookie` no muestre la cookie. Los tests, el SSR real y el comportamiento de cada pieza están cubiertos. Si `router.refresh()` en `pageshow` no redirige al login tras el "Atrás", usar `location.replace(location.href)` (alternativa prevista en el diseño). Para probar escrituras reales hace falta la base descartable (Docker no se pudo levantar).

## 7. Desvíos respecto de 03

1. **Prefetch (§3.8):** el diseño verificaba los headers de prefetch en el código del middleware. Next no los expone a `request.headers` (lo dice `proxy.md`; lo comprobé: no se veía `next-router-prefetch`). Los excluye el **matcher**: `/login` tiene una entrada propia con `missing` de `next-router-prefetch` y `purpose: prefetch`, y la entrada general excluye `login(?:/|$)`. Verificado con `curl`.
2. **Resultado del login (§3.3):** `LoginResult { response, token }` (primera de las dos variantes del diseño).
3. **Prueba real del guard (§6.1):** el `400 validation-failed` no es alcanzable con el usuario de humo (sin organización): se usa el cambio de código `forbidden` (CSRF) a `org-access-denied` (guard de organización) como prueba de que pasó la autenticación y el CSRF.
4. **Docker (§6.3):** no verificable por buildx (arriba).
5. **Resolución del host de la API:** `API_BASE_URL` sigue siendo una constante de módulo (evaluada en el navegador con `location.hostname`), para no tocar las ~40 plantillas `${API_BASE_URL}` que vigilan los tests de `api-routes`.
6. El `src/app/api/auth/login` y `src/app/api/proxy/[...path]` del frontend son carpetas vacías preexistentes (sin archivos, no versionadas); no se tocaron.
7. El layout del dashboard ahora es asíncrono y lee la cookie: todas las rutas de `(dashboard)` quedan dinámicas (el build las muestra como `ƒ`; no comparé con el estado anterior).

## 8. Preguntas al PO

1. **`NODE_ENV = local` en `backend/.env` del usuario.** El backend lo trata como producción (falla cerrado), así que en desarrollo la cookie sale con `Secure`. Chrome y Firefox la aceptan en `http://localhost` y `http://127.0.0.1`, pero Safari no. `dev.ps1` conserva ese valor y no se editó a mano. Opciones: que el usuario ponga `NODE_ENV=development` en `backend/.env` o `AUTH_COOKIE_SECURE=false`; o que `dev.ps1` normalice `NODE_ENV` inválido (queda para otro feature). Seguí con la opción conservadora (no tocar).
2. **`next dev` y el aviso de seguridad de Next 16.4.3:** ¿se abre un ítem para actualizar Next? Hoy la primera corrida de `next build`/`next dev` aborta y hay que repetirla; puede hacer que `dev.ps1` agote los 180 s de espera del frontend.
3. **Docker aislado:** si el PO quiere cerrar el criterio 8 en Docker, hay que resolver el permiso de buildx/bake (`--allow=fs.read=…`) del lado del usuario; con eso repito la prueba del §6.3.

## 9. Cómo probarlo

1. `cd backend && npx tsc --noEmit && npx nest build && npm test`.
2. `cd frontend && npx tsc --noEmit && npm test && npm run build` (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` si falla por TLS; reintentar si aparece el aviso de seguridad).
3. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-lib.tests.ps1`.
4. `.\dev.ps1` y, en la misma invocación, `.\dev.ps1 -Smoke`.
5. En el navegador: iniciar sesión, ver en DevTools que `solidus_session` es `HttpOnly` y que `document.cookie` no la muestra; recorrer dashboard, tablas y Ajustes; "Cerrar sesión" y "Atrás".
Ajuste pre-commit (2026-11-18): fixture de IP en session.test.mts cambiado a 192.0.2.20 (RFC 5737) por falso positivo del hook de IPs privadas.
