# 013 — Implementación: errores sin `details`, códigos HTTP correctos y mensajes claros

Desarrollador. Se siguió `03-diseno-tecnico.md` y las 9 decisiones del PO de `00-estado.md`. No hay commit ni push.
El 012 ya estaba commiteado (052a01e): su 429 entra en el contrato y su `throw new Error` de configuración
(`login-rate-limit-config.ts`) está en la lista blanca.

## Qué se hizo por paso del plan

1. **Contrato puro.** `filters/error-contract.ts` con `GENERIC_ERRORS`, `API_ERROR_CODE`, `mapException`,
   `isPrismaError`, `describeForLog` y `formatErrorLogLine`; spec de tabla `error-contract.spec.ts`.
2. **Filtros.** `FilterBase` pasó a un `catch` único que llama a `respondWithError` (mapeo, log seguro,
   `X-Error-Id` en 5xx, `headersSent`). `HttpFilter` y `GlobalFilter` quedaron solo con `@Catch` y constructor.
   `ErrorResponse` sin `details` ni `isErrorResponse`. Se borró `axios-filter.ts` (con `git rm`, queda staged como
   borrado), `AxiosFilterProvider` y su registro en `app-module.ts`.
3. **Body parser y manejador final.** `body-parser-config.ts` usa `GENERIC_ERRORS` (mismos textos que antes).
   Nuevo `filters/final-error-handler.ts` (`finalErrorHandler`), registrado en `bootstrap.ts` con
   `await app.init(); app.use(finalErrorHandler); await app.listen(...)`.
4. **Log seguro.** Los 5xx escriben una línea `error id=<uuid> <METHOD> <ruta> <status> <descripción>` con
   `logError`; para Prisma solo clase y `prisma=<código>`. El `stack` de errores no Prisma va por `logDebug`. Los 4xx
   solo escriben `logDebug` con método, ruta, status y code. Se quitó el `Logger.error` duplicado de `dispatcher.ts` y
   el `try/catch` que logueaba el mensaje de Prisma en `update-organization-command.ts` (con su import de `Logger`).
5. **Negocio.** Ver tabla de abajo y la de mensajes explícitos.
6. **Invariantes y tests existentes.** Sección "013" en `security-invariants.spec.ts`; el helper `call` de
   `org-isolation.spec.ts` ahora es `async` y verifica el contrato en toda respuesta >= 400; reforzado
   `logging.interceptor.spec.ts`.
7. **Backend:** tsc, ESLint sobre archivos tocados y `npm test` (resultados abajo).
8. **Frontend:** `constants.ts`, `api-errors.ts`, `api-errors.test.mts` (agregado al script `test`), `data.ts`,
   componentes. tsc, eslint, `npm test`, `npm run build`.

## Contrato final

`{ code: string, errors: [{ message: string }] }`, sin `details`, en ningún entorno. Reglas (`mapException`):

| Caso | Status | `code` | Mensaje |
|---|---|---|---|
| `HttpException` 5xx o < 400 | 5xx (o 500) | `code` explícito o `unhandled-exception` | Genérico del 500. Interno: log + `X-Error-Id` |
| 401, 403, 404 | igual | `code` explícito o `unauthorized`/`forbidden`/`not-found` | Siempre el genérico del status |
| 400 con `body.message` array (ValidationPipe) | 400 | `validation-failed` | Hasta 20 mensajes de class-validator, 200 caracteres c/u |
| Otros 4xx | igual | `code` explícito, el del status o `request-error` | `message` solo si hay `code` explícito (hasta 300); si no, el genérico |
| Error con `status`/`statusCode` 4xx y `expose === true` (http-errors) | ese status | el del status | Genérico, nunca `err.message` |
| Todo lo demás (Prisma, `Error`, valores no Error) | 500 | `unhandled-exception` | Genérico del 500. Interno |

Genéricos en español (`GENERIC_ERRORS`): 400 "La solicitud no es válida.", 401 "No autorizado.", 403 "No tenés permiso
para realizar esta acción.", 404 "No se encontró el recurso.", 409, 413, 415, 429, 500 "Ocurrió un error en la
aplicación. Por favor, intentá más tarde.". `mapException` y el log nunca lanzan.

## `throw new Error` de negocio reemplazados

| Lugar | Antes | Ahora |
|---|---|---|
| `staff-commands.ts` CUIT duplicado | `Error` (500) | `ConflictException({ code: 'conflict', message })` (409) |
| `activity.service.ts` regla de primera carga | `Error` (500) | `BadRequestException({ code: 'first-load-required', message })` (400); texto pasado a voseo |
| `activity.service.ts` falta `professionalId` | `Error` (500) | `BadRequestException({ code: 'bad-request', message: 'Falta el profesional de la atención.' })`; dentro del `$transaction`, hace rollback |
| `fee-resolution.service.ts` organización no encontrada | `Error` con el id | `InternalServerErrorException('Organización no encontrada al calcular la distribución')` (500 genérico, sin id) |
| `dispatcher.ts` "Handler not found" | `Error` + log duplicado | Queda `Error` (lista blanca); el filtro lo registra una vez |

