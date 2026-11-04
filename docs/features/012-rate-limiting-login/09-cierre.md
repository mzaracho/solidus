# 09 — Cierre: 012-rate-limiting-login

Fecha: 2026-11-04. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, con **1 vuelta de corrección de 3**. Esa vuelta la decidió el PO para M-1 y M-3 de
seguridad, más los menores del revisor.

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI, arquitecto | — | Omitidos: el mensaje sigue el patrón del login y el enfoque lo fija la spec |
| Desarrollador | 04-implementacion.md | Completo, con la vuelta 1 |
| Revisor | 05-revision.md | APROBADO; vuelta 1 APROBADO |
| Seguridad | 06-seguridad.md | APROBADO (M-1 y M-3 corregidos); vuelta 1 APROBADO |
| Tester | 07-testing.md | APROBADO |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **Limitador propio en memoria (`login-rate-limiter.ts`), sin dependencias nuevas:**
  - ventana fija de 15 minutos;
  - 20 intentos por IP y 5 por IP más usuario normalizado;
  - el intento se cuenta al llegar, antes de bcrypt y de la base;
  - un login exitoso reinicia solo la combinación IP más usuario.
- **IP:**
  - se toma de la conexión, sin `X-Forwarded-For`;
  - IPv6 se agrupa por /64;
  - las IPs ilegibles comparten un contador `'unknown'`.
- **Tope de 10.000 claves:**
  - si no hay lugar, la clave nueva recibe 429 (falla cerrado) y no se desaloja ninguna entrada viva;
  - el barrido completo corre como mucho una vez por segundo.
- **Respuesta 429:**
  - `ErrorResponse` genérico, con `code: too-many-requests` y `Retry-After`;
  - es idéntico exista o no el usuario;
  - `Retry-After` va expuesto por CORS.
- **Variables:** `LOGIN_RATE_LIMIT_IP`, `LOGIN_RATE_LIMIT_USER` y `LOGIN_RATE_LIMIT_WINDOW`.
  - Un valor inválido impide arrancar.
  - Si USER es mayor que IP, se muestra un aviso.
- **Frontend:**
  - `mapLoginFailure` es una función pura;
  - con un 429 el login muestra "Demasiados intentos…" y, si viene `Retry-After`, "Probá de nuevo en N minutos";
  - los textos están en `SESSION_MESSAGES`.
- **Tests:** backend con 35 suites y 616 tests; frontend con 42.
- **Documentación:**
  - COMANDOS: sección de rate limiting y error común;
  - `CLAUDE.md`;
  - BACKLOG: #11 resuelto y nuevos #56 a #58;
  - RIESGOS (local).

## Verificación de los criterios (PO)
| Criterios | Estado |
|---|---|
| 1, 2 | Cumplen en vivo: 5 intentos dan 401, el sexto da 429 con `Retry-After: 900`; el límite por IP es 20 |
| 3, 4 | Cumplen: en vivo, `X-Forwarded-For` se ignora; el tope y la limpieza se prueban en Jest |
| 5 | Cumple: no hay límite global |
| 6 | Cumple en código y tests. **Falta la prueba en navegador del mensaje** |
| 7 | Cumple: después de reiniciar, `-Smoke` da OK |
| 8, 9 | Cumplen |
| 10 | Cumple. La línea de acceso del 429 no se pudo leer, porque la consola del backend corre en su propia ventana; queda en la lista manual. Los conteos no cambiaron |

## Pendiente
- **Prueba manual:** el mensaje en pantalla tras 6 intentos con un email ficticio y la línea `... 429` en la consola del
  backend.
- **#56:** `trust proxy` e IP real detrás de Docker, NAT o proxy (M-2). Va al 019.
- **#57:** llenar el almacén bloquea logins de IPs nuevas (N-1). Falta un `Logger.warn` limitado y un tope
  configurable o un almacén compartido. Incluye la IPv6 mapeada en hexadecimal (N1 del revisor).
- **#58:** riesgos bajos: el borde de la ventana fija, la falta de un límite por usuario independiente de la IP y
  máximos configurables muy altos.
- **El 429 todavía trae `details`:** lo resuelve el 013.

## Pasos omitidos
UX/UI y arquitecto, por lo que indica la spec.
