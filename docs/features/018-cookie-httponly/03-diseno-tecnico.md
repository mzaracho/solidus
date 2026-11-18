# 018 — Diseño técnico: sesión en cookie `HttpOnly` y logout real

Autor: arquitecto. Fecha: 2026-11-18. Entrada: `01-spec.md` (criterios 1 a 10), BACKLOG #10 y #55, RIESGOS M-3 y M-2 (012),
diseños del 005 (§3.5 CORS, §3.11 sesión en el front), 009 (modo) y 012 (IP del rate limit).

## 0. Resumen

- **Opción elegida: B.** El backend emite la cookie `HttpOnly` en el login y la acepta como credencial. El navegador
  llama a la API como hoy, de forma directa, con `credentials: 'include'`. Las páginas de servidor y el `middleware.ts` de
  Next leen la misma cookie, porque front y API se sirven en el mismo host y las cookies no se aíslan por puerto.
- **Rate limit (012):** el login no pasa por ningún proxy de Next. El backend sigue viendo la IP de la conexión
  (`req.socket.remoteAddress`) y la regla "nunca X-Forwarded-For" no cambia. La opción A (BFF) se descarta por este
  motivo: Next no da una IP de cliente confiable (ver §2.2).
- **CSRF:** las escrituras autenticadas con la cookie exigen un header propio (`x-requested-with: solidus`), que obliga a
  un preflight CORS limitado a la lista blanca, **y además** un `Origin` presente y dentro de `CORS_ORIGIN`. El login
  rechaza un `Origin` que esté presente y no figure en la lista (login CSRF). Todo esto se suma a `SameSite=Lax`.
- **Identidad en la UI:** sin endpoint nuevo. El layout de servidor `(dashboard)/layout.tsx` lee la cookie, decodifica los
  claims para presentación (igual que hoy hace el cliente) y se los pasa a un `SessionProvider` cliente. `/` pasa a ser
  una página de servidor que redirige.
