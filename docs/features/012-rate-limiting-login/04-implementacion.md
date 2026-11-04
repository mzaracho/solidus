# 012 — Rate limiting del login: implementación

## Elección: implementación propia (sin `@nestjs/throttler`)
- El limitador necesita una lógica que el throttler no da de fábrica: contar **fallidos por IP + usuario normalizado**
  con **reinicio al login exitoso**, y decidir el 429 **dentro del controlador** con el `ErrorResponse` genérico del
  proyecto. Con el throttler habría que escribir un guard y un `getTracker` propios sobre el cuerpo, y un storage
  propio para el reinicio: más código que la clase chica.
- Cero dependencias nuevas: no hay `npm audit` que correr ni versión que fijar. El almacén es un `Map` de ~150 líneas,
  con reloj inyectable (tests deterministas) y sin timers (no deja handles abiertos en Jest ni en el cierre).

## Cambios por criterio
1. **Límites** (`login-rate-limiter.ts`, `login-rate-limit-config.ts`): ventana fija. Por IP, 20 intentos; por
   IP + usuario (`trim().toLowerCase()`), 5. El intento se **cuenta al llegar** (antes de bcrypt), así que ráfagas
   concurrentes tampoco pasan el límite; un login exitoso borra solo la combinación (el contador de la IP sigue).
   Variables `LOGIN_RATE_LIMIT_IP`, `LOGIN_RATE_LIMIT_USER`, `LOGIN_RATE_LIMIT_WINDOW` (segundos), enteros
   `^\d+$` entre 1 y 100000 / 10000 / 86400; vacías o ausentes = default. El provider (`LoginRateLimiterProvider`) las
   valida en la factory al arrancar y lanza un `Error` que nombra la variable y no imprime el valor.
2. **429** (`auth-controller.ts`): `HttpException({ code: 'too-many-requests', message }, 429)` más `Retry-After`
   (segundos hasta que venza la ventana bloqueante). Se decide antes de despachar `LoginQuery`: sin bcrypt ni base.
   Misma respuesta exista o no el usuario. La línea de acceso del 010 la registra por ser un middleware global.
   Un intento rechazado no se cuenta ni extiende la ventana.
3. **Almacén**: memoria del proceso; barrido perezoso de vencidos como mucho cada 60 s (al consumir), tope de 10.000
   entradas (si sigue lleno tras el barrido se descarta la más antigua). Documentado en el código que con varias
   instancias hace falta un almacén compartido.
4. **IP**: `req.socket.remoteAddress` (no `req.ip`, para que un futuro `trust proxy` no la cambie sin querer);
   `::ffff:a.b.c.d` se normaliza a IPv4. `X-Forwarded-For` se ignora (test).
5. **Resto de rutas**: sin cambios ni límite global (no lo justifiqué: el login es el único objetivo de fuerza bruta
   de credenciales).
6. **Frontend**: `login()` devuelve `{ status: 'rate-limited', retryAfter: number | null }` ante 429;
   `LoginForm` muestra `SESSION_MESSAGES.rateLimited` y, si hay `Retry-After`, `retryInMinute` / `retryInMinutes`
   (`{n}` = minutos hacia arriba). Mismo `#login-error`, mismo `aria-describedby`; el foco va al botón como en los
   fallos de red/servidor (no invalida los campos). Helpers puros `parseRetryAfterSeconds` y `retryAfterMinutes` en
   `lib/session.ts` (sin imports, testeables con `node --test`).
7. **Tests no se bloquean**: cada `createLoginApp` crea su propio limitador; `login.spec.ts` (app compartida) reinicia
   el almacén en `beforeEach` sin tocar aserciones. `all-routes-auth` y `org-isolation` no hacen logins repetidos.
8. **Tests**: ver abajo.

## Archivos
Backend (nuevos): `src/infrastructure/features/auth/services/login-rate-limiter.ts` (+ `.spec.ts`),
`src/infrastructure.bootstrap/config/app/login-rate-limit-config.ts` (+ `.spec.ts`),
`src/api/controllers/v1/auth/login-rate-limit.spec.ts`.
Backend (modificados): `auth-controller.ts`, `modules/features/auth/auth-module.ts` (provider),
`config/app/cors-config.ts` y `.spec.ts`, `application/features/auth/login.spec.ts` (reinicio), `test/helpers/login-app.ts`
(provider del limitador).
Frontend: `services/data.ts`, `components/domain/auth/LoginForm.tsx`, `lib/constants.ts`, `lib/session.ts`,
`services/login-rate-limit.test.mts` (nuevo), `package.json` (agrega el test al script `test`).
Raíz: `.env.example`, `backend/.env.example` (variables comentadas con defaults).