Excepciones con string suelto pasadas a `{ code, message }` en español (para que el mensaje llegue al cliente):
`login-query-handler.ts` (`bad-request`), `activity-type-commands.ts` (tope de roles x2, rol FIXED sin porcentaje, y
borrar con registros asociados que pasó de 400 a `ConflictException` 409 `conflict`), `payer-commands.ts` (CUIT de una
organización), `fee-rule-splits.ts`, `merge-patient-command.ts` (x2), `delete-activity-command.ts`
(`{ code: 'forbidden', message }`; el cliente recibe el genérico del 403 por regla).

Búsqueda de faltantes: `grep "new Error("` sobre `src/` sin specs deja solo arranque/configuración y `dispatcher`;
no se encontraron otros `throw new Error` de negocio.

## Archivos

**Creados (backend):** `filters/error-contract.ts`, `filters/final-error-handler.ts`, `filters/error-contract.spec.ts`,
`filters/error-filters.spec.ts`, `filters/final-error-handler.spec.ts`,
`infrastructure/features/fee-engine/fee-resolution.service.spec.ts`.
**Creados (frontend):** `src/lib/api-errors.ts`, `src/lib/api-errors.test.mts`.
**Eliminado:** `backend/src/infrastructure.bootstrap/filters/axios-filter.ts` (código muerto).
**Modificados (backend):** `filter-base.ts`, `http-filter.ts`, `global-filter.ts`, `filter-provider.ts`,
`app-module.ts`, `bootstrap.ts`, `body-parser-config.ts`, `error-response.ts`, `dispatcher.ts`,
`update-organization-command.ts`, `staff-commands.ts`, `activity.service.ts`, `fee-resolution.service.ts`,
`login-query-handler.ts`, `activity-type-commands.ts`, `payer-commands.ts`, `fee-rule-splits.ts`,
`merge-patient-command.ts`, `delete-activity-command.ts`; specs: `config-handlers.spec.ts`,
`fee-rule-splits.spec.ts`, `activity.service.spec.ts`, `guard-chain.spec.ts`, `logging.interceptor.spec.ts`,
`access-log.spec.ts`, `security-invariants.spec.ts`, `test/org-isolation.spec.ts`.
**Modificados (frontend):** `package.json` (script `test`), `src/lib/constants.ts`, `src/services/data.ts`,
`org/profesionales/page.tsx`, `settings/general/page.tsx`, `ProfessionalManager.tsx`, `PayerRulesManager.tsx`,
`PatientDirectory.tsx`, `AdmisionesTable.tsx`, `AtencionesTable.tsx`, `WorkItemForm.tsx`, `ActivityTypesManager.tsx`.
No se tocaron `scripts/`, `.claude/`, `.vscode/`, `frontend/AGENTS.md` ni los 4 archivos del backend que solo difieren
por EOL.

## Cambios del frontend

- `API_ERROR_MESSAGES` y `API_ERROR_CODE` ampliado (`NOT_FOUND`, `VALIDATION_FAILED`, `INTERNAL`) en `constants.ts`.
- `api-errors.ts`: `ApiRequestError`, `messageFromErrorBody` (5xx -> `server`; 404 -> `notFound`; `validation-failed`
  -> `validation`; 4xx con `errors[0].message` -> ese texto hasta 300; si no, genérico por status), `toApiError`,
  `errorMessageOf`. Ignora `details` y el `message` de nivel superior; nunca muestra JSON ni `res.text()`.
- `data.ts`: todas las ramas `!res.ok` que lanzaban `Error` ahora hacen `throw await toApiError(res)` (23 de una línea,
  5 con `res.text()`, 3 de tipos de actividad, `createWorkItem` sin la rama de `details` y `updateOrgSettings` sin la
  comparación con `unhandled-exception`; `getDashboardStats` usa la respuesta que falló). No cambian `apiFetch`,
  `readErrorCode`, `login`, `rethrowServerAuthError`, `ApiForbiddenError`, `ApiUnauthorizedError` ni
  `isHandledApiError`. Las funciones que devuelven un default (`null`/`[]`) siguen igual.
- Componentes: los de §4.4 pasan a `errorMessageOf(e, <literal actual>)`. En `org/profesionales/page.tsx` se quitó la
  heurística `includes('Foreign key'...)` y la concatenación de `e.message`. En `AdmisionesTable.tsx` se quitó la rama
  `e?.response?.data`.