- **Logout (#55):** `LogoutCommandHandler` queda con `@Injectable()` y `@RequestHandler`, registrado. El controlador borra
  la cookie con `Max-Age=0` y los mismos atributos. Hay un test estructural nuevo de handlers registrados.
- **Migración:** la cookie cambia de nombre (`auth_token` pasa a `solidus_session`). Las cookies viejas, escritas por JS,
  dejan de valer, y el middleware las borra. El usuario vuelve a iniciar sesión una vez.
- **Revocación:** queda fuera de alcance y va al BACKLOG. Hay una variante barata, que se documenta en §3.10.

---

## 1. Relevamiento

### 1.1 Dónde se lee o escribe el token hoy (frontend)

| Archivo | Tipo | Qué hace con el token |
|---|---|---|
| `components/domain/auth/LoginForm.tsx:84-85` | cliente | **Escribe** `auth_token` con `document.cookie` (`SameSite=Lax`, `Secure` si es https, `max-age` según `exp`). Al montar con `reason=session_expired` llama a `clearSessionCookie()` |
| `services/data.ts:161-185` (`login`) | cliente | Lee `token` del cuerpo de la respuesta y calcula `maxAge` con `getCookieMaxAgeSeconds` |
| `services/data.ts:87-98` (`getHeaders`) | ambos | En el navegador, `readSessionToken()` (`document.cookie`) pasa a `Authorization: Bearer`. En el servidor usa `ctx.token` |
| `services/data.ts:120-128` (`apiFetch`) | cliente | Ante un 401, `clearSessionCookie()` y navegación a `/login?reason=session_expired&from=…` |
| `lib/session.ts:79-98` | cliente | `clearSessionCookie`, `readSessionToken` y `readSessionIdentity` (con `document.cookie` y `decodeJwtPayload`) |
| `components/providers.tsx:14-41` (`AuthHydrator`) | cliente | `document.cookie` y `jwtDecode` (dependencia `jwt-decode`): borra la cookie si venció y carga `roles` y `orgRole` en el store |
| `components/layout/Sidebar.tsx:22-31, 53-56` | cliente | `getNameFromToken()` con `document.cookie` y `atob`. El logout es `clearSessionCookie()` más `location.href = /login`, **sin llamar al backend** |
| `components/domain/auth/AccessDenied.tsx:23-26` | cliente | El logout es `clearSessionCookie()` más `location.assign('/login')` |
| `app/page.tsx` | cliente | `readSessionToken()` y `decodeJwtPayload`. Redirige según `organizationId`, `orgRole` y `roles` |
| `components/domain/org/admisiones/AdmisionesTable.tsx:54` | cliente | `readSessionIdentity()` (`userId`, `professionalId`) |
| `components/domain/workload/columns.tsx:96` (`ActionsCell`) | cliente | `canDeleteActivity(orgRole, payment, readSessionIdentity())` |
| `components/domain/pro/settings/PayerRulesManager.tsx:68` | cliente | `readSessionIdentity().professionalId`, para el botón "Eliminar pagador" |
| `services/session.server.ts` | servidor | `cookies().get(AUTH_COOKIE_NAME)`: `getServerAuthToken` y `withServerSession` |
| `app/sin-acceso/page.tsx` | servidor | Decodifica la cookie para elegir la variante del texto |
| `middleware.ts` | Edge/servidor | Lee la cookie, decodifica `exp` y redirige. Borra la cookie si venció |

`localStorage` y `sessionStorage` no se usan con el token. El store de Zustand (`solidus-storage`) persiste `viewMode`,
`userRole`, `orgSlug` y `orgRole`, sin el token. No hay `fetch` fuera de `services/data.ts`.

### 1.2 Llamadas a la API: cliente o servidor

- **Servidor:** solo `app/(dashboard)/[orgSlug]/work-items/page.tsx` (`withServerSession` y `getWorkItems(…, { token })`),
  más las lecturas de la cookie en `sin-acceso` y en el middleware. Llama a `INTERNAL_API_URL` (en Docker,
  `http://backend:8080/api`).
- **Cliente:** el resto, unos 45 exports de `data.ts` usados desde 22 archivos `'use client'`, entre ellos dashboard,
  liquidaciones, profesionales, atenciones, ajustes, tablas, formularios, Sidebar y `test-suite`. Todas pasan por
  `apiFetch` y `getHeaders`, salvo `login`, que usa `fetch` directo. Llaman a `NEXT_PUBLIC_API_BASE_URL` (por defecto
  `http://localhost:8080/api`; queda fijo en el build de Docker).
- `next.config.ts` define un rewrite `/api/:path*` hacia `INTERNAL_API_URL`. **No lo usa nadie**: no hay URLs relativas
  `/api` en `src/`.

### 1.3 Identidad que usa la UI

Son claims del JWT que firma `LoginQueryHandler`: `sub`, `name`, `email`, `roles[]`, `orgRole`, `organizationId` y
`professionalId`. Se usan así:

- `roles` y `orgRole` van al store (`AuthHydrator`) y de ahí a `allowedViewModes`, `pickViewMode` y
  `canSeeRestrictedLinks` (Sidebar) y a `canDeleteActivity` (columns);
- `name` y `email` son el nombre del Sidebar;
- `sub` y `professionalId` salen de `readSessionIdentity()` (AdmisionesTable, columns y PayerRulesManager);
- `organizationId`, `orgRole` y `roles` deciden la redirección de `/`. `organizationId` también elige el texto de
  `/sin-acceso`.

### 1.4 Backend relevante

- `AuthenticationGuard` (APP_GUARD 1): solo `Authorization: Bearer` (regex, tope de 4096). Verifica HS256, `iss`, `aud`
  y `exp`, y busca al usuario por PK en cada request.
- `AuthController.login`: `@Public`. La IP sale de `req.socket.remoteAddress` y nunca de `X-Forwarded-For` (test
  "ignora X-Forwarded-For"). Devuelve `LoginResponseDto` **con `token` en el cuerpo**. `logout`: `@OrgOptional` y despacha
  `LogoutCommand`, pero `LogoutCommandHandler` no tiene `@Injectable` ni `@RequestHandler` y no está en `AuthModule`, así
  que responde 500 "Handler not found" (#55).
- CORS (`cors-config.ts`): lista blanca explícita (`CORS_ORIGIN`), `credentials: false`, `allowedHeaders` =
  `Authorization`, `Content-Type`, `x-org-id` y `x-mode`, y `exposedHeaders` = `Retry-After`.
- Body parser: `json` **y `urlencoded`** (`body-parser-config.ts`). Un formulario HTML de otro sitio puede postear al
  login.
- `security-invariants.spec.ts:36` prohíbe `.decode(` en el backend. `:433` tiene la lista blanca de `new Error(`.
- `dev.ps1` genera `CORS_ORIGIN = http://localhost:<FRONTEND_PORT>,http://127.0.0.1:<FRONTEND_PORT>[,extras]`. El
  compose fija `http://localhost:3001,http://127.0.0.1:3001,${CORS_EXTRA_ORIGINS}` y `NODE_ENV=production` en el backend.
- `-Smoke` (`dev-lib.process.ps1:378-386`) da el login por bueno si el cuerpo trae `token`. **Hay que cambiarlo.**

---

## 2. Opciones

### 2.1 Criterios

Se comparan en CSRF, IP del rate limit (bloqueante según el criterio 7), CORS, Docker, desarrollo (3002 y `BIND_ADDRESS`),
SSR, esfuerzo y superficie de cambios.

### 2.2 A) BFF o proxy en Next (route handlers que agregan `Authorization` desde la cookie)

El navegador llama a `/<algo>` en el mismo origen que el front. Un route handler catch-all lee la cookie `HttpOnly` (que
emite Next al hacer login), agrega `Authorization` y reenvía a `INTERNAL_API_URL`.

| Aspecto | Evaluación |
|---|---|
| CSRF | Cookie de primera parte y `SameSite=Lax`. El route handler tendría que verificar `Origin` y `Host` por su cuenta |
| **IP del 012** | **Bloqueante.** El backend ve siempre la IP del servidor Next: loopback en desarrollo y la IP del contenedor `frontend` en Docker. Todos los clientes comparten el contador por IP (20) y por IP más usuario (5). Reenviar la IP con un header firmado no lo resuelve, porque **Next no tiene una IP de cliente confiable**: `next/dist/server/base-server.js:601` hace `req.headers['x-forwarded-for'] ??= socket.remoteAddress`, así que si el cliente manda su propio `X-Forwarded-For`, ese valor gana. Desde Next 15, `NextRequest.ip` no existe fuera de Vercel. Un header firmado solo firmaría un valor que el atacante eligió. Haría falta un reverse proxy confiable delante de Next (que no existe) o un servidor custom de Next (un patrón nuevo, mucho más grande) |
| Variante "el login no pasa por el proxy" | El login iría directo al backend, que tendría que emitir la cookie en su host. Eso es la opción B para el login, y mantener además el proxy para el resto agrega un salto sin ganancia |
| CORS | Ya no hace falta para el navegador: es lo mejor de esta opción |
| Docker | Funciona: el contenedor `frontend` llama a `backend:8080` |
| Desarrollo | Funciona sin acoplar hosts |
| SSR | Igual que hoy |
| Esfuerzo y superficie | Alto. Un proxy genérico de streaming con listas de headers de ida (`x-org-id`, `x-mode`, `content-type`) y de vuelta (`Retry-After`, `X-Error-Id`, `content-type`), tope de body, timeouts, prefijo cerrado (sin `/docs` ni `/health`) y mapeo de errores. Next pasa a ser parte del perímetro de seguridad (riesgo de proxy abierto). Agrega un salto de red y latencia en cada llamada. Hay que reescribir las URLs de los 45 exports |

**Descartada** por el bloqueante del 012, sin una solución concreta que no requiera infraestructura nueva.

### 2.3 B) El backend emite y acepta la cookie `HttpOnly`, con CORS `credentials` (elegida)

| Aspecto | Evaluación |
|---|---|
| CSRF | La cookie viaja en requests same-site. `localhost:3000` y `localhost:3001` son **same-site** con `localhost:3002` y `localhost:8080`, porque los puertos no cuentan. `SameSite=Lax` no alcanza contra esos vecinos, y por eso se agrega el header propio más `Origin` (§3.6). También se previene el login CSRF (hay urlencoded) |
| **IP del 012** | **Sin cambios.** El login va del navegador al backend de forma directa y la IP sale del socket. Docker sigue con la limitación preexistente #56 (IP del gateway), sin empeorar |
| CORS | `credentials: true` con la lista explícita de siempre (ya prohíbe `*`). Se agrega `x-requested-with` a `allowedHeaders` |
| Docker | El navegador en `localhost:3001` llama a `localhost:8080`: mismo host, así que el middleware y el SSR de Next ven la cookie. El SSR sigue con `Bearer` hacia `backend:8080`. `Secure` necesita un ajuste, porque el stack Docker es HTTP y corre con `NODE_ENV=production` (§3.2, pregunta P1) |
| Desarrollo | Front en 3002 y API en 8080 sobre `localhost`: funciona. **Condición nueva:** el host de la página tiene que ser el host de la API. Para `localhost` y `127.0.0.1` el front alinea el host solo (§3.5). Con `BIND_ADDRESS` y acceso desde otra PC ya hacía falta poner `NEXT_PUBLIC_API_BASE_URL` con la IP (`.env.example:17`), así que el host coincide |
| SSR | Igual que hoy: lee la cookie con `cookies()` y la manda como `Bearer` |
| Esfuerzo y superficie | Medio. Un archivo nuevo de configuración de la cookie, cambios en el guard, en el login y el logout, CORS, `data.ts` (credentials y header), un provider de identidad y los reemplazos de lectura. Sin dependencias nuevas |
| Contra | Acopla el host del front y el de la API. Un despliegue futuro con hosts separados (`app.` y `api.`) necesitaría `Domain=` o un reverse proxy con el mismo host (nuevo ítem de BACKLOG) |

### 2.4 C) Server actions

Cada llamada sería una server action que lee la cookie y llama al backend.

- **IP del 012:** el mismo bloqueante que A. `headers()` da el `X-Forwarded-For` que manda el cliente.
- **Concurrencia:** las server actions de un mismo cliente se encolan una por una. Los `Promise.all` del dashboard (3
  llamadas) y de PayerRulesManager quedarían en serie.
- **Uso previsto:** están pensadas para mutaciones, no para lecturas.
- **CSRF:** tiene una ventaja, porque Next compara `Origin` con `Host` en las server actions.
- **Esfuerzo:** convertir los 45 exports y cambiar la semántica de 401 y 403 en el cliente. Una action genérica `callApi`
  sería, en la práctica, la opción A.

**Descartada.**

### 2.5 Decisión

**B.** Es la única que cumple el criterio 7 sin infraestructura nueva y reutiliza lo que ya existe: la lista blanca de
CORS, el guard global, `withServerSession`, el middleware y `apiFetch`. El acople de host se mitiga y se documenta.

Además se **elimina el rewrite `/api/:path*` de `next.config.ts`**. Nadie lo usa, y con la cookie en el host del front
sería un segundo camino al login en el que el backend ve la IP del servidor Next, que es justo lo que el criterio 7 pide
evitar. Ver P6.

---

## 3. Diseño detallado

### 3.1 Archivo nuevo `backend/src/infrastructure.bootstrap/config/app/auth-cookie-config.ts`

Tiene funciones puras y sin dependencias de Nest, salvo `ConfigService` en los getters, y se puede probar de forma
unitaria:

- `AUTH_COOKIE_NAME = 'solidus_session'`, `CSRF_HEADER = 'x-requested-with'` y `CSRF_HEADER_VALUE = 'solidus'`;
- `parseAuthCookieSecure(raw)`:
  - acepta `true` o `false` (sin distinguir mayúsculas, con trim);
  - ausente o vacío vale `null` (se usa el default);
  - cualquier otro valor lanza `new Error('AUTH_COOKIE_SECURE must be true or false…')`, sin imprimir el valor. Se suma
    a la lista blanca de `new Error(` en `security-invariants.spec.ts`.
- `getAuthCookieSecure(config)`: el valor explícito o, si no hay, `isProduction(config)`.
- `buildSessionCookieOptions({ secure, maxAgeSeconds })`:
  - devuelve `{ httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge: maxAgeSeconds * 1000 }`;
  - **sin `domain`**: la cookie es host-only.
- `readSessionCookie(cookieHeader: unknown): string | null` es un parser propio y mínimo; se justifica porque no se
  agrega `cookie-parser` por una sola cookie:
  - parte el header por `;`;
  - si el nombre aparece **más de una vez**, devuelve `null` (falla cerrado ante cookie tossing desde otro puerto o
    path);
  - el valor tiene que tener formato JWT (`[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`) y medir 4096 o menos;
  - si no cumple, `null`.
- `isAllowedOrigin(origin, allowlist)`: compara exacto contra `parseCorsOrigins(config.get('CORS_ORIGIN'))`. Es la misma
  lista que usa CORS y la misma función de parseo, para tener una sola fuente.
- `bootstrap.ts` llama a `getAuthCookieSecure(config)` antes de `listen`, para fallar al arrancar igual que con
  `BODY_SIZE_LIMIT`.

En `jwt-config.ts`, `JWT_EXPIRES_IN = '8h'` pasa a `JWT_EXPIRES_IN_SECONDS = 28800` y se firma con
`expiresIn: JWT_EXPIRES_IN_SECONDS`. La duración no cambia. `Max-Age` usa la misma constante, así que es igual a
`exp - iat` del token emitido. Un test lo verifica sin `.decode(` (prohibido): usa `jwt.verify` en el test.

### 3.2 Atributos exactos de la cookie

```
Set-Cookie: solidus_session=<jwt>; Max-Age=28800; Path=/; Expires=<ahora+8h>; HttpOnly; SameSite=Lax[; Secure]
```

`Expires` lo agrega Express a partir de `maxAge`. No tiene `Domain`.

**Cuándo lleva `Secure`:** `secure = getAuthCookieSecure(config) || origenDelRequestEsHttps`.

- **Desarrollo y test:** `NODE_ENV=development`/`test`, sin la variable: no lleva `Secure`, salvo que el front se sirva
  por https.
- **Producción** (`NODE_ENV` con otro valor o ausente; falla cerrado, como el resto): lleva `Secure`.
- **Docker local:** el compose pasa `AUTH_COOKIE_SECURE: "${AUTH_COOKIE_SECURE:-false}"`, porque el stack entero es HTTP.
  Si no, una cookie `Secure` emitida por `http://<IP-de-LAN>` (con `BIND_ADDRESS`) o en Safari se descarta en silencio y
  el login entra en bucle. Ver pregunta P1.
- `origenDelRequestEsHttps` sale del `Origin` **ya validado** contra la lista blanca. Así, si alguna vez se sirve el front
  por https, la cookie lleva `Secure` aunque la variable diga `false`.

**Logout:** `res.cookie(AUTH_COOKIE_NAME, '', { ...mismosAtributos, maxAge: 0 })` produce `Max-Age=0` y `Expires` en el
pasado, con los mismos `Path`, `HttpOnly`, `SameSite` y `Secure`. No se usa `res.clearCookie`, porque Express 4.22 marca
como deprecado pasarle `maxAge`.

### 3.3 Login (`AuthController.login`)

Orden:

1. **Verificación de `Origin` (login CSRF):** si viene `Origin` y no está en la lista blanca, 403
   `{ code: 'forbidden', message: 'Forbidden' }`, antes de consumir el rate limit y sin cookie. Sin `Origin` (smoke,
   curl) se deja pasar. Un formulario de otro sitio siempre manda `Origin`, y si es `null` no está en la lista.
2. Rate limit (012) sin cambios: IP de `req.socket.remoteAddress` y `consume` y `recordSuccess` como hoy.
3. `dispatch(LoginQuery)`. El handler sigue firmando el JWT y lo devuelve **solo al controlador**.
4. El controlador hace `res.cookie(…)` (passthrough) y responde el `LoginResponseDto` **sin `token`**: `id`, `type`,
   `name`, `email`, `settings`, `roles`, `orgRole` y `professionalId`.

Para que el token no llegue al cuerpo hay dos caminos, y la implementación elige el más simple:

- el handler devuelve `{ response: LoginResponseDto, token }` y el controlador separa las dos partes;
- o el handler devuelve un tipo interno `LoginResult` y el DTO pierde `token?`.

En los dos casos, `LoginResponseDto` ya no declara `token`, y un test verifica que `res.body.token` no existe.

No cambian el formulario, los textos ni los códigos 400, 401 y 429. El 403 nuevo solo puede aparecer ante un origen ajeno.
El front lo trata como `other`, con el texto existente.

### 3.4 Autenticación (`AuthenticationGuard`)

1. Si es `@Public`, pasa (como hoy).
2. **Origen del token:**
   - con header `Authorization`: tiene que ser `Bearer` válido (como hoy); si está mal formado, 401 **sin caer a la
     cookie**. Origen = `bearer`;
   - sin header `Authorization`: `readSessionCookie(request.headers.cookie)`; si es `null`, 401. Origen = `cookie`.
3. **CSRF**, solo si el origen es `cookie` y el método no es `GET`, `HEAD` ni `OPTIONS`:
   - `request.headers['x-requested-with'] === 'solidus'`;
   - y `Origin` presente y dentro de la lista blanca.
   - Si algo falla, 403 `{ code: 'forbidden', message: 'Forbidden' }`, texto genérico. Se hace `Logger.warn` del motivo
     (`csrf: missing header` o `csrf: origin not allowed`), sin valores.
   - Va **antes** de verificar el JWT, para no consultar la base por un request que se rechaza.
4. Verificación del JWT, del usuario activo y de `request.auth`, sin cambios. Se agrega `source: 'bearer' | 'cookie'` a
   `AuthContext` (solo informativo; nadie autoriza con eso).

**Por qué alcanza:**

- un sitio ajeno, incluidos los vecinos same-site en otros puertos, no puede mandar `x-requested-with` sin un preflight.
  El preflight solo lo aprueba `CORS_ORIGIN`, así que el request nunca sale del navegador;
- `Origin` es una segunda barrera independiente por si CORS se configura mal;
- los `GET` no tienen efectos (lo confirma el relevamiento de rutas del 011 y del 014), y sus respuestas no se pueden leer
  desde otro origen.

El SSR usa `Bearer` y no tiene que mandar el header: un sitio ajeno no puede poner `Authorization` sin preflight.

`OrgAccessGuard` y `ViewModeGuard` no cambian. Siguen leyendo `x-org-id` y `x-mode`/`?mode=` como hoy (criterio 3).
`@CurrentOrgId()`, `org-resource.ts` y las reglas 4 y 5 tampoco cambian.

### 3.5 CORS y URL de la API en el navegador

`cors-config.ts`:

- `credentials: true`;
- `CORS_ALLOWED_HEADERS` suma `x-requested-with`. `Authorization` queda (Swagger y compatibilidad; el navegador ya no lo
  manda);
- `exposedHeaders` sin cambios. `origin` sigue siendo la lista explícita, y con `credentials` el paquete `cors` refleja el
  origen permitido, nunca `*`.

Front, nueva función pura `resolveBrowserApiBase(configured, pageHostname)` en `lib/session.ts` (o en un `lib/api-base.ts`
sin imports):

- si el host de `NEXT_PUBLIC_API_BASE_URL` y el de la página son **los dos** alias de loopback (`localhost` o
  `127.0.0.1`) y son distintos, se reemplaza el host de la API por el de la página;
- en cualquier otro caso queda igual.

Sin esto, abrir `http://127.0.0.1:3002` haría que el navegador descarte el `Set-Cookie` de `localhost:8080`, porque es
cross-site y `SameSite=Lax`, y el login entraría en bucle sin mensaje. Los dos orígenes ya están en `CORS_ORIGIN`, tanto
en desarrollo como en Docker.

### 3.6 Frontend: transporte (`services/data.ts`)

- `API_BASE_URL` en el navegador: `resolveBrowserApiBase(NEXT_PUBLIC_API_BASE_URL ?? default, location.hostname)`. En el
  servidor no cambia.
- `getHeaders(orgSlug, token?)`:
  - siempre `Content-Type`, `x-org-id` y `x-requested-with: solidus`;
  - `Authorization` **solo si se pasó `token`** (servidor);
  - se elimina `readSessionToken()`;
  - en el servidor, sin token, sigue lanzando `ApiUnauthorizedError`.
- `apiFetch`:
  - en el navegador agrega `credentials: 'include'` al `init`;
  - ante un 401, ya **no** llama a `clearSessionCookie()` (JS no puede borrar una cookie `HttpOnly`) y navega a
    `/login?reason=session_expired&from=…` como hoy. El middleware borra la cookie (§3.8);
  - 403 sin cambios.
- `login(user, password)`:
  - `fetch` con `credentials: 'include'`, que es **obligatorio** para que el navegador guarde el `Set-Cookie` de una
    respuesta cross-origin, y con `x-requested-with`;
  - con 2xx devuelve `{ status: 'ok' }`, sin leer el cuerpo. `LoginResult` pierde `token` y `maxAge`.
- `logout()` (nuevo):
  - `POST ${API_BASE_URL}/v1/auth/logout` con `credentials: 'include'` y `x-requested-with`;
  - no usa `apiFetch`, porque un 401 acá no significa "sesión vencida";
  - no lanza: el resultado se ignora.
- Se eliminan `getCookieMaxAgeSeconds`, `readSessionToken`, `clearSessionCookie` y `readSessionIdentity`, junto con sus
  tests. `MAX_SESSION_SECONDS` se elimina si queda sin uso.

### 3.7 Identidad en la UI sin leer el JWT en el cliente

- **`lib/session.ts`** (sin imports, se puede probar con `node --test`):
  - `export type SessionIdentity = { userId, name, email, organizationId, orgRole, professionalId, roles }`;
  - `identityFromPayload(payload)` valida los tipos y deja `null` o `[]` si no corresponden. Es la lógica actual de
    `readSessionIdentity`, de `getNameFromToken` y de `AuthHydrator`, unificada.
- **`services/session.server.ts`:** `getServerSessionIdentity()` lee la cookie con `cookies()` y devuelve
  `identityFromPayload(decodeJwtPayload(token))`, o la identidad vacía. Solo presentación: el backend sigue siendo la
  autoridad (igual que hoy, que el cliente decodifica sin verificar).
- **`components/providers/SessionProvider.tsx`** (`'use client'`, nuevo):
  - un contexto React con `identity`;
  - un `useEffect` que carga `availableRoles` y `orgRole` en el store, lo que hoy hace `AuthHydrator`, así Sidebar,
    `view-mode` y columns siguen leyendo el store sin cambios;
  - un hook `useSessionIdentity()`;
  - un listener `pageshow` que, si `event.persisted` (página restaurada del bfcache después de un logout), llama a
    `router.refresh()`. El RSC pasa por el middleware y redirige al login.
- **`app/(dashboard)/layout.tsx`** (servidor): `const identity = await getServerSessionIdentity()` y
  `<SessionProvider identity={identity}>` envolviendo Sidebar y `children`. El payload RSC lleva los claims de
  presentación (nombre, email, ids y roles), **nunca el token**.
- **Reemplazos:**
  - `AdmisionesTable` y `PayerRulesManager` usan `useSessionIdentity()` arriba del componente;
  - `columns.tsx` (`ActionsCell` ya es un componente con hooks) usa `canDeleteActivity(orgRole, payment, useSessionIdentity())`;
  - Sidebar usa `useSessionIdentity().name ?? email ?? 'Usuario'`;
  - `providers.tsx` elimina `AuthHydrator` y el import de `jwt-decode`. La dependencia `jwt-decode` se quita de
    `package.json`.
- **`app/page.tsx`** pasa a componente de servidor, con la misma lógica: `getServerSessionIdentity()` y `redirect()` a
  `/<org>/dashboard`, `/<org>/pro/atenciones`, `/<org>/org/admisiones` o `/sin-acceso`. Sin cookie, `/login`, aunque el
  middleware ya lo cubre. Además se elimina el render vacío y el parpadeo del cliente.
- **`app/sin-acceso/page.tsx`:** solo cambia el nombre de la cookie, por la constante.
- **Permisos de UI:** `canDeleteActivity`, `canSeeRestrictedLinks` y el botón "Eliminar pagador" reciben los mismos datos
  que hoy (`orgRole` del store; `userId` y `professionalId` de la identidad), así que se ven igual (criterio 4). La
  identidad se fija en el render de servidor del layout y cambia solo con login o logout, que son navegaciones completas.

### 3.8 Middleware (`middleware.ts`)

- Usa `AUTH_COOKIE_NAME` nuevo. La lógica de `exp` no cambia, y el texto del aviso tampoco (criterio 5).
- **`/login?reason=session_expired`:** devuelve `NextResponse.next()` y borra la cookie con
  `response.cookies.set(AUTH_COOKIE_NAME, '', { httpOnly: true, sameSite: 'lax', path: '/', secure: request.nextUrl.protocol === 'https:', maxAge: 0 })`.
  Así reemplaza lo que hacía `LoginForm` al montar, y corta el bucle con un token inválido pero no vencido (por ejemplo,
  tras rotar `JWT_SECRET`).
  - Se saltean los prefetch (`next-router-prefetch` o `purpose: prefetch`), para que un prefetch no cierre la sesión.
  - Es el mismo comportamiento que hoy: un enlace a esa URL ya cerraba la sesión vía JS.
  - Lo arma un helper `sessionCookieDeletion(secure)` en `lib/session.ts`, que se prueba.
- **Cookie vieja `auth_token`:** si llega en cualquier request que pasa por el matcher, la respuesta la borra (`Path=/`,
  `Max-Age=0`). Nunca se usa para autenticar, así que el usuario vuelve a iniciar sesión una vez.
- Next 16 marca `middleware.ts` como obsoleto en favor de `proxy.ts`. **No se renombra en este feature**; queda como
  candidato en el BACKLOG.

### 3.9 Logout (#55)

Backend:

- `LogoutCommandHandler`: `@Injectable()` y `@RequestHandler(LogoutCommand)`, registrado en
  `AuthModule.providers`. `execute` no hace nada (sin revocación) y es el punto de extensión para la revocación del
  BACKLOG.
- `AuthController.logout`:
  - sigue con `@OrgOptional()` y autenticado: el CSRF se aplica solo por ser `POST` con la cookie;
  - `@HttpCode(204)` y `@Res({ passthrough: true })`;
  - `await dispatch(new LogoutCommand())` y después borra la cookie (§3.2).
  - Se actualiza `@ApiResponse` a 204.
  - La cookie se borra en el controlador, porque es transporte HTTP, igual que `Retry-After`.

Frontend:

- Sidebar y `AccessDenied` hacen `await logout()` y después `window.location.replace(ROUTES.LOGIN)`.
- Con `replace`, "atrás" no vuelve a la página en la que se hizo clic. Si vuelve a una anterior, el middleware no
  encuentra la cookie y redirige al login. Para el bfcache está el listener de `pageshow` (§3.7).

Casos límite:

- **Token inválido pero no vencido:** el logout responde 401, la cookie sigue y el usuario queda en `/login`. Si abre una
  ruta protegida, la primera llamada da 401, va a `?reason=session_expired` y el middleware la borra. Converge.
- **Backend caído:** pasa lo mismo, y la cookie vence sola en 8 horas como máximo. Se documenta como residual.

### 3.10 Revocación

Fuera de alcance, va al BACKLOG.

Variante barata, para registro: una columna `User.sessionsRevokedAt` (migración). El guard ya hace `findUnique` por PK en
cada request, así que no agrega consultas: alcanza con rechazar si `iat < sessionsRevokedAt`, y el logout la fija en
`now()`.

Se descarta en este feature por dos motivos:

- cambia el schema, y la spec dice que no se esperan cambios de schema;
- cambia la semántica: "Cerrar sesión" cerraría **todas** las sesiones del usuario. Es una decisión visible. Ver P2.

### 3.11 Manejo de errores

| Caso | Respuesta |
|---|---|
| Cookie ausente, mal formada, duplicada o con JWT inválido o vencido | 401 `unauthorized`. En el cliente, login con aviso; en el SSR, `withServerSession` |
| Escritura con la cookie sin `x-requested-with`, o con `Origin` ausente o ajeno | 403 `forbidden`, genérico. En el cliente, el toast `forbiddenAction` existente (no debería pasar con el front propio) |
| Login con `Origin` ajeno | 403 `forbidden`, sin consumir el rate limit y sin cookie |
| `AUTH_COOKIE_SECURE` inválida | El backend no arranca, sin imprimir el valor |
| Logout | 204. Sin sesión, 401 (el test del 012 "logout sin token sigue dando 401, no 429" sigue en verde) |

Todo respeta el contrato del 013 `{ code, errors: [{ message }] }`. Los logs no incluyen el token: `redact.ts` ya cubre
`cookie` y `token`, el access log no registra headers, y `Set-Cookie` no se loguea.

### 3.12 Rendimiento y compatibilidad

- **Rendimiento:**
  - no se agregan round trips (no hay `/auth/me`);
  - hoy cada llamada ya hace preflight (por `Authorization`) y después lo hará por `x-org-id` y `x-requested-with`;
    `maxAge: 600` sigue igual;
  - el CSRF se resuelve sin tocar la base.
- **Contrato de la API:**
  - el login ya no devuelve `token` (el único consumidor es `-Smoke`, que se actualiza);
  - `Bearer` sigue aceptado (SSR, Swagger y tests);
  - el logout pasa de 500 a 204.
- **Swagger:** "Try it out" con la cookie funciona para `GET`, porque el navegador la manda solo al mismo host. Las
  escrituras desde Swagger necesitan `Authorize` con el token, que se puede copiar de las DevTools, donde las cookies
  `HttpOnly` se ven. Solo afecta al desarrollo.
- **Otras apps en `localhost`:** las cookies no se aíslan por puerto, así que el JWT también viaja a `localhost:3000` y
  `localhost:3001`. Ya pasaba con `auth_token`, no es una regresión. Ahora esas apps no pueden leerla desde JS. Se anota
  en RIESGOS.
- **Despliegue con hosts separados:** no está soportado sin `Domain=` o un reverse proxy (BACKLOG nuevo).

---

## 4. `dev.ps1`, compose y variables

| Cambio | Dónde | Test |
|---|---|---|
| `AUTH_COOKIE_SECURE` opcional (`true`/`false`; por defecto `NODE_ENV=production` lleva `Secure`) | `backend/.env.example` (comentada) y `.env.example` (comentada, con explicación) | spec de `auth-cookie-config` |
| `AUTH_COOKIE_SECURE: "${AUTH_COOKIE_SECURE:-false}"` en `backend.environment`, con un comentario ("el stack Docker local es HTTP") | `docker-compose.yml` | Prueba real en Docker (§6.3) |
| `CORS_ORIGIN`: **sin cambios** (ya incluye `localhost` y `127.0.0.1` con `FRONTEND_PORT`, y 3001 en Docker) | — | Siguen los tests "CORS 005" |
| `dev.ps1` **no** propaga `AUTH_COOKIE_SECURE` a `backend/.env`: en desarrollo no hace falta, y sigue el criterio de `LOGIN_RATE_LIMIT_*` | — | — |
| `-Smoke`: `Invoke-WebRequest` en lugar de `Invoke-RestMethod`. Se extrae una función pura `Test-SmokeLoginResponse -StatusCode -SetCookieHeaders -BodyJson`, que devuelve `OK` o un motivo, sin imprimir valores | `scripts/dev-lib.process.ps1` | `dev-lib.tests.ps1`: casos con `Set-Cookie` correcto (nombre, `HttpOnly` y `SameSite=Lax`) da OK; sin cookie, FALLO; cookie sin `HttpOnly`, FALLO; cuerpo con `token`, FALLO ("el login devolvio el token en el cuerpo"); 401 y 5xx con los mensajes actuales |

`Test-SmokeLoginResponse` OK requiere, a la vez:

- 2xx;
- algún `Set-Cookie` que empiece con `solidus_session=` e incluya `HttpOnly` y `SameSite=Lax`;
- un cuerpo sin la propiedad `token`.

El smoke no manda `Origin`, así que el login lo acepta. El rate limit cuenta el éxito como hoy.

---

## 5. Guardias y tests

### 5.1 Backend

- **`auth-cookie-config.spec.ts`** (nuevo): `parseAuthCookieSecure` (valores válidos, vacío y basura, que lanza sin el
  valor), `buildSessionCookieOptions` (sin `domain`, `httpOnly`, `lax`, `/`), `readSessionCookie` (ausente, mal formada,
  duplicada, demasiado larga y otras cookies alrededor) e `isAllowedOrigin`.
- **`login.spec.ts`** (actualizar y ampliar):
  - con 201, `Set-Cookie` tiene `solidus_session=<jwt>; Max-Age=28800; Path=/; HttpOnly; SameSite=Lax`, sin `Domain` y
    sin `Secure` en `NODE_ENV=test`;
  - con `AUTH_COOKIE_SECURE=true` o `Origin` https permitido, lleva `Secure`;
  - el JWT de la cookie verifica HS256, `iss` y `aud`, y `exp - iat = Max-Age`;
  - **`body.token` no existe**;
  - con `Origin` ajeno, 403 sin cookie y sin consumir intentos (el sexto intento desde la misma IP sigue dando 401);
  - con `Origin` permitido o sin `Origin`, OK.
- **`login-rate-limit.spec.ts`:** los tests actuales quedan (incluidos "ignora X-Forwarded-For" y "logout sin token, 401").
  Se agrega que una cookie de sesión no altera el conteo.
- **Guard (`authentication-guard.spec.ts`,** nuevo o ampliado, con `createLoginApp` o un controlador de prueba):
  - `GET` con la cookie válida pasa;
  - `POST` con la cookie y sin header da 403;
  - con header y sin `Origin`, 403;
  - con `Origin` ajeno, 403;
  - con header y `Origin` permitido, pasa;
  - `POST` con `Bearer` y sin header pasa (SSR);
  - `Authorization` mal formado y la cookie válida da 401 (no cae a la cookie);
  - cookie duplicada, 401;
  - cookie vieja `auth_token` con un JWT válido, 401;
  - usuario dado de baja con la cookie, 401.
- **Logout:**
  - con la cookie, header y `Origin`, 204 y `Set-Cookie: solidus_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`
    (más `Secure` si aplica);
  - con la cookie y sin header, 403;
  - sin sesión, 401.
- **`test/cqrs-handlers.spec.ts`** (nuevo, cubre "lo vigila el test de handlers"):
  - estático: toda clase `implements IRequestHandler` en `src/application/**` tiene `@Injectable()` y
    `@RequestHandler(`;
  - dinámico: con el `AppModule` real (Prisma mockeado, como `all-routes-auth`), cada request con metadata de handler se
    resuelve;
  - y toda `new XCommand|XQuery(` que se despacha en `api/controllers/**` tiene su handler.
  - Hoy fallaría por `LogoutCommandHandler`.
- **`test/all-routes-auth.spec.ts`** (ampliar, recorre todas las rutas):
  - con la cookie válida y sin `Authorization`, ninguna ruta da 401;
  - toda ruta no `GET` y no `@Public` con la cookie y sin `x-requested-with` da 403;
  - las listas de `@Public` (login y salud) y `@OrgOptional` (logout y `pro/memberships`) no cambian.
- **`cors-config.spec.ts`:** `credentials: true` y `allowedHeaders` incluye `x-requested-with`.
- **`security-invariants.spec.ts`:**
  - `new Error(` suma `auth-cookie-config.ts`;
  - `headers.cookie` y `CSRF_HEADER` solo en `auth-cookie-config.ts` y `authentication-guard.ts`;
  - `res.cookie(` solo en `auth-controller.ts`;
  - ningún DTO de respuesta declara `token`;
  - `x-requested-with` solo en `auth-cookie-config.ts` y `cors-config.ts`;
  - siguen `.decode(` prohibido y el resto.
- **`org-isolation.spec.ts`:** no hay rutas nuevas con `:id` ni campos `*Id` nuevos, así que `ID_ROUTE_CASES` no cambia.
  `(a2)` sigue en verde. `request-dto-invariants`: el logout no tiene `@Body`, y el fixture `frontend-request-bodies.json`
  no cambia (el body del login es el mismo).
- **Test de sincronía:** el `AUTH_COOKIE_NAME` del backend es igual al de `frontend/src/lib/session.ts`. Un spec del
  backend lee el texto del archivo del front, con el mismo criterio que el fixture de bodies.

### 5.2 Frontend (`node --test`; se suman al script `test` de `package.json`)

- **`src/lib/no-client-token.test.mts`** (guardia nueva, criterio 1). Recorre `src/**/*.{ts,tsx}` (excepto los tests) y
  falla si:
  - aparece `document.cookie`, `localStorage` o `sessionStorage` (Zustand no los nombra en el código; si algún día hiciera
    falta, se agrega a una lista blanca justificada);
  - hay un import de `jwt-decode`;
  - `decodeJwtPayload` o `AUTH_COOKIE_NAME` aparecen en un archivo `'use client'`. Solo se permiten en `middleware.ts`,
    `session.server.ts`, `app/page.tsx`, `app/sin-acceso/page.tsx` y `lib/session.ts`;
  - `data.ts` arma `Authorization` sin un `token` explícito;
  - `login()` lee `.token` de la respuesta;
  - `apiFetch`, `login` y `logout` no tienen `credentials: 'include'`;
  - `getHeaders` no manda `x-requested-with`.
- **`session.test.mts`:**
  - sale lo que se elimina (`readSessionIdentity` y `getCookieMaxAgeSeconds`);
  - entran `identityFromPayload` (tipos inválidos, roles), `resolveBrowserApiBase` (`localhost` y `127.0.0.1` en los dos
    sentidos, IP de LAN sin cambios, URL inválida sin cambios) y `sessionCookieDeletion` (atributos y `secure`).
- **`api-routes.test.mts`:** `logout` llama a `/v1/auth/logout` con `POST` y no usa `apiFetch`.
- `login-rate-limit.test.mts`, `activity-permissions.test.mts` y `view-mode.test.mts`: sin cambios, siguen en verde.

### 5.3 Scripts

`dev-lib.tests.ps1`: los casos de `Test-SmokeLoginResponse` (§4). Siguen "CORS 005" y "Smoke 005".

---

## 6. Plan de pruebas reales

Reglas: sin escrituras en la base del usuario; sin tocar los puertos 3000 ni 3001; sin imprimir valores del `.env` ni la
cookie. Los requests manuales de prueba se arman con `curl.exe` o `Invoke-WebRequest`, y se muestran solo el status y los
**nombres** o atributos de `Set-Cookie`, nunca el valor.

### 6.1 Desarrollo (`.\dev.ps1`, front en `FRONTEND_PORT=3002` y API en 8080)

1. `.\dev.ps1 -Init` (si cambian los `.env.example`) y `.\dev.ps1`. Se reinician solo los procesos de este proyecto (3002
   y 8080).
2. `.\dev.ps1 -Smoke`: Backend, Frontend y Login dan OK (`SMOKE_USER` existe). El login lo valida la cookie `HttpOnly` y
   que el cuerpo no traiga token.
3. Con las credenciales de humo, leídas del `.env` dentro de un script que no las imprime:
   - login con `Origin: http://localhost:3002`: 201, `Set-Cookie` con `HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
     sin `Secure`, y sin `token` en el cuerpo;
   - login con `Origin: http://localhost:3000`: 403;
   - `GET /api/pro/memberships` con la cookie: 200 (`@OrgOptional`; el usuario de humo no tiene organización);
   - `POST /api/activity` con la cookie, sin `x-requested-with`: 403;
   - el mismo request con el header y `Origin` permitido, con cuerpo vacío: **400 `validation-failed`**. Prueba que el
     guard pasó: el pipe corre después de los guards y no se escribe nada;
   - `POST /api/v1/auth/logout` con la cookie, header y `Origin`: 204 y `Set-Cookie` con `Max-Age=0`;
   - `GET` en el front: `http://localhost:3002/<slug>/work-items` sin cookie da 307 a `/login?from=…`. Con un JWT vencido
     armado en el test (firmado con un secreto de prueba, sin `JWT_SECRET` real) da 307 a `?reason=session_expired` y
     borra la cookie. `/login?reason=session_expired` responde `Set-Cookie: solidus_session=; Max-Age=0`.
   - Las mismas pruebas sobre `http://127.0.0.1:3002`, para verificar `resolveBrowserApiBase`.
4. **Navegador** (lo hace el tester o el usuario; solo lecturas y navegación, sin crear ni editar datos):
   - login con su cuenta;
   - DevTools > Application: `solidus_session` aparece con `HttpOnly`, y en la consola `document.cookie` no la muestra;
   - el dashboard, el Sidebar (nombre, links restringidos según el rol), las tablas (botón Eliminar
     habilitado/deshabilitado como antes) y Ajustes > Honorarios (botón "Eliminar pagador") se ven igual que antes;
   - alternar "Ver como";
   - "Cerrar sesión" lleva al login. "Atrás" y abrir una ruta protegida llevan al login;
   - una cookie vieja `auth_token` creada a mano en DevTools termina borrada y la página pide login.
   - Para probar una escritura real (por ejemplo, editar una atención) se usa **la base descartable**, no la del usuario.
     Si no hay copia disponible, se cubre con el 400 de validación del punto 3 y con los tests.

### 6.2 Base descartable

La regla vigente del usuario es "escrituras de prueba en una copia descartable". Si el tester quiere probar el CRUD desde
la UI, se usa el proyecto aislado de §6.3, con su propio volumen.

### 6.3 Docker (sin tocar 3001)

- **Proyecto compose aislado:** `docker compose -p solidus018 -f docker-compose.yml -f .dev/compose.018.yml up --build -d`.
- El override vive en `.dev/` (ignorado) y no se versiona. Usa `!override` en `ports` (Compose 2.24 o más; si no,
  una copia completa del compose en `.dev/`):
  - `frontend` en `127.0.0.1:3011:3000`;
  - `backend` en `127.0.0.1:8081:8080`;
  - `db` en `127.0.0.1:5434:5432`;
  - build arg `NEXT_PUBLIC_API_BASE_URL=http://localhost:8081/api`;
  - `CORS_EXTRA_ORIGINS=http://localhost:3011,http://127.0.0.1:3011` en la variable de la sesión del shell, sin editar
    `.env`.
- **Volumen propio** (`solidus018_solidus_postgres_data`) y base vacía: `migrate deploy` crea el schema. El usuario de
  prueba se crea **solo en esa base** con datos ficticios.
- **Se verifica:**
  - el login desde `http://localhost:3011` da cookie sin `Secure` (compose con `false`);
  - el SSR con `Bearer` a `backend:8080` funciona;
  - una escritura con la cookie funciona;
  - el logout funciona;
  - con `AUTH_COOKIE_SECURE=true`, el login sobre `http://localhost` funciona en Chrome (excepción de localhost). Esto
    documenta el porqué del default `false`.
- **Limpieza:** `docker compose -p solidus018 down -v` (solo ese proyecto) y borrar el override. Requiere el OK del
  usuario (P5).
- Si no hay OK, Docker queda cubierto por los tests y la revisión del compose, y la prueba real se pospone.

---

## 7. Orden de implementación

Cada paso compila y deja los tests en verde.

1. **Backend: configuración.** `auth-cookie-config.ts` más su spec. `JWT_EXPIRES_IN_SECONDS`. Validación en `bootstrap.ts`.
   Lista blanca de `new Error(`.
2. **Backend: CORS.** `credentials: true` y `x-requested-with`, más el spec.
3. **Backend: guard.** `Bearer` o cookie y CSRF, más el spec. Ampliar `all-routes-auth`.
4. **Backend: login.** Verificación de `Origin`, `Set-Cookie` y cuerpo sin token, más specs (login y rate limit). Hasta acá
   el front viejo sigue andando por `Bearer`, salvo el login. **Los pasos 4 y 6 se entregan juntos.**
5. **Backend: logout.** Handler decorado y registrado, 204 y borrado de la cookie. `cqrs-handlers.spec.ts`.
6. **Front: transporte.** `session.ts` (nombre, helpers nuevos, quitar los lectores), `data.ts` (credentials, header,
   login y logout) y `LoginForm` sin `document.cookie`.
7. **Front: identidad.** `SessionProvider`, layout de servidor, `/` de servidor, reemplazos en Sidebar, AdmisionesTable,
   columns y PayerRulesManager. Quitar `AuthHydrator` y `jwt-decode`.
8. **Front: middleware.** Borrado en `/login?reason`, limpieza de `auth_token` y prefetch. Quitar el rewrite de
   `next.config.ts`.
9. **Front: guardia.** `no-client-token.test.mts` y actualización de tests y de `package.json`.
10. **Test de sincronía** del nombre de la cookie.
11. **Scripts.** `-Smoke` con `Test-SmokeLoginResponse` y tests de dev-lib. Compose y `.env.example`.
12. **Verificación** (criterio 10): `npx tsc --noEmit`, `npx nest build`, `npm test` y `npx eslint` sobre los archivos
    tocados en el backend; `npx tsc --noEmit`, `npm run build`, `npm test` y `npm run lint` en el frontend; tests de
    dev-lib. Después, las pruebas reales (§6).

---

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Romper todas las llamadas del cliente (sin `credentials` o sin el header, la API responde 401 o 403) | Guardia estática en el front, el barrido de `all-routes-auth` con la cookie, `-Smoke` y la prueba con login real |
| El host de la página distinto del host de la API (`127.0.0.1` frente a `localhost`, o la IP de LAN): el navegador descarta la cookie y el login entra en bucle | `resolveBrowserApiBase` para loopback. Para LAN, documentar en COMANDOS y `.env.example` que `NEXT_PUBLIC_API_BASE_URL` va con el mismo host que se abre en el navegador (ya era necesario) |
| `Secure` sobre HTTP (Docker con `NODE_ENV=production`) | `AUTH_COOKIE_SECURE=false` en el compose (P1). Prueba de §6.3 |
| CSRF desde apps vecinas en `localhost` (same-site) | Header propio con preflight y `Origin` en la lista blanca. Tests de barrido |
| Login CSRF (urlencoded habilitado) | Se rechaza un `Origin` ajeno en el login |
| Prefetch o enlace a `/login?reason=session_expired` que cierra la sesión | Se saltean los prefetch. El enlace manual ya cerraba la sesión hoy (paridad) |
| bfcache muestra una página protegida después del logout | `location.replace`, `pageshow` con `router.refresh()` y `Cache-Control` dinámico de Next. Se verifica a mano (§6.1). Si `router.refresh()` no redirige, el desarrollador usa `location.replace(location.href)` y lo documenta |
| Un XSS todavía puede *usar* la sesión mientras la página está abierta (no robarla) | Fuera de alcance. Ítem de BACKLOG para CSP |
| Hosts separados en un despliegue futuro | Ítem de BACKLOG: `AUTH_COOKIE_DOMAIN` o reverse proxy con el mismo host (relacionado con #56 y el 020) |
| Logout con el backend caído deja la cookie (vence en 8 horas como máximo) | Residual documentado. La revocación va al BACKLOG |

**Ítems de BACKLOG que se proponen** (los numera el documentador desde el #106):

- revocación de sesiones (`sessionsRevokedAt` y semántica de logout);
- prefijo `__Host-` cuando haya HTTPS;
- `Domain` o reverse proxy para hosts separados;
- CSP contra XSS;
- renombrar `middleware.ts` a `proxy.ts` (Next 16);
- Swagger con la cookie para escrituras (opcional).

## 9. Documentación (para el documentador)

- **`CLAUDE.md`:**
  - regla 4: la sesión es una cookie `HttpOnly` emitida por el backend; el guard acepta `Bearer` o la cookie; CSRF con
    `x-requested-with` y `Origin`; el "Pendiente: cookie HttpOnly" sale;
  - convenciones del frontend: identidad con `useSessionIdentity()` o `getServerSessionIdentity()`, nunca leer la cookie
    en el cliente; `logout()` en `data.ts`; `readSessionIdentity()` deja de existir;
  - variables: `AUTH_COOKIE_SECURE`.
- **COMANDOS:** `-Smoke` valida la cookie; regla del mismo host; `AUTH_COOKIE_SECURE`; prueba de Docker en un proyecto
  aislado.
- **RIESGOS:** M-3 resuelto; residuales (uso de la sesión con XSS, cookie compartida con otras apps de `localhost`, logout
  con el backend caído).
- **ARQUITECTURA §4:** se quitan el rewrite y `jwt-decode`; comunicación con `credentials`.

---

## 10. Preguntas al PO

| # | Pregunta | Recomendación |
|---|---|---|
| P1 | En el stack Docker local (HTTP, `NODE_ENV=production`), ¿se acepta la cookie **sin `Secure`** (`AUTH_COOKIE_SECURE=false` por defecto en el compose)? Con `Secure`, el login falla en silencio si se entra por la IP de LAN o con Safari | **Sí.** El stack local no tiene TLS. Fuera del compose, producción lleva `Secure` por defecto, y si el front se sirve por https también |
| P2 | ¿La revocación queda fuera (BACKLOG) o se hace la variante `sessionsRevokedAt`? Esa variante cambia el schema y hace que "Cerrar sesión" cierre **todas** las sesiones del usuario | **Fuera.** Va al BACKLOG |
| P3 | Cambio de nombre de la cookie a `solidus_session` (corte limpio: cualquier sesión abierta vuelve a pedir login una vez; la spec ya lo acepta) | **Sí** |
| P4 | Condición nueva: el navegador tiene que abrir el front en el mismo host que la API (`localhost` y `127.0.0.1` se alinean solos; para la IP de LAN ya hacía falta configurar `NEXT_PUBLIC_API_BASE_URL`). Un despliegue con hosts separados queda para el BACKLOG | **Aceptar y documentar** |
| P5 | Prueba real en Docker en un proyecto compose aislado (puertos 3011, 8081 y 5434, volumen propio y descartable, que se borra al final) sin tocar 3001. ¿Lo autoriza el usuario? | **Sí.** Si no, se pospone y Docker queda cubierto por los tests |
| P6 | Quitar el rewrite `/api/:path*` de `next.config.ts` (sin uso; sería un segundo camino al login con la IP del servidor Next) | **Sí** |
| P7 | Swagger: las escrituras con la cookie dan 403 CSRF. Para escribir desde Swagger hay que pegar el token en `Authorize` (se copia de las DevTools). Solo afecta al desarrollo | **Aceptar** |

Ninguna cambia pantallas ni textos. La única consecuencia visible es el re-login único (P3), que la spec ya acepta.

VEREDICTO: APROBADO