## Variables nuevas (todas opcionales)
`LOGIN_RATE_LIMIT_IP=20`, `LOGIN_RATE_LIMIT_USER=5`, `LOGIN_RATE_LIMIT_WINDOW=900`. Siguen el patrón de
`BODY_SIZE_LIMIT`: el `.env` raíz no las pasa al backend; en desarrollo se definen en `backend/.env` y Docker usa los
defaults.

## Tests
- Jest `login-rate-limiter.spec.ts` (12): 5+1, IP 20, otra IP, normalización, reinicio tras éxito (y que la IP sigue
  contando), rechazo que no extiende la ventana, vencimiento con reloj simulado, barrido, tope, `reset`.
- Jest `login-rate-limit-config.spec.ts`: defaults, valores válidos, 13 inválidos (el mensaje nombra la variable y no el valor).
- Jest `login-rate-limit.spec.ts` (HTTP real con supertest, Prisma mock): 401x5 y 429 con cuerpo genérico, `Retry-After`,
  sin bcrypt ni `findUnique` en el 429; existente = inexistente; límite por IP con otros usuarios; reinicio tras éxito;
  400 de validación no consume; `X-Forwarded-For` rotado no evita el límite; normalización; vencimiento (`Date.now`
  simulado); logout no recibe 429.
- Jest `cors-config.spec.ts`: `Retry-After` en `exposedHeaders` y en `Access-Control-Expose-Headers`.
- `node --test` `login-rate-limit.test.mts`: mapeo 429 en `login()` (estático, porque `data.ts` usa el alias `@/`),
  texto solo en constantes, `parseRetryAfterSeconds`, `retryAfterMinutes`.

## Calidad
- Backend: `npx tsc --noEmit` sin errores; `npx jest`: 35 suites, 604 tests en verde; ESLint sin errores en los
  archivos tocados (solo warnings de `eslint-disable` sobrantes que ya existían).