- Se reescribió un comentario de `data.ts` ("Fetches Organization details" -> "the Organization record") para que la
  prueba estática que prohíbe la palabra `details` en el archivo no falle.

## Tests agregados o ajustados

- **Nuevos (Jest):** `error-contract.spec.ts` (tabla de §7.1: 400 con tope de 20/200, 401/403/404 genéricos con 404
  idénticos, 409, 429, 5xx, Prisma sin valores, http-errors, objeto hostil, saneamiento del log);
  `error-filters.spec.ts` (HTTP real con filtros, `configurePipes`, guards y body parser: 400 validación, 401, 403, 404
  de recurso y de ruta iguales, 409, 413, 429, 500 de Prisma con `X-Error-Id` UUID y log sin valores, 500 de `Error`,
  4xx sin `X-Error-Id`, I-4 con middleware que hace `next(err)` sin `type`, B-1 con la base fallando en el guard);
  `final-error-handler.spec.ts` (unitario, `headersSent`, Express sin Nest, nunca HTML);
  `fee-resolution.service.spec.ts`; en `config-handlers.spec.ts` el CUIT duplicado da 409; en `activity.service.spec.ts`
  la primera carga (400 `first-load-required`, sin abrir la transacción) y la falta de profesional (400);
  invariantes 013 en `security-invariants.spec.ts` (lista blanca de `new Error(`, sin string suelto en
  `BadRequest/Conflict/UnprocessableEntityException`, sin `JSON.stringify(exception`, sin axios-filter, claves de
  `ErrorResponse`).
- **Ajustados sin debilitar:** `guard-chain.spec.ts` (401 genérico "No autorizado."), `org-isolation.spec.ts` (404
  genérico "No se encontró el recurso." y el helper `call` valida el contrato en todo >= 400),
  `config-handlers.spec.ts` (borrar prestación con usos pasa de 400 a 409 `conflict`), `fee-rule-splits.spec.ts` (texto
  en español), `access-log.spec.ts` (conjunto de claves `['code','errors']` y `unhandled-exception` en el 500),
  `logging.interceptor.spec.ts` (además de `unhandled-exception"`, que no aparezcan `"errors":` ni `"code":`).
- **Nuevos (frontend):** `api-errors.test.mts` (11 tests: extracción, 5xx/404/validación, cuerpos inválidos, recorte,
  `details` ignorado, `toApiError` con JSON y no JSON, `errorMessageOf`, y la prueba estática sobre `data.ts`).

## Resultados de calidad

- Backend: `npx tsc --noEmit` sin errores. `npm test` (Jest): 39 suites, 682 tests, todo en verde (antes de este
  feature: 35 suites, 408 tests).
- Backend ESLint (sin `--fix`) sobre los archivos tocados: 0 errores en los archivos nuevos y en `filters/`. En los
  archivos modificados quedan errores y avisos que ya existían (reglas `no-unsafe-*` por el `any` de Prisma, prettier
  por EOL CRLF del repo en archivos viejos, `no-unused-vars` de DTOs importados); no agregué ninguno. Se corrió
  `prettier --write` solo sobre `filters/*.ts` y el spec nuevo de fee-resolution.
- Frontend: `npx tsc --noEmit` sin errores. `npm test`: 53 tests, 0 fallas. `npm run build` OK (con
  `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`). ESLint de los archivos tocados: solo reglas que ya fallaban
  (`no-explicit-any`, `react-hooks/set-state-in-effect`, etc.); no hay reglas nuevas ni imports sin uso, y se
  eliminaron algunos `any`.

## Desvíos del diseño

1. **Código de 400 dentro de `GENERIC_ERRORS`:** el 400 genérico usa `bad-request` (igual que el body parser actual).
   Sin desvío funcional. `API_ERROR_CODE` quedó en `error-contract.ts`, con `UNHANDLED` y `REQUEST_ERROR` además de
   los cuatro previstos.
2. **Reglas 5 del diseño ampliadas con un caso inofensivo:** no se agregó una rama aparte para `http-errors` 5xx; caen
   en la regla 6 (500 genérico), que da el mismo resultado.
3. **Log de stack:** se emite como una segunda línea `logDebug` (`error id=<uuid> stack: ...`) porque `Logger.logError`
   ignora el `stack`. Solo en desarrollo y solo si el error no es de Prisma.
4. **`ErrorLogSink`:** `respondWithError` en `filter-base.ts` recibe un destino mínimo `{ error, debug }` para que lo
   usen el filtro (con `ILogger`) y el manejador final (con el `Logger` de Nest). No estaba en el diseño tal cual, pero
   respeta su intención (un solo camino de mapeo y log).
5. **Mensajes con voseo:** además del de primera carga, el CUIT duplicado quedó con tilde ("organización").

## Pendientes y dudas para el PO

