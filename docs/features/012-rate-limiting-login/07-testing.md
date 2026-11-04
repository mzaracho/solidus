# 07 — Testing: 012-rate-limiting-login (incluye vuelta 1)

> Autor: tester. Fecha: 2026-11-04. No se modificó código de producción. Sin seeds, SQL de escritura, commit, push, stash, reset ni checkout. FRONTEND_PORT=3002, sin Docker para la app, puertos 3000/3001 intactos. Solo emails ficticios `*@example.test` y contraseñas falsas; el usuario de humo no se usó para provocar bloqueos. No se imprimieron valores del `.env`, tokens ni contraseñas. Scripts auxiliares solo en `/tmp`.

## 1. Resultados automáticos

| Comando | Resultado |
|---|---|
| backend `npx tsc --noEmit` | Sin errores |
| backend `npx jest` | 35 suites, 616 tests, todo en verde |
| frontend `npx tsc --noEmit` | Sin errores |
| frontend `npm test` (`node --test`) | 42 tests, todo en verde |
| frontend `npm run build` (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK |
| ESLint | No lo corrí; lo informan 04 y 05 (0 errores nuevos) |

## 2. Verificación en vivo (modo desarrollo)

Nota: el campo del body del login es `user` (no `email`); con `email` el DTO estricto da 400 y no consume intentos (comportamiento correcto, confirmado de paso).

| Caso | Esperado | Obtenido |
|---|---|---|
| Mismo email ficticio, intentos 1 a 5 | 401 | 401 x5 |
| 6.º intento | 429, `code: too-many-requests`, cuerpo genérico, `Retry-After` en segundos | 429; `code: too-many-requests`; mensaje "Demasiados intentos. Esperá unos minutos antes de volver a intentar."; `Retry-After: 900` |
| Otros 15 emails ficticios distintos, misma IP | 401 hasta completar 20 intentos aceptados (5 + 15) | 401 x15; el siguiente (16.º otro email) 429 |
| Otro email nuevo con el límite por IP agotado | 429 | 429 |
| `X-Forwarded-For: 203.0.113.9` con email nuevo | Sigue contando para la IP real (429) | 429 (`Retry-After` decreciente, 897 s) |
| CORS con `Origin: http://localhost:3002` | `Access-Control-Expose-Headers` incluye `Retry-After` | Presente, junto con `Access-Control-Allow-Origin` del origen permitido |
| Cuerpo del 429 | Sin contraseñas ni datos del usuario | Solo código y mensaje genérico (más `details` con la excepción serializada, tema de la feature 013; igual que el 401) |
| Reinicio del backend (`-Stop` + `.\dev.ps1`) y `.\dev.ps1 -Smoke` | Backend, Frontend y Login OK | Backend OK, Frontend OK, Login OK; un email ficticio vuelve a dar 401 (contadores vaciados) |

## 3. Criterio por criterio

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Límites 20/IP y 5/IP+usuario, ventana 15 min, reinicio tras éxito, variables validadas | En vivo: 5x401 + 429; 20 intentos aceptados por IP y luego 429. Jest: `login-rate-limiter.spec`, `login-rate-limit-config.spec` (defaults, válidos, inválidos, warning USER > IP) y `login-rate-limit.spec` (reinicio tras éxito, normalización) en verde. Arranque con variable inválida: solo por Jest (no edité `backend/.env`) | Cumple |
| 2 | 429 genérico con `Retry-After`, sin bcrypt ni base, igual exista o no el usuario, línea de acceso del 010 | En vivo: 429 con código, mensaje y `Retry-After`. Jest HTTP: sin bcrypt ni `findUnique` en el 429, existente = inexistente. Línea de acceso: no verificada en vivo (ver sección 6) | Cumple (línea de acceso sin verificar en vivo) |
| 3 | Almacén en memoria con limpieza y tope; documentado | Jest: barrido, tope fail-closed (vuelta 1), vencimiento con reloj simulado, `reset`. Sin dependencias nuevas | Cumple |
| 4 | IP de la conexión, sin confiar en `X-Forwarded-For` | En vivo: XFF falso sigue dando 429. Jest HTTP con XFF rotado | Cumple |
| 5 | El resto de rutas no cambia | Suites `all-routes-auth` y `org-isolation` verdes (616 tests); logout no recibe 429 (Jest) | Cumple |
| 6 | Frontend: estado `rate-limited`, mensaje en constantes, `#login-error` | `node --test` 42 verdes (`mapLoginFailure`, `parseRetryAfterSeconds`, `retryAfterMinutes`, texto solo en `SESSION_MESSAGES`); build OK; `Retry-After` expuesto por CORS (en vivo). Render en navegador: lista manual (sección 5) | Cumple (UI pendiente de comprobación manual) |
| 7 | Smoke y tests no se bloquean solos | `-Smoke` OK tras reinicio; Jest en verde con limitador por app y `reset()` | Cumple |
| 8 | Tests Jest y frontend | Cubren lo pedido (ver criterio 1 a 6) | Cumple |
| 9 | Calidad | `tsc` backend y frontend, Jest 616, `node --test` 42, build OK; ESLint según 04/05 | Cumple |
| 10 | Verificación en vivo | Sección 2 completa; conteos sin cambios (sección 4) | Cumple |

## 4. Conteos (solo `SELECT count`)

| Momento | User | Organization | Patient | WorkItem | Total filas de `public` (sin `_prisma_migrations`) |
|---|---|---|---|---|---|
| Antes (tras levantar, previo a las pruebas) | 9 | 3 | 72 | 324 | 1483 |
| Después (tras reinicio y Smoke, antes del `-Stop` final) | 9 | 3 | 72 | 324 | 1483 |

## 5. Lista de verificación manual en navegador (para el usuario)

1. Ejecutar `.\dev.ps1` y abrir http://localhost:3002 (login).
2. Con un email ficticio (por ejemplo `qa@example.test`) y una contraseña falsa, enviar 5 veces: debe verse el mensaje de credenciales inválidas habitual.
3. En el 6.º intento debe aparecer en `#login-error` "Demasiados intentos. Esperá unos minutos antes de volver a intentar." seguido de "Probá de nuevo en N minutos." (N cercano a 15).
4. Confirmar que el foco va al botón, que los campos no quedan marcados como inválidos y que nada se cierra.
5. Reiniciar el backend (`.\dev.ps1 -Stop` y `.\dev.ps1`) para vaciar contadores antes de usar el usuario real.
6. No usar el usuario real ni el de humo para provocar el bloqueo.

## 6. Bugs

Ninguno.

Observación (no es bug del feature): el 429 incluye `details` con la excepción serializada, igual que el 401; lo trata la feature 013.

## 7. Qué no pude verificar

- Línea de acceso del 010 para el 429 y ausencia de contraseñas en los logs: el backend corre en una ventana propia sin archivo de log (`.dev/` solo tiene `certs` y `processes.json`), así que no pude leer la salida. Queda cubierto por diseño (middleware global del 010) y por la ausencia de contraseñas en el cuerpo del 429; conviene mirar la consola del backend durante la prueba manual.
- Arranque con variable inválida (`LOGIN_RATE_LIMIT_USER=abc`): no edité `backend/.env`; solo por Jest.
- Render real del mensaje en el navegador (lista manual).
- ESLint (según 04/05, sin errores nuevos), modo Docker (IP del gateway, M-2 de seguridad), IPv6 en vivo (solo Jest).
- `scripts/dev-lib.tests.ps1` no se corrió (no aplica); el archivo sigue en disco.

## 8. Estado del entorno

- `.\dev.ps1 -Stop` ejecutado al final: 2 procesos y contenedor detenidos, volumen intacto. Puertos 3002, 8080 y 5433 libres; 3000 y 3001 no se tocaron.
- Solo se suma este `07-testing.md`. `.env`, `backend/.env` y `.claude/` sin cambios míos.

VEREDICTO: APROBADO