- Frontend: `npx tsc --noEmit` sin errores; `npm test`: 40 tests en verde; `npm run build` OK
  (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`); ESLint: `data.ts` conserva sus 13 errores
  `no-explicit-any` preexistentes (mismo conteo que en HEAD), sin errores nuevos.
- `npm audit`: no aplica (sin dependencias nuevas).

## Desvíos y decisiones fuera de la spec
- **CORS**: el navegador no puede leer `Retry-After` entre orígenes salvo que se exponga. Agregué
  `exposedHeaders: ['Retry-After']` a `cors-config.ts` (sin eso `retryAfter` sería siempre `null` en el front real).
  El frontend degrada bien: sin header muestra solo el texto fijo.
- Los 400 del DTO no consumen intentos (el pipe corre antes del controlador y no cuestan bcrypt ni base).
- Intentos contados al llegar (no solo "fallidos" a posteriori) para evitar la carrera de peticiones concurrentes;
  el efecto observable es el pedido: 5 fallidos y el sexto da 429.
- No toqué `dev.ps1`: no propaga las variables nuevas (igual que `BODY_SIZE_LIMIT`).

## Notas
- **Revisor**: el cambio funcional está en `auth-controller.ts` y el limitador; el tope descarta la entrada más
  antigua cuando el barrido no alcanza (con IPs de conexión reales es difícil llenarlo: cada IP aporta como mucho
  1 + 20 entradas por ventana).
- **Seguridad**: IPv6 se cuenta por dirección completa (un atacante con un /64 rota direcciones y esquiva el límite por
  IP; el límite por IP+usuario lo frena solo por dirección). Posible mejora: agrupar por /64. Detrás de un proxy futuro
  todas las peticiones compartirían IP: queda pendiente configurar `trust proxy` y tomar la IP real. Reiniciar el
  proceso vacía los contadores. Los `details` del filtro (`JSON.stringify(exception)`) también salen en el 429, como en
  el 401 actual (tema de la feature 013).
- **Tester**: para el criterio 10, reiniciar el backend vacía los contadores; el `-Smoke` hace un solo login. El 429
  del front solo muestra los minutos si CORS expone `Retry-After` (ya agregado). Las variables se prueban en
  `backend/.env` (ej. `LOGIN_RATE_LIMIT_USER=abc` debe impedir el arranque).

## Vuelta de corrección 1

### Por hallazgo
- **M-1 seguridad (IPv6)**: `LoginRateLimiter.normalizeIp` agrupa IPv6 por prefijo /64 (clave `2001:db8:1:2::/64`;
  parser propio de IPv6: `::`, mayúsculas, zone id, IPv4 incrustada). IPv4 e IPv4 mapeada (`::ffff:a.b.c.d`) siguen por
  dirección completa. La misma clave se usa para el contador por IP y el de IP+usuario. Ilegible = `'unknown'`.
- **M-3 seguridad / M3 revisor (tope)**: `consume` calcula cuántas claves nuevas necesita (0 a 2) y, si no caben,
  barre las vencidas; si sigue sin lugar **rechaza con 429 genérico** (Retry-After = min(60 s, ventana)) sin contar el
  intento. Ya no se desaloja ninguna entrada viva (ni bloqueante ni no bloqueante: desalojar una de 4/5 también le
  devolvería intentos al atacante). Las claves existentes siguen contando con el almacén lleno. Costo: un atacante con
  más de 10.000 claves vivas puede impedir logins de IPs nuevas durante la ventana (es el compromiso fail-closed pedido).
  > **Nota del documentador:** la afirmación original de que esto era "impracticable" con IPv4 real y /64 es incorrecta:
  > unas ~480 IPv4 o un /48 IPv6 bastan (N-1 de `06-seguridad.md`, BACKLOG 57).
- **B-4 seguridad**: con el almacén lleno el barrido completo corre como mucho cada `FULL_SWEEP_INTERVAL_MS` (1 s).
- **M1 revisor (IP ausente)**: comentario en `normalizeIp` y test: IP ausente/ilegible comparte el cubo `'unknown'`
  (falla cerrado a propósito).
- **M2 revisor (coherencia)**: **warning** al arrancar (Nest `Logger`) si `LOGIN_RATE_LIMIT_USER` > `LOGIN_RATE_LIMIT_IP`;
  nombra solo esas dos variables, sin valores. Elegí warning y no rechazo porque la configuración es ineficaz pero no
  insegura ni inválida, y tumbar el servicio por un ajuste de operador es peor. `getLoginRateLimitOptions(config, warn?)`
  recibe el callback para poder probarlo.
- **S1 revisor (test estático)**: nueva función pura `mapLoginFailure(status, retryAfterHeader)` y tipo `LoginFailure` en
  `frontend/src/lib/session.ts` (sin imports); `login()` en `data.ts` la usa (reemplaza los `if` de status). El test
  `login-rate-limit.test.mts` ahora prueba comportamiento (401/400/429 con y sin header/5xx/otros/2xx) y solo verifica
  por texto que `login()` la invoca.

### Archivos
Backend: `infrastructure/features/auth/services/login-rate-limiter.ts` y `.spec.ts`,
`infrastructure.bootstrap/config/app/login-rate-limit-config.ts` y `.spec.ts`.
Frontend: `src/lib/session.ts`, `src/services/data.ts`, `src/services/login-rate-limit.test.mts`.

### Tests nuevos
- Limiter: varias direcciones del mismo /64 comparten contador de usuario y de IP; dos /64 distintos no; IPv4/mapeada;
  claves de IPv6 comprimida = expandida; IP ausente = `'unknown'`; tope (rechazo 429 sin superar 10.000, no desaloja
  bloqueantes, claves existentes siguen, se libera al vencer, barrido de lleno limitado a 1 por segundo).
- Config: warning con USER > IP (sin valores, sin rechazar) y sin warning con defaults / USER <= IP.
- Frontend: 3 tests de `mapLoginFailure` + uno de uso en `data.ts`.

### Resultados
- Backend: `npx tsc --noEmit` OK; `npx eslint` de los 4 archivos tocados sin errores; `npx jest`: 35 suites, 616 tests OK.
- Frontend: `npx tsc --noEmit` OK; `npm test`: 42 tests OK; `npm run build` OK (con la variable de certificados del
  sistema); eslint: `data.ts` con los mismos 13 `no-explicit-any` preexistentes, `session.ts` solo un warning previo.

### Pendiente (no tocado)
M-2 seguridad (Docker/NAT: IP del gateway, `trust proxy`) queda para documentación/BACKLOG; B-1, B-2 y M4 revisor, sin cambios.