- **Prisma P2002/P2003 como 409** y **403 de "atención cobrada" como 409:** siguen en BACKLOG, como se decidió.
- **`axios` y `@nestjs/axios`:** siguen en `package.json` sin uso (BACKLOG o 020).
- **Mensajes de validación en inglés** (class-validator): el frontend muestra el genérico en español. Un detalle más
  útil por campo queda para una mejora futura.
- **Documentador:** actualizar `CLAUDE.md` (convención `new XException({ code, message })`, genéricos 401/403/404,
  500 `unhandled-exception` con `X-Error-Id`, invariante de `new Error(`), BACKLOG #13, #42, #53 y la nota de I-4,
  RIESGOS B-2 y COMANDOS si menciona la forma del error.
- `git rm` dejó el borrado de `axios-filter.ts` staged; no hay otro cambio staged. Si se prefiere sin stage, el
  caller puede hacer `git restore --staged` de ese archivo (no lo hice).
- Hay una carpeta `docs/features/014-validation-whitelist/` sin seguimiento que no creé yo.

## Cómo probarlo

- Backend: `cd backend; npx tsc --noEmit; npx jest` (en particular `src/infrastructure.bootstrap/filters`,
  `src/security-invariants.spec.ts`, `test/org-isolation.spec.ts`).
- Frontend: `cd frontend; npx tsc --noEmit; npm test; npm run build`.
- En vivo (tester, sin escrituras): los pasos de `03-diseno-tecnico.md` §7.3.

## Notas

- **Revisor:** revisar el orden en `bootstrap.ts` (`app.init()` antes de `app.use(finalErrorHandler)`; lo cubre el spec
  del manejador final con la misma secuencia). Los 4xx dejaron de escribir `console.error` (ahora debug); la línea de
  acceso del 010 sigue registrando el status.
- **Seguridad:** verificar que ningún body 4xx/5xx lleve datos de Prisma, `details` o la ruta; que 401/403/404 usen
  siempre el texto genérico; que `X-Error-Id` salga solo en 5xx y no derive de datos del request; que el log de un
  error de Prisma sea solo clase y código (`describeForLog`), y que el mensaje de otros `Error` se recorte a 200 y
  se le neutralicen controles y separadores de línea. `X-Error-Id` no está en `CORS_EXPOSED_HEADERS`.
- **Tester:** el paso del 500 en vivo (`GET /api/activity?startDate=no-es-fecha...`) debe responder 500 con
  `unhandled-exception`, header `X-Error-Id` y body sin `Prisma`/`Invalid`/`clientVersion`/id de organización.
  El 400 de validación del login (`{ "user": 123, ... }`) puede devolver otros mensajes de class-validator si
  `enableImplicitConversion` convierte el 123 a texto: usar un valor ausente o un objeto para forzar el error.

## Vuelta de corrección 1

Corregidos M-2/B-1, M-8, M-1 y M-3. Sin tocar M-4, M-5, M-6 ni M-7.

- **M-2 / B-1:** `backend/src/application/features/config/commands/activity-type-commands.ts`: el 400 de rol con porcentaje fijo sin porcentaje ya no interpola `roleLabel`; mensaje fijo "Un rol con porcentaje fijo no tiene porcentaje definido." y `code: 'bad-request'` intacto. Ningún test verificaba el texto anterior.
- **M-8:** `frontend/src/components/domain/pro/atenciones/AtencionesTable.tsx`: `handleSave` ya no muestra toast; solo relanza. `WorkItemForm` (catch ~línea 452) es el único que avisa (y omite el aviso si `isHandledApiError`). AdmisionesTable y PacientesTable no tenían toast propio, así que en los 3 usos el error se muestra exactamente una vez. Se quitó el import `errorMessageOf` que quedó sin uso.
- **M-1:** `error-filters.spec.ts` (se quitó `unbound-method` de la directiva) y `final-error-handler.spec.ts` (queda solo `no-unsafe-argument, unbound-method`). Verificado con `--report-unused-disable-directives`: sin hallazgos en `filters/*.spec.ts`.
- **M-3:** no se reutiliza `neutralizeUnsafeChars` en el mensaje de `describeForLog` (reemplaza también los espacios y dejaría el texto ilegible); se agregó un comentario en `error-contract.ts` que lo explica.

Resultados: backend `tsc --noEmit` OK; `npm test` 39 suites / 682 tests OK; eslint (con unused-directives) sobre `filters/*.spec.ts` y `error-contract.ts` limpio. Frontend `tsc --noEmit` OK; `npm test` 53/53 OK; `npm run build` OK. Nota: eslint sobre `activity-type-commands.ts` y `AtencionesTable.tsx` reporta errores preexistentes (prettier, `no-explicit-any`, unsafe-*) ajenos a estas líneas; no se reformateó para no salir del alcance.
