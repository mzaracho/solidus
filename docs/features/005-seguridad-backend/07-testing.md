# 07 — Testing: 005-seguridad-backend

> Autor: tester. Fecha: 2026-11-02. No se modificó código de producción. Único archivo de tests agregado:
> `backend/test/all-routes-auth.spec.ts`. Sin seeds, sin SQL de escritura, sin commit ni push, sin tocar el puerto 3000
> (coach-claudio) ni `.env`, `backend/.env` ni `.claude/`. No se imprimieron ni se escribieron secretos, tokens ni ids:
> los tokens de prueba se firmaron en memoria con el `JWT_SECRET` local y los scripts viven en el scratchpad (fuera del repo).

## 1. Resultados de los comandos

| Comando | Resultado |
|---|---|
| `backend: npx tsc --noEmit` | Sin errores |
| `backend: npx jest` | **13 suites, 141 tests, todos en verde** (antes 12 / 134; +1 suite y +7 tests míos) |
| `backend: npx eslint src/infrastructure.bootstrap/bootstrap.ts` | Sin errores (los 2 preexistentes corregidos) |
| `frontend: npx tsc --noEmit` | Sin errores |
| `frontend: npm test` (`node --test`) | 7 de 7 en verde |
| `frontend: npm run build` (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK, Next 16.4.3. Aviso de deprecación de `middleware` (BACKLOG 31) |
| `scripts/dev-lib.tests.ps1` | **1017 OK, 0 fallidos** |
| `.\dev.ps1 -Init` | Código 0. `backend/.env` tiene una sola línea `CORS_ORIGIN` con `http://localhost:3002` y `http://127.0.0.1:3002` |
| `npm audit --omit=dev` | `next` 16.4.3 sin avisos; frontend: 1 alta (`source-map-js`, transitiva, solo build). Backend: 15 preexistentes de Nest 10 y express; `axios` 1.20.0 no figura |
| Versiones instaladas | `next` 16.4.3, `eslint-config-next` 16.4.3, `axios` 1.20.0 |
| `docker compose build` de backend y frontend (override de CA extra, desde PowerShell con `COMPOSE_BAKE=false`) | OK las dos imágenes (frontend con Next 16.4.3) |

## 2. Tests agregados

`backend/test/all-routes-auth.spec.ts` (7 tests). Arranca el `AppModule` REAL con `PrismaService` reemplazado por un mock (sin base de datos)
y descubre por metadatos todas las rutas de todos los controladores registrados:

1. Descubre más de 40 rutas.
2. Las únicas rutas `@Public` son `GET /health/liveness` y `POST /api/v1/auth/login`.
3. Las únicas `@OrgOptional` son `POST /api/v1/auth/logout` y `GET /api/pro/memberships`.
4. Sin token: **401 en toda ruta no pública**, y el cuerpo no contiene "jwt", "signature", "expired" ni "malformed".
5. Con token válido y organización ajena: **403 en toda ruta** no pública ni `@OrgOptional`.
6. Con token válido y sin organización: 403 en esas mismas rutas.
7. `x-org-id` con slug (`psico-lsa`): 403.

Cierra el hueco que tenía el criterio 20: los specs previos usaban controladores ficticios, y ninguno comprobaba que cada ruta real
quedara bajo los dos guards globales.

## 3. Conteos de la base (criterio 22), solo `SELECT`

| Momento | User | Organization | Patient | WorkItem | Total `public` |
|---|---|---|---|---|---|
| Antes (modo desarrollo recién levantado) | 9 | 3 | 72 | 324 | 1483 (1491 con `_prisma_migrations`) |
| Después del modo desarrollo | 9 | 3 | 72 | 324 | 1483 (1491) |
| Después del modo Docker | 9 | 3 | 72 | 324 | 1483 (1491) |

Aclaración: el "total 1483" de la línea base **excluye** `_prisma_migrations` (8 filas). Contando todas las tablas de `public` salen
1491, y la diferencia son esas 8 filas. Sin cambios entre mediciones. No se creó el usuario de humo: ya existía.

## 4. Criterio por criterio

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Un solo `JwtModule`, `JWT_SECRET` obligatorio de 32+ | `security-invariants.spec` (un `JwtModule.register`), `jwt-config.spec` (secreto ausente o corto). Backend arranca con el secreto real | **Cumple** |
| 2 | Guard global con `verifyAsync`, solo el algoritmo configurado, sin `none` | En vivo (desarrollo y Docker): sin token, basura, `a.b.c`, sin `Bearer`, otro secreto, vencido, `alg none`, HS512 con el secreto correcto, sin `iss`, `aud` distinto, `sub` no UUID y sin `exp` dan 401. Token válido da 200. Jest: `all-routes-auth` (todas las rutas) y `authentication-guard.spec` | **Cumple** |
| 3 | Rutas públicas solo login y salud; Swagger fuera de producción | Test de rutas `@Public` = login y salud. En vivo: `GET /health/liveness` 200 sin token, `/` 404, `/api/health/liveness` 404. Swagger `/docs`: 200 en un backend con `NODE_ENV=development` (puerto auxiliar 8081), 404 en Docker (producción). Ver hallazgo H-1 | **Cumple** (con H-1) |
| 4 | 401 genérico sin detalles | En vivo, 13 variantes: el cuerpo no contiene "jwt", "expired", "signature", "malformed" ni "invalid token"; Jest recorre todas las rutas | **Cumple** |
| 5 | Se eliminan los guards viejos; `OrgRoleGuard` sin `decode` | `security-invariants.spec` (sin `decode`, `ApiKeyGuard`, `VerifyTokenService`, `JwtAuthGuard`). En vivo: miembro MEMBER en `PUT /api/org` da 403 `forbidden`; el rol sale de la base | **Cumple** |
| 6 | Identidad desde `sub`; `x-user-id` ignorado | Jest: `guard-chain.spec`, `authentication-guard.spec`, invariante estático (solo el guard menciona `x-user-id`). **En vivo no se pudo**: no hay usuario `Professional` sin membresía para suplantar (ver sección 6) | **Cumple** (Jest; sin prueba en vivo) |
| 7 | Pertenencia a la organización (UUID; el slug no existe, decisión 1 del PO) | En vivo: ADMIN y MEMBER en su organización 200; organización ajena 403 `org-access-denied`; `x-org-id` slug y no UUID 403; sin `x-org-id` 403; `?organizationId=` y `?orgId=` ajenos 403; `POST /api/activity` con body `organizationId` ajeno y header propio 403; `dashboard/kpis` con la organización ajena en query o header 403; UUID en mayúsculas 200; usuario de humo (sin membresía) con login 201 y 403 en `/api/org` y `/api/dashboard/kpis`; `/api/pro/memberships` 200 y lista vacía. Jest: `Professional` (activo, no borrado) en `org-access-guard.spec` | **Cumple** (el caso `Professional` solo en Jest: la base no tiene un caso) |
| 8 | Fuera de alcance (modo por rol, IDOR por `:id`) | No se verifica. Quedan en BACKLOG 2 y 3 (ver M-2 de seguridad) | n/a |
| 9 | Login con DTO: 400, 401 genérico, handler sin `Error` plano | En vivo: `{}`, `user` numérico, `password` objeto, `user` array y sin `password` dan 400. Usuario inexistente y contraseña errónea dan 401 con **cuerpos idénticos**. Login válido devuelve token. El éxito responde **201** (default de Nest en `POST`), igual que antes; `login.spec` lo fija en 201 | **Cumple** (ver observación O-1) |
| 10 | Logs sin secretos | En vivo, desarrollo (`NODE_ENV=development`, debug activo), tras login de humo + llamadas autenticadas + login fallido con contraseña ficticia: contraseña de humo **ausente**, token completo **ausente**, payload del token **ausente**, firma **ausente**, contraseña ficticia **ausente**, `Bearer ` **ausente**; `[REDACTED]` presente (el body del login sale con `password` redactado). En Docker (producción): contraseña, token, payload, firma, `Bearer ` y `JWT_SECRET` ausentes. `console.*` solo en `logger.ts` (invariante) | **Cumple** |
| 11 | Test automático de login sin contraseña ni token en el logger | `logging.interceptor.spec` (verde). Confirmado en vivo con el punto anterior | **Cumple** |
| 12 | CORS con lista blanca | En vivo (desarrollo, permitido 3002; Docker, permitido 3001): `http://localhost:<p>` y `http://127.0.0.1:<p>` reciben ACAO igual al origen, en preflight y en GET; `http://evil.example`, el puerto del otro modo y `Origin: null` no reciben ACAO; ninguna respuesta trae `Access-Control-Allow-Credentials`. Variable vacía en producción: solo `cors-config.spec` | **Cumple** |
| 13 | Los dos modos sin configuración manual | `-Init` genera una línea `CORS_ORIGIN` (3002, `localhost` y `127.0.0.1`). `docker-compose.yml` tiene 3001 en ambas formas (el backend de Docker se comportó como se espera). `.env.example` y `backend/.env.example` cubiertos por `dev-lib.tests` (1017 OK) | **Cumple** |
| 14 | Token en llamadas desde el servidor | En vivo (desarrollo y contenedor Docker del frontend): `/<org>/work-items` con cookie válida da 200 y los datos de la API aparecen en el HTML; con cookie ajena o slug redirige a `/sin-acceso`; sin cookie redirige al login. Pantallas con carga en el cliente: falta prueba en navegador | **Cumple** (HTTP); navegador pendiente |
| 15 | Sin `mock_token`; la cookie no supera al token | `grep`: `mock_token` solo aparece en un comentario del middleware. Una cookie `mock_token` redirige al login y se borra. `session.test.mts`: `getCookieMaxAgeSeconds` respeta `exp` y el tope de 8 h. El comportamiento del formulario (error sin cookie) requiere navegador | **Cumple** (código y HTTP); formulario pendiente |
| 16 | Sesión vencida: borra cookie y va a login; 403 de organización mensaje claro | Cookie vencida y `mock_token`: 307 a `/login?reason=session_expired&from=...` y la respuesta borra la cookie. Firma basura con `exp` futuro: 307 a login con `reason` (el middleware pasa y el backend responde 401). Organización ajena o slug: 307 a `/sin-acceso`, que responde 200 con cookie y 307 a login sin cookie. `from` externo (`//evil.example`) no redirige. Textos y borrado de cookie en el 401 del servidor: ver sección 6 | **Cumple** (HTTP); UX pendiente |
| 17 | Versiones mínimas y auditoría | `next` y `eslint-config-next` 16.4.3, `axios` 1.20.0 (instalado y en lock), `npm audit --omit=dev` sin avisos de esos paquetes; build OK en local y en Docker | **Cumple** |
| 18 | `-Smoke`: Backend OK, Frontend OK, Login OK | **Desarrollo:** `Backend OK (/health/liveness)`, `Frontend OK (puerto 3002)`, `Login OK`. **Docker:** `-Smoke` no se pudo correr (ver sección 6 y H-2). Se verificó por separado la parte de backend (liveness, login 201, API, CORS, logs) con el backend y la base de Docker, y el frontend con un contenedor en el puerto 3009 | **Cumple en desarrollo; Docker parcial** |
| 19 | Prueba manual en navegador | No hay navegador. Pendiente del usuario (sección 5) | **No verificable** |
| 20 | Tests de Jest requeridos | Guard (sin token, firma, vencido, `alg none`, público, válido): `authentication-guard.spec`, `guard-chain.spec`. `x-user-id` por `sub`: ambos. Pertenencia (miembro, `Professional`, ajeno, UUID, slug): `org-access-guard.spec`. Login (400, 401, 201): `login.spec`. Redacción: `redact.spec`, `logging.interceptor.spec`. CORS (permitido, no permitido, vacío): `cors-config.spec`. Se agregó `all-routes-auth.spec` | **Cumple** |
| 21 | Calidad | `tsc` backend y frontend sin errores; `bootstrap.ts` sin errores de ESLint; `npm test` backend en verde; build del frontend OK (local y Docker con la CA extra); `dev-lib` 1017 OK. ESLint de archivos preexistentes: sin medición propia, ver 05-revision (no hay errores nuevos frente a `HEAD`) | **Cumple** |
| 22 | Datos intactos | Sección 3: 9 / 3 / 72 / 324 / 1483, igual antes y después, en los dos modos. Sin schema nuevo | **Cumple** |

## 5. Para la prueba manual del usuario en el navegador

1. Iniciar sesión con un usuario válido (con membresía). Cargan dashboard, atenciones, work-items, pacientes, profesionales y reglas.
2. En `/login`: campo vacío (mensaje UX 1.3), credenciales erróneas (mensaje genérico, foco), backend detenido (error de red), doble Enter.
3. Verificar que no queda cookie `auth_token` cuando la respuesta no trae token, y que su `max-age` no supera las 8 h.
4. Sesión vencida: editar la cookie `auth_token` con un token con `exp` pasado. Debe llevar a `/login` con el aviso de sesión vencida y volver a la ruta de origen tras el login.
5. Sesión adulterada: cookie con la firma cambiada y `exp` futuro. Navegar a una pantalla de cliente (dashboard) y comprobar que, ante el 401, se borra la cookie y se va a `/login`. Esta ruta no se pudo ejercitar desde el servidor (ver O-2).
6. Usuario de humo (sin membresía): login correcto y luego `/<org>/dashboard` debe mostrar `/sin-acceso` ("sin organización"), sin cerrar la sesión.
7. Usuario con membresía en una URL de otra organización: `/sin-acceso` ("sin acceso").
8. Toasts duplicados por el 403 en `createStaff`, `createPayer` y similares (riesgo conocido, desvío 4 del desarrollador).
9. Contraste de los avisos del login (ámbar y rojo, UX §5): no se midió.
10. Origen `http://127.0.0.1:3002` y `http://localhost:3002` desde el navegador (login directo contra el backend): la API lo permite por CORS (probado por HTTP).

## 6. Lo que no pude verificar

- **Docker completo con `-Smoke` y navegador.** El puerto 3001 lo ocupa otro proyecto del usuario (`reto-solidario-tracking-system`, un `next dev`), y las salvaguardas impiden tocarlo; `.\dev.ps1 -Docker` habría fallado al publicar el frontend. Alternativa: construí las dos imágenes (con la CA extra), levanté `db` y `backend` (producción) y un contenedor del frontend en 127.0.0.1:3009 (borrado al terminar). Quedó probado el backend de producción y el SSR con el backend de Docker; no el frontend en 3001 ni el `Frontend OK`/`Login OK` de `-Smoke` en Docker.
- **`x-user-id` distinto de `sub` en vivo** y **usuario solo `Professional`**: la base no tiene un usuario `Professional` activo sin membresía en su organización. Cubierto por Jest.
- **CORS en producción con `CORS_ORIGIN` vacía** (el backend debe negarse a arrancar): solo `cors-config.spec`; no se alteró el compose.
- **Navegador:** criterios 15, 16 y 19 en su parte visual (sección 5).
- **Contraseñas viejas en logs de contenedores previos:** el contenedor era nuevo, no se analizaron los anteriores.

## 7. Hallazgos y observaciones (no bloquean ningún criterio)

- **H-1 (bajo): `NODE_ENV=local` en el `backend/.env` actual deja el modo desarrollo "como producción".** `runtime-env.ts` reconoce
  solo `development` y `test` (falla cerrado). El `backend/.env` local conserva un valor heredado `NODE_ENV = local` (`Sync-BackendEnv`
  conserva el `NODE_ENV` existente), así que con `.\dev.ps1`:
  - `http://localhost:8080/docs` responde **404**;
  - el nivel debug está apagado;
  - aun así `dev.ps1` imprime `Swagger: http://localhost:8080/docs`.

  Pasos: `.\dev.ps1` y abrir `/docs`. Con `NODE_ENV=development` (probado en un backend auxiliar en 8081) responde 200.
  Sugerencia: que `dev.ps1` normalice `NODE_ENV` a `development` cuando el valor no sea `development`, `test` ni `production`, o que
  `Show-Urls` no anuncie Swagger si el valor es otro. Hoy no es un fallo de seguridad (cierra por defecto).
- **H-2 (informativo): `docker compose build` desde Git Bash con el override de la CA falla** con
  `additional privileges requested: pass "--allow=fs.read=backend\\Dockerfile"` (Compose usa Bake). Desde PowerShell con `COMPOSE_BAKE=false`
  construyó bien. No pude confirmar si `.\dev.ps1 -Docker` (que invoca `docker compose up --build -d` desde PowerShell) se ve afectado; conviene
  que el usuario lo vea en su corrida de Docker.
- **O-1:** el criterio 20 habla de "200" en el login; Nest responde **201** a `POST` y el spec del desarrollador lo fija en 201. Es el
  comportamiento previo. El frontend lo acepta (el login funciona y `-Smoke` da Login OK).
- **O-2:** cuando el backend responde 401 durante el render de servidor (por ejemplo `/<org>/work-items`), el redirect a
  `/login?reason=session_expired` no borra la cookie (un Server Component no puede escribirla). El middleware sí la borra si está vencida o no
  decodifica. Con firma adulterada y `exp` futuro, el borrado depende de `/login` o del cliente; confirmar en navegador (punto 5 de la sección 5).
- **O-3 (preexistente):** `work-items/page.tsx` pasa a `WorkloadTable` el objeto `{ items, total, ... }` en lugar del array
  (`data={items}`, igual en `HEAD`), por lo que la tabla muestra "No results" aunque la API devuelve 324 atenciones. No es regresión del 005;
  es un bug anterior que conviene corregir en otra tarea.
- **O-4:** en los logs de desarrollo el email del usuario de humo aparece en el body del login (`user`); no es secreto según los criterios, pero
  es un identificador. En producción no aparece.
- **O-5 (conocido):** las respuestas 401 y 403 de los guards se registran solo con el mensaje ("Unauthorized"/"Forbidden"), sin método ni ruta
  (B-3 de seguridad).
- `frontend/AGENTS.md` y `.vscode/` aparecen sin trackear y no pertenecen al feature (no incluir `.vscode/` en el commit).

## 8. Estado del entorno al terminar

- `.\dev.ps1 -Stop` ejecutado. Puertos 3002, 8080, 8081, 3009 y 5433 libres. El 3000 (coach-claudio) y el 3001 (otro proyecto) quedaron
  como estaban.
- Contenedores `healthops-gem-db-1` y `healthops-gem-backend-1` detenidos (no existían antes de mi corrida; volumen de datos intacto, sin
  `down -v`). El contenedor auxiliar `qa-front-005` se eliminó.
- Las imágenes `healthops-gem-backend` y `healthops-gem-frontend` se reconstruyeron con el código actual.
- `.env`, `backend/.env` y `.claude/` sin modificar (`-Init` informó "sin cambios" y sincronizó `backend/.env` sin diferencias).
- Los scripts de prueba están en el scratchpad de la sesión, fuera del repositorio, y no contienen secretos.

VEREDICTO: APROBADO
