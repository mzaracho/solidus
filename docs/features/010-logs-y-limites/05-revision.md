# 010 — Revisión

## Resultados de las verificaciones
- `npx tsc --noEmit` (backend): sin errores.
- `npx eslint` sobre los 9 archivos tocados del backend: 0 errores, 6 warnings "Unused eslint-disable directive" (ya venían del header de `runtime-env.spec.ts` y `logging.interceptor.spec.ts`; no son nuevos).
- `npm test` (backend): 32 suites, 563 tests, verde (el stack trace que se ve en la salida es el 500 deliberado de `access-log.spec.ts`).
- `scripts\dev-lib.tests.ps1`: 1026 OK, 0 fallidos.
- `git diff -- scripts/dev-lib.tests.ps1`: 15 líneas agregadas y 1 eliminada. La línea eliminada es la aserción "conserva NODE_TLS" del caso 3. Ningún otro test se perdió.

## Cumplimiento de la spec
1. Línea de acceso: correcta.
   - `app.use(createAccessLogMiddleware())` va antes de `configureBodyParser` (bootstrap.ts), incluso antes del CORS.
   - Una sola línea por request vía `finish`. Nivel `log` para 2xx y 3xx, `warn` desde 400.
   - El `LoggingInterceptor` quedó solo con el debug redactado. Su spec verifica que la línea aparece una sola vez.
   - El spec de acceso usa una app Nest real y cubre 200, 401, 403, 404, 413, 400 y 500.
2. Sin datos sensibles: solo método, ruta sin query ni fragmento (tope de 200 caracteres), status y ms. Hay test de no filtración.
3. Límite: `parseBodySizeLimit` es correcto.
   - Formato `<num>[b|kb|mb]`, default 1mb, máximo 10mb, inválido o 0 lanza con mensaje claro.
   - Se aplica a `json` y a `urlencoded`.
   - `bodyParserErrorHandler` usa `ErrorResponse`/`MessageError`, sin details, sin stack y sin el límite.
4. TLS:
   - `assertTlsVerificationEnabled` cubre `0`, espacios y comillas. Se llama primero en `bootstrap()`.
   - `dotenv/config` se importa al inicio de `src/api/main.ts`, así que también ve el valor que venga de `backend/.env`.
   - `Sync-BackendEnv` quita la clave una sola vez y avisa sin valor.
   - El caso 3 y el caso nuevo (segunda corrida sin cambios ni aviso) están bien.
5. `.env.example` y `backend/.env.example`: documentados.
6. Tests: presentes y adecuados.

## Hallazgos
No hay bloqueantes ni mayores.

### Menores
- **m-1** `backend/src/infrastructure.bootstrap/config/app/body-parser-config.ts` (`bodyParserErrorHandler`, ~línea 62).
  - Solo captura status 400 o 413.
  - body-parser también devuelve 415 (`encoding.unsupported`, `charset.unsupported`) con las mismas familias de `type`.
  - Ese caso cae a `next(err)`, y Express responde con su página HTML por defecto, que fuera de producción incluye el stack.
  - Sugerencia: agregar `415: ['unsupported-media-type', ...]` a `GENERIC_BODY_ERRORS` y aceptar 415 en la condición, con un test (`Content-Encoding: foo`).
  - El log de acceso sí registra el request.
- **m-2** `body-parser-config.ts`, `urlencoded`: el límite pasa de 100kb (default de Nest) a 1mb. Es consistente con la spec ("lo mismo vale para urlencoded"), pero relaja ese parser. El frontend no usa urlencoded, y la API solo recibe JSON.
  - Sugerencia: mantenerlo, o fijar `urlencoded` en `min(limit, 100kb)`.
  - Se deja la decisión al PO. No bloquea.
- **m-3** `docs/auditoria/COMANDOS.md` ~línea 335 todavía dice "default 50mb". Queda para el documentador, como indica la implementación.

### Sugerencias
- **s-1** `access-log.ts`: cada preflight `OPTIONS` y cada `GET /health/liveness` (healthcheck de Docker) generan una línea. Esto cumple "todo request" de la spec.
  - Si el volumen molesta, se puede bajar a `debug` o excluir `/health/liveness`. Es una decisión de otro feature.
- **s-2** `access-log.ts`: una conexión abortada antes de `finish` no deja línea. La spec lo pide así. Se podría escuchar también `close` sin `finish` para registrar abortos, si se quiere auditar.
- **s-3** El modo Docker no pasa `BODY_SIZE_LIMIT` (queda en 1mb). `.env.example` lo aclara bien.

## Convenciones
Código en inglés y comentarios en español. Errores de arranque como `Error` (fuera de capa HTTP, coherente con otras validaciones del bootstrap). Prettier OK. No hay cambios de schema ni de endpoints, así que no aplica `org-isolation`.

Veredicto previo (revisión inicial): APROBADO. Sin bloqueantes ni mayores; menores m-1 a m-3.

## Re-revisión (vuelta 1)

### Verificaciones
- `npx tsc --noEmit` (backend): sin errores.
- `npx eslint` sobre `access-log.ts`, `access-log.spec.ts` y `body-parser-config.ts`: sin salida (0 errores, 0 warnings).
- `npm test` (backend): 32 suites, 567 tests, verde (4 más que antes, los de la vuelta).

### Resultado por punto
- **m-1 / B-2 (415): resuelto.** `GENERIC_BODY_ERRORS` incluye `415: unsupported-media-type` con mensaje genérico. La condición usa `status in GENERIC_BODY_ERRORS`, así que cubre 400, 413 y 415. La familia de `type` (`entity.`, `encoding.`, `request.`, `charset.`) alcanza para los 415 de body-parser. Sin stack, sin detalles y sin eco del valor recibido. Dos tests HTTP (`Content-Encoding: foo` y `charset=utf-32`) comprueban status, `code`, ausencia de stack y del valor, y la línea de acceso warn con 415.
- **B-1 (log injection): resuelto.** `neutralizeUnsafeChars` usa `/[^!-~]/g`, que deja solo ASCII imprimible sin espacio. Cubre CR/LF, controles, 0x7F, 0x85, U+2028 y espacios. Se aplica a la ruta y al método (acotado a 16). El reemplazo es 1 a 1, por lo que el orden "acotar y luego neutralizar" es correcto y el largo máximo se mantiene. Tests unitarios con 0x85, controles, espacios y método.
- Orden y alcance: no hay regresiones en los demás tests ni cambios de comportamiento fuera de lo pedido.

### Hallazgos nuevos
Ninguno bloqueante ni mayor.
- **Menor (informativo):** m-2 y m-3 de la revisión inicial siguen abiertos (decisión del PO sobre `urlencoded` y corrección de `COMANDOS.md` por el documentador). No bloquean.
- **Sugerencia:** los tests de `?` sustituyen también los `%xx` no; las rutas con percent-encoding se registran tal cual (seguro, ASCII). Sin acción.

VEREDICTO: APROBADO
