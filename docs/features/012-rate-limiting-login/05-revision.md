# 012 — Rate limiting del login: revisión

## Resultados de las verificaciones
- Backend `npx tsc --noEmit`: sin errores.
- Backend `npx eslint` sobre los archivos tocados: 0 errores, 26 warnings (todos "Unused eslint-disable directive" preexistentes en specs/helpers).
- Backend `npx jest`: 35 suites, 604 tests en verde.
- Frontend `npx tsc --noEmit`: sin errores.
- Frontend `eslint` (data.ts, LoginForm.tsx, session.ts, constants.ts): 13 errores `no-explicit-any` en `data.ts`, preexistentes (mismo conteo que HEAD según 04); sin errores nuevos.
- Frontend `npm test`: 40 tests, todos en verde.
- Frontend `npm run build` (con la variable de certificados del sistema): OK.

## Cumplimiento de los criterios
1. Límites: OK. `consume` cuenta antes de bcrypt y de la base, 20 por IP y 5 por IP+usuario, ventana fija (`resetAt` se fija al crear la entrada), y `recordSuccess` borra solo la clave `u:` (la de IP sigue). Normalización `trim().toLowerCase()`. Variables validadas con `^\d+$`, rango y mensaje que nombra la variable sin imprimir el valor; la factory del provider corre al arrancar.
2. 429: OK. `HttpException({code, message}, 429)` más `Retry-After` en segundos (mínimo 1), decidido antes del dispatch. Mismo resultado exista o no el usuario. Un rechazo no cuenta ni extiende la ventana.
3. Almacén: OK. Map en memoria, barrido perezoso cada 60 s, tope de 10.000 y descarte del más antiguo. Sin timers. La elección propia (sin dependencia) está justificada en 04.
4. IP: OK. `req.socket.remoteAddress`, normaliza `::ffff:`, ignora `X-Forwarded-For` (hay test HTTP).
5. Sin límite global: OK.
6. Frontend: OK. Estado `rate-limited` con `retryAfter`, textos en `SESSION_MESSAGES`, mismo `#login-error`, foco al botón.
7. Tests no se bloquean: OK (limitador propio por `createLoginApp`, `reset()` en `beforeEach` de login.spec).
8. Tests: cubren lo pedido (límites, 429, reinicio, igualdad existente/inexistente, reloj simulado, limpieza, validación, XFF) y el mapeo de 429 en el front.
9. Calidad: OK según lo corrido arriba.

## Hallazgos

### BLOQUEANTE
Ninguno.

### MAYOR
Ninguno.

### MENOR
- M1. `backend/src/api/controllers/v1/auth/auth-controller.ts:49` y `login-rate-limiter.ts:51-53`. Si `req.socket.remoteAddress` falta, la IP queda en `'unknown'` y todas esas peticiones comparten un solo cubo. No es un problema práctico con sockets TCP reales, pero un fallo de ese tipo bloquearía a todos tras 20 intentos. Sugerencia: dejar un comentario o un test que fije ese comportamiento a propósito (cierra en fallo hacia el bloqueo).
- M2. `login-rate-limit-config.ts:41-65`. No se valida la coherencia entre variables (por ejemplo `LOGIN_RATE_LIMIT_USER` mayor que `LOGIN_RATE_LIMIT_IP` hace inútil el límite por usuario). No rompe nada y la spec no lo pide. Sugerencia: documentarlo en `.env.example` o emitir un warning al arrancar.
- M3. `login-rate-limiter.ts:126-143` (tope). Con el almacén lleno, `makeRoom` descarta la entrada más antigua aunque no haya vencido, y puede ser el contador de una víctima bloqueada. Alcanzarlo exige más de 10.000 claves vivas, y 04 argumenta bien que cada IP aporta pocas entradas. Es un riesgo teórico de evasión; vale una nota para el rol de seguridad (ya mencionada en 04). Sin acción obligatoria.
- M4. Los intentos exitosos también consumen del límite por IP (20 por ventana). Coincide con la spec ("intentos"), pero una clínica con NAT y muchos ingresos en 15 minutos podría chocar. Mitigación ya prevista: la variable es configurable. Solo para que el documentador lo mencione en COMANDOS.

### SUGERENCIA
- S1. `frontend/src/services/login-rate-limit.test.mts`: el test estático sobre el texto de `data.ts` es aceptable como solución puntual, porque `data.ts` usa el alias `@/` y el proyecto no tiene framework. Es frágil ante refactors: depende del marcador `'\n// --- SERVICE FUNCTIONS'` (si no existe corta hasta el final del archivo, sin romper), de las comillas simples y del orden `429` antes de `!res.ok`. Un renombre o un cambio de formato lo rompería sin que cambie el comportamiento, y un cambio de comportamiento que conserve el texto pasaría sin detectarse. Sugerencia a futuro: extraer el mapeo de status a una función pura (por ejemplo `mapLoginStatus(status, retryAfterHeader)` en `lib/session.ts`) y probarla por comportamiento; así el test estático solo verificaría que `login()` la usa.
- S2. `login.spec.ts` (`app.get(LoginRateLimiter).reset()`): correcto. Con `strict: false` en `app.get` es suficiente aquí, no hace falta cambiar nada.
- S3. Considerar un test de integración del `Retry-After` real en el header CORS desde el navegador (lo verificará el tester en vivo). El desvío `exposedHeaders: ['Retry-After']` en `cors-config.ts` es necesario, mínimo, no amplía permisos de lectura de otros headers, y está cubierto por dos tests: aprobado.
- S4. Los `details` del filtro salen en el 429 como en el 401 (tema de la 013); sin acción aquí.

## Convenciones
- CQRS/capas: el limitador vive en `infrastructure/`, el provider en `infrastructure.bootstrap/config/app`, el controlador sigue fino. La decisión del 429 en el controlador está justificada y documentada.
- Errores de negocio con `HttpException` de Nest, constantes de UI en `SESSION_MESSAGES`, alias `@src/*`, Prettier respetado. Las rutas existentes no cambian.
- El `AuthController` ahora exige `LoginRateLimiter`: cualquier módulo de test que lo instancie debe registrar el provider (hecho en `login-app.ts`; `all-routes-auth` y `org-isolation` pasan).

(Veredicto de la primera revisión: APROBADO, sin bloqueantes ni mayores.)

## Re-revisión (vuelta 1)

### Verificaciones
- Backend `npx tsc --noEmit`: sin errores. `npx eslint` sobre los 4 archivos tocados: sin errores. `npx jest`: 35 suites, 616 tests en verde.
- Frontend `npx tsc --noEmit`: sin errores. `eslint` de `session.ts` y `data.ts`: 13 `no-explicit-any` preexistentes en `data.ts` y 1 warning previo; nada nuevo. `npm test`: 42 tests en verde. `npm run build` (con la variable de certificados): OK.

### Hallazgos previos
- M-1 seguridad (IPv6 /64): resuelto. `normalizeIp` agrupa por /64 con parser propio (`::`, mayúsculas, zone id, IPv4 incrustada); IPv4 y `::ffff:a.b.c.d` siguen por dirección; ilegible = `unknown`. La misma clave sirve a los contadores de IP y de IP+usuario.
- M-3 seguridad / M3 mío (tope): resuelto. `consume` calcula las claves nuevas necesarias, barre vencidas y, si no hay lugar, rechaza con 429 sin contar ni desalojar entradas vivas; las claves existentes siguen contando. Barrido completo limitado a 1 por segundo (B-4).
- M1 mío (IP ausente): documentado y con test. M2 mío: warning al arrancar sin valores. S1: `mapLoginFailure` pura en `session.ts`, usada por `login()`; el test prueba comportamiento.

### Hallazgos nuevos
#### BLOQUEANTE / MAYOR
Ninguno.
#### MENOR
- N1. `login-rate-limiter.ts:94-105`. Una IPv6 mapeada en forma hexadecimal (`::ffff:7f00:1`) no coincide con la regex de punto decimal y cae en el /64 `0:0:0:0::/64`, compartido con `::1` y otras mapeadas hex. Node entrega la forma con puntos, así que no es práctico hoy. Sugerencia: detectar `groups[0..4]==0 && groups[5]==0xffff` y devolver el IPv4 correspondiente.
- N2. Con el almacén lleno, un atacante con más de 10.000 claves vivas puede bloquear logins de IPs nuevas (compromiso fail-closed ya declarado en 04). Sin acción.

Pendientes aceptados: M-2 seguridad (Docker/NAT) a documentación/BACKLOG; B-1, B-2, M4.

VEREDICTO: APROBADO
