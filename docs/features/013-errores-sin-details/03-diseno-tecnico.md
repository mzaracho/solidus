# 013 — Diseño técnico: errores sin `details`, códigos HTTP correctos y mensajes claros

Autor: arquitecto. Alcance acotado, según `01-spec.md`. Supuesto de partida: el 012 (rate limiting del login) ya está
commiteado cuando arranca el 013. Hoy el 012 está en curso en el árbol de trabajo: agrega un 429 con
`HttpException({ code: 'too-many-requests', message })` en `auth-controller.ts`, `login-rate-limit-config.ts` (con un
`throw new Error` de arranque), `SESSION_MESSAGES.rateLimited*`, `parseRetryAfterSeconds` en `session.ts`, el estado
`rate-limited` en `login()` y un test nuevo en `package.json`. Este diseño no toca nada de eso, salvo agregar
el archivo de configuración a la lista blanca del invariante (§3.3).

## 0. Enfoque elegido y alternativas descartadas

**Elegido:**
- un **módulo puro de mapeo**, `filters/error-contract.ts`. Recibe cualquier excepción y devuelve el status, el
  `ErrorResponse` y una descripción para el log, segura y sin valores;
- `HttpFilter`, `GlobalFilter`, el manejador final de Express y `bodyParserErrorHandler` lo usan todos, así que
  producen el mismo contrato;
- los mensajes llegan al cliente **solo si son explícitos**: 4xx con `{ code, message }`, como ya hacen los
  401/403/404 del 005/007 y el 429 del 012. El resto lleva un genérico en español según el status.

**Descartadas:**
- **Pasar siempre `exception.message` en los 4xx:** no se puede distinguir un mensaje de negocio de uno interno de
  Nest, porque los dos tienen la misma forma de body:
  - `Cannot GET /api/...` de la ruta inexistente;
  - `Failed to decode param '...'` del `URIError`;
  - `Bad Request Exception` de `ValidationPipe`.
- **Un `try/catch` por handler o un `ServiceUnavailableException` en el guard:** son más puntos que mantener, y el
  filtro global ya garantiza el genérico.
- **Mapear los errores de Prisma P2002/P2003 a 409:** sería útil, pero amplía el alcance y abre la discusión de
  enumeración por unicidad global (`User.email`, `Organization.cuit`). Va al BACKLOG (§10, punto 5).
- **Un filtro único nuevo que reemplace a los dos actuales:** se mantienen los nombres `HttpFilter` y `GlobalFilter`,
  porque los registran `test/helpers/login-app.ts`, `guard-chain.spec.ts` y `access-log.spec.ts`. Así hay menos
  cambios, y el 012 también usa `login-app.ts`.
- **Devolver el identificador de correlación en el body:** cambiaría el contrato `{ code, errors }`. Va en un header
  (§2.5).

## 1. Relevamiento

### 1.1 Puntos que producen respuestas de error

| # | Punto | Qué responde hoy | Problema |
|---|---|---|---|
| P1 | `filters/http-filter.ts`, para todo `HttpException` | `{ code: <code explícito> o 'unhandled-exception', details: JSON.stringify(exception), errors: [{ message: exception.message }] }` | `details` con la excepción serializada (`response`, `status`, `options`). En un 400 de `ValidationPipe`, `message` es `Bad Request Exception` y los mensajes útiles solo van en `details`. El 404 de ruta inexistente lleva `Cannot GET <ruta>` y el código `unhandled-exception` |
| P2 | `filters/global-filter.ts`, `@Catch()` del resto | 500 con `details: JSON.stringify(exception)` | Con Prisma: `code`, `meta`, `clientVersion` y valores |
| P3 | `filters/axios-filter.ts` | `details` y `JSON.parse` sobre datos externos | Es código muerto: ningún `src/` usa axios ni `@nestjs/axios` (lo confirma `docs/auditoria/ARQUITECTURA.md` §6) |
| P4 | `filters/filter-base.ts` | Loguea `exception.message`, o `JSON.stringify(exception)` si no es un `Error`, y pasa `stack` | El mensaje de Prisma trae la consulta con valores. `Logger.logError` hoy ignora `stack` |
| P5 | Guards (`authentication-guard.ts`, `org-access-guard.ts`, `org-role-guard.ts`, `view-mode-guard.ts`) | `{ code, message: 'Unauthorized' / 'Forbidden' }` | Bien, salvo `details`. Si la base falla en `prisma.user.findUnique` (B-1 del 006), el error de Prisma llega a P2 con detalle |
| P6 | `org-resource.ts` (`resourceNotFound`, `forbiddenAction`) | `{ code: 'not-found' / 'forbidden', message: 'Not Found' / 'Forbidden' }` | Solo `details` |
| P7 | `ValidationPipe` (`pipes-config.ts`) | `BadRequestException` con body `{ message: string[], error, statusCode }` | P1 lo reduce a `Bad Request Exception` |
| P8 | `body-parser-config.ts`, `bodyParserErrorHandler` | 400/413/415 con `ErrorResponse` sin `details` | Correcto. Otros status, o errores sin `type`, se delegan con `next(err)` (§1.2) |
| P9 | Handler de error que Nest registra al hacer `init()` (`RoutesResolver.registerExceptionHandler`) | Pasa a los `APP_FILTER` todo error que llegue por `next(err)` desde un middleware. Convierte `SyntaxError` y `URIError` en `BadRequestException(err.message)` | §1.2 |
| P10 | Ruta inexistente (`registerNotFoundHandler` de Nest) | `NotFoundException('Cannot <METHOD> <url>')`, que va a P1 | Código `unhandled-exception`, mensaje con la ruta |
| P11 | `dispatcher.ts:32` | `throw new Error('Handler not found for X')`, que va a P2 | Es un error interno, así que el 500 es correcto. Hoy se loguea dos veces y lleva `details` |
| P12 | Los `throw new Error` de negocio (§3.1) | 500 vía P2 | El status es incorrecto |
| P13 | Excepciones con string suelto en handlers (§3.2) | El mensaje pasa tal cual, a veces en inglés | Hay que hacerlas explícitas |
| P14 | `update-organization-command.ts:68` | `catch` que loguea `error.message` de Prisma y relanza | El log incluye `name`, `cuit` y `address` del `data` |
| P15 | 429 del 012 (`auth-controller.ts`) | `HttpException({ code: 'too-many-requests', message: <español> })` | Ya cumple el contrato. Solo le sobra `details` |

### 1.2 Sobre la premisa de I-4 (manejador final)
Se probó con una app Nest mínima, fuera del repo: un middleware hace `next(err)` con `status: 502` y sin `type`. El
error **no** llega al handler por defecto de Express. Lo toma el handler de error que Nest registra en `init()`, después
de las rutas, y lo entrega a los `APP_FILTER`: con el `GlobalFilter` del repo, sería un 500 con `details`.

Por lo tanto:
- **El riesgo real de I-4** es que esos errores terminan en `GlobalFilter` con `details`. Lo resuelve el contrato nuevo.
- **El handler por defecto de Express** solo se alcanzaría si se registrara algo después del handler de Nest, o si
  faltara ese handler.
- **Igual se agrega un manejador final de Express** como defensa en profundidad (criterio 6), registrado después de
  `app.init()` (§2.8). El test de I-4 verifica el camino real: middleware, `next(err)` y contrato genérico.

### 1.3 Consumidores del formato de error

**Frontend:**

| Lugar | Uso actual |
|---|---|
| `data.ts` `createWorkItem` (397-412) | `errors[0].message`, luego `message` de nivel superior, luego **`JSON.parse(details).message`**. Salta el body si es 404 |
| `data.ts` `updateOrgSettings` (785-800) | Si `code === 'unhandled-exception'`, muestra un texto fijo. Si no, `errorData.message`, `JSON.stringify(errorData)` o `res.text()` (JSON crudo) |
| `data.ts` `updateProfessionalProfile`, `createPayer`, `deleteStaff`, `updateWorkItem`, `deleteWorkItem` | `` `Failed to ...: ${await res.text()}` `` (#42) |
| `data.ts` `create/update/deleteActivityType` | `err.message` de nivel superior, que no existe en `ErrorResponse`: siempre cae al texto por defecto y nunca muestra el mensaje de negocio |
| `data.ts`, unas 25 funciones más | `throw new Error('Failed to ...')` en inglés. Algunas atrapan el error y devuelven un default |
| `data.ts` `apiFetch` / `readErrorCode` | Solo `code` en el 403 (`org-access-denied`). El 401 se decide por status. **No cambia** |
| `data.ts` `login` | Solo status (más 429 y `Retry-After` del 012). **No cambia** |
| `org/profesionales/page.tsx:192-195` | `e.message.includes('Foreign key' / 'constraint' / 'work items')`: depende del texto crudo. Además concatena `e.message` |
| `AdmisionesTable.tsx:182` | `e?.response?.data?.errors?.[0]?.message`, un resto de axios que nunca existe |
| `AtencionesTable.tsx:145`, `WorkItemForm.tsx:456`, `ActivityTypesManager.tsx:208,225`, `settings/general/page.tsx:98` | `error.message \|\| fallback` |
| `providers.tsx:50` | Toast fijo `SESSION_MESSAGES.forbiddenAction`. **No cambia** |

Ningún otro lugar del frontend lee `details`: el grep encontró solo `createWorkItem`. Los `details` de
`ProfessionalPayouts.tsx` y de `calculate-settlements-query.ts` son datos de negocio, no errores.

**Tests del backend que dependen de la forma:**
- `guard-chain.spec.ts:200`: `errors` igual a `[{ message: 'Unauthorized' }]`. **Cambia**: pasa a ser el genérico en
  español.
- `logging.interceptor.spec.ts:116`: `not.toContain('unhandled-exception"')`. Ese 400 pasará a
  `validation-failed`, así que la aserción quedaría vacía. **Se refuerza**: que no aparezcan `"errors":` ni `"code":`.
- `access-log.spec.ts:178/193/205/219/229`: códigos de 413/400/415 y status 500. Siguen igual. Se agrega la aserción del
  conjunto de claves.
- `login.spec.ts`, `org-isolation.spec.ts`, `all-routes-auth.spec.ts` y el `login-rate-limit.spec.ts` del 012 verifican
  `body.code` y status. Siguen igual.
- Specs unitarios (`org-resource.spec`, `authentication-guard.spec`, `org-access-guard.spec`, `org-role-guard.spec`,
  `request-context.spec`, `config-handlers.spec:641`, `activity.service.spec:288`) verifican `getResponse()` de la
  excepción (`message: 'Forbidden'` y similares). **No cambian**, porque los productores no se tocan (§2.2).
- `activity-handlers.spec.ts:383`: `e.message` contiene `cobrada`. Sigue igual (§3.2).
- Ningún test espera un 500 en los casos de §3.1: no hay tests de esas reglas, así que se agregan.

## 2. Contrato final

### 2.1 `ErrorResponse` (`domain/seed-work/error-response.ts`)
- Queda `{ code: string; errors: MessageError[] }`. Se quita `details`: el campo, el parámetro del constructor y
  `@ApiPropertyOptional`.
- Se borra `isErrorResponse`, que solo usa `axios-filter.ts`.
- **No hay `details` en ningún entorno:** sin excepción fuera de producción.
- **Headers:** en los 5xx, además, `X-Error-Id` (§2.5).

### 2.2 Reglas de mapeo (`mapException`, en orden)
`curatedCode` es el `code` del body de la excepción si es un string que cumple `^[a-z][a-z-]{0,40}$`, la regla actual
de `HttpFilter.resolveCode`.

1. **`HttpException` con status ≥ 500, o menor que 400:**
   - status: el de la excepción si es 5xx; si no, 500;
   - `code`: `curatedCode`, o `unhandled-exception` si no hay;
   - mensaje: siempre el genérico del 500;
   - se trata como interno: log de error y `X-Error-Id`.
2. **401, 403 y 404:**
   - `code`: `curatedCode`, o el del status (`unauthorized`, `forbidden`, `not-found`);
   - mensaje: **siempre el genérico del status**, aunque la excepción traiga otro;
   - así el 404 de ruta inexistente, el de id inválido y el de recurso ajeno dan el **mismo body** (refuerza el 007), y
     el 401 de login es igual al del guard.
   - Los productores (guards, `org-resource.ts`, login) **no cambian**: su `message` (`'Forbidden'` y similares) queda
     como texto interno.
3. **400 de `ValidationPipe`** (status 400 y `body.message` es un array):
   - `code: 'validation-failed'`;
   - `errors`: un elemento por mensaje de class-validator, solo los strings, como máximo 20, cada uno recortado a 200
     caracteres;
   - si el array queda vacío, el genérico del 400.
4. **Otros 4xx** (400, 409, 413, 415, 422, 429...):
   - `code`: `curatedCode`, el del status de la tabla de §2.3, o `request-error`;
   - mensaje: `body.message` **solo si hay `curatedCode`** y `message` es un string no vacío (recortado a 300). Si no,
     el genérico del status;
   - así pasan los mensajes de negocio explícitos y el 429 del 012, y quedan fuera `Failed to decode param...` y los
     strings sueltos.
5. **Errores que no son `HttpException`, con `status` o `statusCode` entre 400 y 499 y `expose === true`** (es decir,
   `http-errors` del body parser que no tomó P8): ese status, el `code` y el mensaje genéricos de la tabla. **Nunca**
   `err.message`.
6. **Todo lo demás** (Prisma, `Error`, valores que no son `Error`): 500, `unhandled-exception`, mensaje genérico. Se
   trata como interno.
7. **Si el mapeo mismo falla** (`try/catch`): el 500 genérico. El filtro nunca lanza.

### 2.3 Códigos y mensajes genéricos (`GENERIC_ERRORS`, en `error-contract.ts`)

| Status | `code` por defecto | Mensaje genérico |
|---|---|---|
| 400 | `bad-request` | La solicitud no es válida. *(el mismo texto que hoy en el body parser)* |
| 400 (validación) | `validation-failed` | Lista de mensajes de class-validator (§2.4) |
| 401 | `unauthorized` | No autorizado. |
| 403 | `forbidden` (o el explícito: `org-access-denied`, `invalid-mode`) | No tenés permiso para realizar esta acción. |
| 404 | `not-found` | No se encontró el recurso. |
| 409 | `conflict` | La operación no se puede completar por el estado actual de los datos. |
| 413 | `payload-too-large` | El cuerpo de la solicitud es demasiado grande. *(como hoy)* |
| 415 | `unsupported-media-type` | El tipo de contenido o la codificación de la solicitud no están soportados. *(como hoy)* |
| 429 | `too-many-requests` | Demasiadas solicitudes. Probá de nuevo más tarde. *(el 012 trae el suyo explícito)* |
| Otro 4xx | `request-error` | La solicitud no pudo procesarse. |
| 5xx | `unhandled-exception` | Ocurrió un error en la aplicación. Por favor, intentá más tarde. |

- **Código del 500:** se mantiene `unhandled-exception`, la opción que permite la spec. Es el que compara el frontend
  (`updateOrgSettings`).
- **4xx sin código explícito:** cambian de `unhandled-exception` al código del status. El frontend no depende de eso
  en los 4xx (§1.3).
- **`bodyParserErrorHandler`:** deja su tabla `GENERIC_BODY_ERRORS` y usa `GENERIC_ERRORS`. Los textos son los mismos.

### 2.4 Errores de validación
```json
{ "code": "validation-failed", "errors": [{ "message": "user must be a string" }, { "message": "password should not be empty" }] }
```
- **Contenido:** solo los mensajes que arma `ValidationPipe`. Son los textos por defecto de class-validator: nombre de
  la propiedad y restricción, nunca el valor enviado. No se agregan `constraints`, `target`, `value` ni `children`.
- **No se cambia `pipes-config.ts`:** `whitelist` y `forbidNonWhitelisted` quedan para el 014. La detección está en
  el filtro, y por eso también funciona en las apps de test que crean su propio `ValidationPipe`.
- **Idioma:** los mensajes de class-validator están en inglés. La i18n queda fuera de alcance. El frontend no los
  muestra: para `validation-failed` usa un genérico en español (§4).

### 2.5 500 e identificador de correlación
- **Body:** solo `{ code: 'unhandled-exception', errors: [{ message: <genérico del 500> }] }`.
- **Correlación:** por cada 5xx se genera un `crypto.randomUUID()`:
  - va en la línea de log y en el header de respuesta `X-Error-Id`;
  - no deriva de ningún dato del request;
  - no se agrega a `CORS_EXPOSED_HEADERS`, porque hoy el frontend no lo lee. Se ve en devtools o curl, para soporte;
  - no va en el body, para no tocar el contrato.

### 2.6 Logging de errores (en `FilterBase` y el manejador final)
- **5xx**, con `logger.logError`, una línea:
  `error id=<uuid> <METHOD> <ruta sin query> <status> <descripción>`.
  - **Método y ruta:** se sanean con `sanitizeAccessPath` y `neutralizeUnsafeChars` de `access-log.ts`, como en la
    línea de acceso.
  - **Descripción de un error de Prisma:** `isPrismaError` detecta por `instanceof` las clases
    `Prisma.PrismaClient{KnownRequest,UnknownRequest,Validation,Initialization,RustPanic}Error`, y también por nombre
    de clase o por la propiedad `clientVersion`. Se registra solo el nombre de la clase y, si existe, `prisma=<code>`
    (por ejemplo `P2002`). **Nunca** `message`, `meta`, `clientVersion` ni `stack`.
  - **Descripción de otro `Error` o `HttpException`:** `<Nombre>: <message>`. El mensaje se recorta a 200 caracteres y
    se reemplazan los controles y separadores de línea (no los espacios), para evitar inyección en el log.
  - **Descripción de un valor que no es `Error`:** `non-error <typeof>`. Nunca se serializa.
  - **`stack`:** se pasa solo si el error no es de Prisma, con `logDebug`, que no hace nada en producción. Así, en
    desarrollo se puede depurar sin exponer valores de consultas.
- **4xx:** solo `logDebug` con `<METHOD> <ruta> <status> <code>`, sin mensaje: la línea de acceso del 010 ya registra
  el 4xx. Hoy cada 401/403/404 escribe `console.error`, y eso desaparece. `org-isolation.spec` silencia
  `console.error`, y no se rompe nada.
- **`dispatcher.ts`:** se quita el `Logger.error` duplicado. El filtro ya registra el `Handler not found for X`, y ese
  nombre de clase va solo al log.
- **`update-organization-command.ts`:** se quita el `try/catch` que logueaba `error.message` de Prisma. El filtro lo
  registra de forma segura.

### 2.7 Falla de base en el guard (B-1 del 006)
- **Sin cambios en `authentication-guard.ts`:** el error de Prisma sale del guard y la regla 6 lo convierte en 500
  genérico, con el log seguro y `X-Error-Id`.
- **Por qué no 401:** confundiría al frontend, que cerraría la sesión ante una caída de la base.
- **Por qué no 503:** daría otra rama sin beneficio para el frontend, que trata igual todos los 5xx (§10, punto 6).
- **Test:** lo cubre `error-filters.spec.ts` (§7).

### 2.8 Manejador final de Express (I-4 del 010)
- **Archivo:** `filters/final-error-handler.ts`, que exporta `finalErrorHandler(err, req, res, next)`:
  - usa `mapException` y el mismo log que el filtro, con `new Logger('HttpError')` de Nest, que pasa por
    `NestLoggerAdapter`;
  - responde con `res.status(...).json(body)`;
  - si `res.headersSent`, solo hace `res.end()`;
  - nunca escribe HTML ni stack.
- **Registro en `bootstrap.ts`:**
  ```ts
  await app.init();          // registra rutas, el 404 y el handler de error de Nest
  app.use(finalErrorHandler); // queda último en la pila de Express
  await app.listen(...);     // listen no re-inicializa
  ```
  `bodyParserErrorHandler` sigue en su lugar.

### 2.9 `axios-filter.ts`
- **Se elimina** el archivo, `AxiosFilterProvider` (`filter-provider.ts`) y su registro en `app-module.ts`.
- `isErrorResponse` desaparece con el archivo.
- Las dependencias `axios` y `@nestjs/axios` del `package.json` quedan, porque no se tocan dependencias en este
  feature: se propone al BACKLOG (§10, punto 7).

## 3. Errores de negocio

### 3.1 `throw new Error` de negocio que pasan a excepciones de Nest

| Lugar | Hoy | Pasa a | Status y `code` | Mensaje al cliente |
|---|---|---|---|---|
| `application/features/config/commands/staff-commands.ts:83`, CUIT duplicado | `Error`, 500 | `ConflictException({ code: 'conflict', message })` | 409 `conflict` | "Ya existe un profesional con ese CUIT en esta organización." |
| `infrastructure/features/activity/activity.service.ts:175`, regla de primera carga (#53) | `Error`, 500 | `BadRequestException({ code: 'first-load-required', message })` | 400 `first-load-required` | El texto actual: "No puedes cargar una actividad para un paciente que no has atendido previamente. La primera carga debe realizarla la organización." El desarrollador puede pasarlo a voseo |
| `activity.service.ts:257`, falta `professionalId` (dentro del `$transaction`: la excepción hace rollback y se relanza igual) | `Error`, 500 | `BadRequestException({ code: 'bad-request', message })` | 400 `bad-request` | "Falta el profesional de la atención." |
| `infrastructure/features/fee-engine/fee-resolution.service.ts:57`, organización no encontrada | `Error`, 500, con el id en el mensaje | `InternalServerErrorException('Organización no encontrada al calcular la distribución')` | 500 `unhandled-exception` | Genérico. El texto, sin id, va solo al log |
| `infrastructure.bootstrap/config/core/cqrs/dispatcher.ts:32`, "Handler not found" | `Error`, 500 | Queda `Error` (lista blanca) | 500 `unhandled-exception` | Genérico. El nombre de la clase va solo al log |

- **Primera carga, 400 y no 403:** el 403 lo intercepta `apiFetch` con el toast genérico de permisos, y el usuario no
  vería la regla. Con 400, `createWorkItem` muestra el mensaje. Ver §10, punto 1.
- **`fee-resolution`, 500 y no 404:** quien llama (`activity.service.ts:348`) ya verificó la organización. Si falta,
  es una carrera o un bug, no un error del cliente.

### 3.2 Excepciones con string suelto que se vuelven explícitas
Con la regla 4, un string suelto da el genérico del status. Por eso, las que el usuario debe leer pasan a
`{ code, message }`, en español.

| Lugar | Hoy | Queda |
|---|---|---|
| `application/features/auth/login-query-handler.ts:69` | `BadRequestException('User and password are required')` | `{ code: 'bad-request', message: 'Ingresá tu usuario y tu contraseña.' }`. El DTO lo valida antes; esto es defensa |
| `activity-type-commands.ts:77,146` | `At most N roles` | `{ code: 'bad-request', message: 'Una prestación puede tener como máximo N roles.' }` |
| `activity-type-commands.ts:84` | `Role "X" uses FIXED...` | `{ code: 'bad-request', message: 'El rol "X" usa porcentaje fijo y no tiene porcentaje.' }` |
| `activity-type-commands.ts:190` | Texto en español (registros asociados) | El mismo texto, con `code: 'conflict'`, y pasa a `ConflictException` (409) |
| `payer-commands.ts:164` | Texto en español (el CUIT pertenece a una organización) | El mismo texto con `code: 'bad-request'` |
| `fee-engine/fee-rule-splits.ts:28` | `Invalid splits definition` | `{ code: 'bad-request', message: 'La distribución de honorarios no es válida.' }` |
| `patients/commands/merge-patient-command.ts:26` | `Invalid request` | `{ code: 'bad-request', message: 'La solicitud no es válida.' }` |
| `merge-patient-command.ts:32` | `Source and target patients must be different` | `{ code: 'bad-request', message: 'Elegí dos pacientes distintos para combinar.' }` |
| `activity/commands/delete-activity-command.ts:47` (403, atención cobrada) | `ForbiddenException('No se puede eliminar...')` | `{ code: 'forbidden', message: <igual> }`, por uniformidad. Con la regla 2 el cliente recibe el genérico del 403, como hoy en la práctica (el frontend muestra `forbiddenAction`). Su test (`toContain('cobrada')`) sigue verde. Ver §10, punto 2 |

- **Si algún test verifica el texto en inglés,** el desarrollador lo actualiza al nuevo.
- **Las constantes de `code`** nuevas (`conflict`, `bad-request`, `first-load-required`, `validation-failed`) van en
  `error-contract.ts` como `API_ERROR_CODE`, y no se tocan las de `AUTH_ERROR_CODE`.

### 3.3 Lista blanca de `new Error(` e invariante estático
Se agregan a `src/security-invariants.spec.ts`, en una sección "013":
1. **`new Error(` solo en una lista blanca justificada**, sobre todo `src/` sin `*.spec.ts` (`toEqual` exacto, como los
   invariantes existentes). Todos son de arranque o configuración, y nunca son respuestas HTTP, salvo `dispatcher`:

   | Archivo | Motivo |
   |---|---|
   | `infrastructure.bootstrap/config/app/body-parser-config.ts` | `BODY_SIZE_LIMIT` inválido al arrancar |
   | `infrastructure.bootstrap/config/app/cors-config.ts` | `CORS_ORIGIN` inválido o ausente en producción |
   | `infrastructure.bootstrap/config/app/jwt-config.ts` | `JWT_SECRET` ausente o corto |
   | `infrastructure.bootstrap/config/app/login-rate-limit-config.ts` (012) | Variables `LOGIN_RATE_LIMIT_*` inválidas |
   | `infrastructure.bootstrap/config/app/runtime-env.ts` | TLS desactivado |
   | `infrastructure.bootstrap/config/core/logger.ts` | `APP_NAME` o `NODE_ENV` inválidos |
   | `infrastructure.bootstrap/config/core/cqrs/dispatcher.ts` | Handler no registrado: es un error de programación y da 500 genérico |

2. **Ninguna excepción con string suelto donde el mensaje llega al cliente:**
   `new (BadRequest|Conflict|UnprocessableEntity)Exception\(\s*['"\x60]` → `[]` en `application/`, `infrastructure/`
   y `api/`.
3. **Ningún filtro ni handler serializa la excepción:**
   - `/JSON\.stringify\(\s*exception/` → `[]`;
   - no existe `axios-filter.ts` ni `AxiosFilter`;
   - `Object.keys(new ErrorResponse('x', []))` es `['code', 'errors']`.

## 4. Frontend

### 4.1 Helper nuevo: `src/lib/api-errors.ts`
- **Importaciones:** solo `./constants.ts`, con la extensión explícita, como `view-mode.ts`. Así se prueba con
  `node --test`.
- **Exporta:**
  - `class ApiRequestError extends Error { readonly status: number; readonly code: string | null }`, con
    `name = 'ApiRequestError'`;
  - `messageFromErrorBody(status: number, body: unknown): string`, que es pura;
  - `toApiError(res: Response): Promise<ApiRequestError>`, que hace `res.json()` dentro de un `try` (si no es JSON,
    usa `null`) y arma el error con `messageFromErrorBody`;
  - `errorMessageOf(error: unknown, fallback: string): string`, que devuelve `error.message` si es un
    `ApiRequestError` y `fallback` en cualquier otro caso. Así no se muestran `TypeError: Failed to fetch` ni otros
    textos crudos.
- **Reglas de `messageFromErrorBody`,** en orden:
  1. status ≥ 500: `API_ERROR_MESSAGES.server`, aunque el backend mande otro texto;
  2. 404: `notFound`;
  3. `code === 'validation-failed'`: `validation`;
  4. 4xx con `errors[0].message` string no vacío: ese texto, recortado a 300;
  5. si no, el genérico del status (400 `badRequest`, 409 `conflict`, 413 `payloadTooLarge`, 429 `tooManyRequests`)
     o `generic`.
  - **Nunca:** lee `details`, usa el `message` de nivel superior, ni muestra JSON o `res.text()`.

### 4.2 Textos (`src/lib/constants.ts`)
- **`API_ERROR_MESSAGES`,** con voseo como `SESSION_MESSAGES`. Propuesta:
  - `badRequest`: "No pudimos procesar la solicitud. Revisá los datos e intentá de nuevo."
  - `validation`: "Hay datos incompletos o con formato inválido. Revisalos e intentá de nuevo."
  - `notFound`: "No encontramos el registro. Puede que se haya eliminado."
  - `conflict`: "No se pudo completar la operación por un conflicto con datos existentes."
  - `payloadTooLarge`: "La información enviada es demasiado grande."
  - `tooManyRequests`: "Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo."
  - `server`: "Ocurrió un problema de nuestro lado. Probá de nuevo en unos minutos."
  - `generic`: "No pudimos completar la operación. Probá de nuevo."
- **`API_ERROR_CODE`:** se agregan `NOT_FOUND: 'not-found'`, `VALIDATION_FAILED: 'validation-failed'` e
  `INTERNAL: 'unhandled-exception'`.
- **Fallbacks por operación:** los literales de los componentes ("Error al guardar profesional", etc.) quedan donde
  están. Moverlos todos excede el alcance; el criterio 8 pide constantes para los textos genéricos.

### 4.3 Cambios en `services/data.ts`
- **Todas las ramas `if (!res.ok)` que hoy lanzan `Error`:**
  - pasan a `throw await toApiError(res)`;
  - incluye las 5 con `res.text()` (`updateProfessionalProfile`, `createPayer`, `deleteStaff`, `updateWorkItem`,
    `deleteWorkItem`), los unos 25 `'Failed to ...'`, `createWorkItem` (sin la rama de `details`), `updateOrgSettings`
    (sin la comparación con `unhandled-exception` ni `JSON.stringify`) y `create/update/deleteActivityType`;
  - `getDashboardStats` usa la respuesta que falló.
- **Las funciones que hoy atrapan el error y devuelven un default** (`null`, `[]`) lo siguen haciendo.
- **No cambian:** `apiFetch`, `readErrorCode`, `login` (que incluye el 429 del 012), `rethrowServerAuthError`,
  `ApiUnauthorizedError`, `ApiForbiddenError` e `isHandledApiError`.
- **Compatibilidad:**
  - `ApiRequestError` es otra clase: `isHandledApiError` sigue en `true` solo para el 403 ya avisado;
  - el 401 y el 403 nunca llegan a `toApiError`, porque `apiFetch` los resuelve antes.

### 4.4 Componentes (cambios mecánicos)
- **Pasan a `errorMessageOf(e, <literal actual>)`:**
  - `org/profesionales/page.tsx`: guardar (para que se vea el 409 del CUIT) y eliminar. Se quita la heurística
    `includes('Foreign key'...)` y la concatenación de `e.message`; el borrado hace baja lógica y una FK sería un 500
    genérico;
  - `ProfessionalManager.tsx:89`, `createStaff`;
  - `PayerRulesManager.tsx:137`, el 400 del CUIT de organización;
  - `PatientDirectory.tsx:165`, la combinación;
  - `AdmisionesTable.tsx:182`, donde se quita la rama `e?.response?.data`;
  - `AtencionesTable.tsx:145`, `WorkItemForm.tsx:456`, `ActivityTypesManager.tsx:208,225` y
    `settings/general/page.tsx:98`.
- **Se mantiene** el `if (isHandledApiError(e)) return` previo.

## 5. Archivos

**Backend:**

| Archivo | Cambio |
|---|---|
| `src/infrastructure.bootstrap/filters/error-contract.ts` | **Nuevo:** `GENERIC_ERRORS`, `API_ERROR_CODE`, `mapException`, `isPrismaError`, `describeForLog`, `formatErrorLogLine` |
| `src/infrastructure.bootstrap/filters/filter-base.ts` | `catch` único: mapeo, log según §2.6, `X-Error-Id` en 5xx, `headersSent`. Sin métodos abstractos |
| `src/infrastructure.bootstrap/filters/http-filter.ts`, `global-filter.ts` | Solo `@Catch` y el constructor |
| `src/infrastructure.bootstrap/filters/final-error-handler.ts` | **Nuevo** (§2.8) |
| `src/infrastructure.bootstrap/filters/axios-filter.ts` | **Se borra** |
| `src/infrastructure.bootstrap/config/providers/filter-provider.ts`, `modules/app-module.ts` | Sin `AxiosFilterProvider` |
| `src/infrastructure.bootstrap/bootstrap.ts` | `await app.init()`, `app.use(finalErrorHandler)` y `listen` |
| `src/infrastructure.bootstrap/config/app/body-parser-config.ts` | Usa `GENERIC_ERRORS` |
| `src/domain/seed-work/error-response.ts` | Sin `details` ni `isErrorResponse` |
| `src/infrastructure.bootstrap/config/core/cqrs/dispatcher.ts` | Sin el log duplicado |
| `src/application/features/config/commands/update-organization-command.ts` | Sin el `catch` que loguea Prisma |
| `staff-commands.ts`, `activity.service.ts`, `fee-resolution.service.ts` | §3.1 |
| `login-query-handler.ts`, `activity-type-commands.ts`, `payer-commands.ts`, `fee-rule-splits.ts`, `merge-patient-command.ts`, `delete-activity-command.ts` | §3.2 |
| Tests | §7 |

**Frontend:**

| Archivo | Cambio |
|---|---|
| `src/lib/api-errors.ts` | **Nuevo** |
| `src/lib/api-errors.test.mts` | **Nuevo** |
| `src/lib/constants.ts` | `API_ERROR_MESSAGES`, `API_ERROR_CODE` ampliado |
| `src/services/data.ts` | §4.3 |
| `package.json` | Agrega `src/lib/api-errors.test.mts` al script `test` |
| Componentes | Los de §4.4 |

- **Sin cambios de schema, dependencias, `.env` ni compose.**
- **Documentador:**
  - `CLAUDE.md`, en convenciones del backend: los errores de negocio se lanzan como `new XException({ code, message })`;
    401, 403 y 404 llevan mensaje genérico; el 500 es `unhandled-exception` con `X-Error-Id`; invariante de
    `new Error`;
  - BACKLOG #13, #42 y #53 resueltos, e I-4;
  - RIESGOS B-2;
  - COMANDOS, si menciona la forma del error.

## 6. Plan de implementación (pasos chicos)
1. **Contrato puro:**
   - `error-contract.ts` y su spec unitario (tabla de casos de §7.1);
   - sin tocar todavía los filtros.
2. **Filtros:**
   - `filter-base.ts`, `http-filter.ts` y `global-filter.ts` usan `mapException`;
   - `ErrorResponse` sin `details`;
   - se borra `axios-filter.ts` y su provider;
   - se corren `guard-chain.spec`, `access-log.spec`, `login.spec` y `org-isolation.spec`, y se ajusta
     `guard-chain.spec:200`.
3. **Body parser y manejador final:**
   - `body-parser-config.ts` usa `GENERIC_ERRORS`;
   - `final-error-handler.ts` y su spec;
   - `bootstrap.ts`.
4. **Log seguro:**
   - el log de §2.6 (Prisma solo con nombre y código; 4xx en debug);
   - `dispatcher.ts` y `update-organization-command.ts`.
5. **Negocio:** §3.1 y §3.2, con los tests unitarios de cada caso.
6. **Invariantes:**
   - `security-invariants.spec.ts` (§3.3);
   - el `call` de `org-isolation.spec.ts` verifica el contrato en toda respuesta ≥ 400;
   - `logging.interceptor.spec.ts:116` reforzado.
7. **Backend:** `npx tsc --noEmit`, ESLint sin `--fix` sobre los archivos tocados y `npm test`.
8. **Frontend:**
   - `constants.ts`, `api-errors.ts` y `api-errors.test.mts`, con el script de `package.json`;
   - luego `data.ts`;
   - luego los componentes;
   - `npx tsc --noEmit`, `npm run lint`, `npm test` y `npm run build`.

## 7. Estrategia de tests

### 7.1 Jest
- **`filters/error-contract.spec.ts`** (unitario, de tabla). Para cada caso, el status, el `code`, `errors` exactos y
  que las claves sean `['code', 'errors']`:
  - **400:**
    - `ValidationPipe` (array): `validation-failed`, con los tope de 20 mensajes y 200 caracteres;
    - string suelto: el genérico;
    - `{ code, message }`: pasa el mensaje;
    - `Failed to decode param '...'`: el genérico.
  - **401, 403 y 404:**
    - 401 con `message: 'Unauthorized'`: el genérico del 401;
    - 403 `org-access-denied`, `forbidden` e `invalid-mode`: el genérico del 403 y el código conservado;
    - 404 `resourceNotFound()` y `NotFoundException('Cannot GET /x')`: **bodies idénticos**.
  - **409 y 429:**
    - `ConflictException` explícita (409);
    - `HttpException` 429 explícita, como el 012.
  - **5xx:**
    - `InternalServerErrorException('texto interno')`: el genérico;
    - `ServiceUnavailableException`: 503 con `unhandled-exception`.
  - **Errores de Prisma:** `new Prisma.PrismaClientKnownRequestError('... valor-where-ficticio ...', { code: 'P2002',
    clientVersion: '5.22.0', meta: { target: ['valor-meta'] } })`, `PrismaClientValidationError` y
    `PrismaClientInitializationError`:
    - 500 genérico;
    - `describeForLog` contiene `prisma=P2002` y **no** contiene `valor-where-ficticio`, `valor-meta` ni
      `clientVersion`.
  - **Otros errores:**
    - `Error('x')`;
    - un string lanzado;
    - un objeto lanzado;
    - `http-errors` con status 400 y `expose`: 400 genérico;
    - `http-errors` con status 500: 500.
  - **Saneamiento del log:** en `describeForLog`, los controles y ` ` del mensaje quedan neutralizados.
- **`filters/error-filters.spec.ts`** (HTTP, con `ProbeController` como `access-log.spec`):
  - **Arranque:**
    - `GlobalFilter` y `HttpFilter`, `configurePipes`, `configureBodyParser`, guards reales y `ILogger` con
      `jest.fn()`;
    - el manejador final registrado después de `app.init()`.
  - **Casos:**
    - un 400 de validación (DTO con class-validator);
    - un 401 sin token;
    - un 403 `org-access-denied`;
    - un 404 de recurso y uno de ruta inexistente (iguales);
    - un 409 y un 413;
    - un 429, con una ruta de prueba que lanza la misma excepción del 012;
    - un 500 de Prisma simulado: sin `meta`, `clientVersion`, valores ni `Prisma` en el body; con un header
      `X-Error-Id` que es un UUID; y un `logError` llamado una vez, con ese id y sin los valores;
    - un 500 de `Error`.
  - **I-4:** un middleware de prueba hace `next(Object.assign(new Error('x'), { status: 500 }))`, sin `type`, y la
    respuesta es el contrato JSON, sin HTML ni `stack`.
  - **B-1:** con `prisma.user.findUnique` que rechaza con un error de Prisma, la respuesta es el 500 genérico (no 401),
    sin detalle, y el log no tiene los valores.
  - **Ninguna respuesta tiene `details`:** se verifica en todos los casos.
- **`filters/final-error-handler.spec.ts`:**
  - unitario con `req` y `res` falsos: el JSON, el caso `headersSent` y que no llama a `next`;
  - Express sin Nest (supertest): un middleware que falla devuelve el contrato, nunca `text/html`.
- **Handlers:**
  - `config-handlers.spec`: el CUIT duplicado da `ConflictException`, `code: 'conflict'`, y no crea nada;
  - `activity.service.spec`:
    - la primera carga da `BadRequestException` con `first-load-required` y no abre la transacción;
    - sin profesional, da `BadRequestException`;
  - `fee-resolution.service.spec.ts` (nuevo, no existe hoy): `InternalServerErrorException` sin el id en el mensaje;
  - se actualizan los textos de §3.2 que verifican los tests. Hoy es solo `fee-rule-splits.spec.ts:12`
    (`'Invalid splits definition'`).
- **Invariantes:** §3.3. Además, `org-isolation.spec.ts`: el helper `call` pasa a ser `async` y, si `status >= 400`,
  verifica `Object.keys(body).sort()` igual a `['code', 'errors']` y `errors[0].message` string. Así recorre todos los
  4xx de la suite.
- **Existentes:** `guard-chain.spec:200` (el genérico del 401), `logging.interceptor.spec:116` (reforzado) y
  `access-log.spec` (más el conjunto de claves). El `login-rate-limit.spec` del 012 sigue verde sin cambios: su
  mensaje es explícito.

### 7.2 Frontend (`node --test`, `src/lib/api-errors.test.mts`)
- **`messageFromErrorBody`:**
  - `errors[0].message` en 400 y 409: se usa;
  - 500 con mensaje: el genérico `server`;
  - 404: `notFound`;
  - `validation-failed`: `validation`;
  - body `null`, texto, `errors` vacío o un `message` que no es string: el genérico del status;
  - mensaje de 1000 caracteres: recortado;
  - body con `details`: se ignora;
  - el `message` de nivel superior: se ignora.
- **`toApiError`,** con `new Response(...)` global de Node: JSON y no JSON, `status` y `code`.
- **`errorMessageOf`:** `ApiRequestError` da su mensaje; `TypeError` y `Error` dan el fallback.
- **Estático sobre el texto de `data.ts`** (como `api-routes.test.mts`): no contiene `Failed to`, `.text()` ni
  `details`.

### 7.3 Tester en vivo (sin escrituras)
Las condiciones previas son las de 007, 009 y 010:
- conteos de la base antes y después, con el método de solo lectura de los features anteriores;
- tokens firmados en memoria, sin imprimir el secreto;
- puertos 3000 y 3001 intactos.

Pasos:
1. **401:** `GET /api/activity` sin token. El body tiene solo `code: 'unauthorized'` y `errors`, sin `details`.
2. **403:** el mismo GET con token válido y un `x-org-id` UUID aleatorio. Da `org-access-denied` y el genérico.
3. **404:**
   - `GET /api/activity/<uuid aleatorio>` con la organización propia;
   - `GET /api/no-existe`;
   - los dos bodies son idénticos (`not-found`).
4. **400 de validación:** `POST /api/v1/auth/login` con `{ "user": 123, "password": "x" }` (email ficticio, no es el
   usuario de humo).
   - Da `validation-failed` con los mensajes de class-validator y sin `details`.
   - No consulta la base, y el limitador del 012 no lo cuenta, porque corre después del pipe.
5. **500 sin escribir:** `GET /api/activity?startDate=no-es-fecha&endDate=no-es-fecha`, con token ADMIN y la
   organización propia.
   - `new Date` inválido lleva a un `PrismaClientValidationError`.
   - Se espera un 500 con `unhandled-exception` y el genérico, y `X-Error-Id`.
   - El body no contiene `Prisma`, `Invalid`, `clientVersion` ni el id de la organización.
   - Si el log del backend es visible, tiene una línea `error id=<el mismo>` con `PrismaClientValidationError` y sin
     valores.
6. **413:** body JSON de 2 MB en `POST /api/v1/auth/login`. Da `payload-too-large` sin `details`.
7. **`.\dev.ps1 -Smoke` OK y conteos sin cambios.**
8. **Frontend (opcional, sin guardar):** ninguno de los pasos anteriores escribe. No se fuerzan errores de escritura
   desde la UI.

## 8. Rendimiento y compatibilidad
- **Rendimiento:**
  - `randomUUID()` solo en los 5xx;
  - el mapeo es O(1) y, en la validación, recorre como máximo 20 mensajes;
  - el log de los 4xx baja a debug, así que hay menos E/S en producción.
- **Clientes de la API:**
  - desaparece `details`;
  - los 4xx sin código explícito pasan de `unhandled-exception` al código del status;
  - los mensajes de 401, 403 y 404 pasan a genéricos en español;
  - el 400 de validación pasa a `validation-failed` con los mensajes reales (antes, `Bad Request Exception`);
  - los únicos clientes son el frontend del repo y Swagger: el esquema de `ErrorResponse` pierde `details`.
- **Frontend:** sigue igual en 401 y 403; muestra mensajes de negocio que antes perdía (tipos de actividad, CUIT) y
  deja de mostrar JSON crudo.
- **012:** compatible. Su 429 explícito pasa intacto, `Retry-After` no se toca y `login()` no cambia.

## 9. Riesgos
- **Menos detalle para depurar los 5xx de Prisma:** se registra solo la clase y el código. Se mitiga con `X-Error-Id`,
  la ruta y el código de Prisma, que alcanzan para reproducir en desarrollo. Es lo que pide el criterio 3.
- **Un mensaje de negocio nuevo con string suelto saldría genérico:** es una falla segura. Lo detecta el invariante 2
  de §3.3 para `BadRequest`, `Conflict` y `UnprocessableEntity`, y CLAUDE.md documenta la convención.
- **Orden de registro en `bootstrap.ts`:** `app.use` después de `init()` es válido en Nest 10 (`listen` no
  re-inicializa). Lo cubre el spec del manejador final.
- **El 012 y el 013 tocan `login-app.ts`, `data.ts`, `constants.ts` y `package.json`:** el 013 arranca con el 012
  commiteado. No se reescriben las líneas del 012.
- **Tests que comparan bodies entre casos** (`login.spec`, `org-isolation`): con el mensaje forzado por status, siguen
  siendo iguales, y el criterio se vuelve más fuerte.

## 10. Aclaraciones para el PO
1. **Primera carga (#53): 400 (`first-load-required`) y no 403.** Con 403, el frontend muestra el aviso genérico de
   permisos y el usuario no vería la regla. Si se prefiere 403, el mensaje específico no llega a la pantalla.
2. **401, 403 y 404 siempre con el mensaje genérico del status.** Refuerza el 404 idéntico del 007. Consecuencia: el
   403 "No se puede eliminar una actividad ya cobrada con fecha de pago" llega con el genérico. El frontend ya mostraba
   el aviso genérico de permisos, así que la pantalla no cambia. Si se quiere mostrar la regla, se propone al BACKLOG
   pasarlo a 409, lo que cambia una decisión y un test del 007.
3. **El 500 conserva `code: 'unhandled-exception'`.** El identificador de correlación viaja en el header
   `X-Error-Id`, no en el body. Mostrarlo en pantalla sería un cambio de UX que queda fuera de este alcance.
4. **Los 400 de validación devuelven los mensajes de class-validator, en inglés.** La API los entrega, y el frontend
   muestra un genérico en español ("Hay datos incompletos...").
5. **Los errores de unicidad o FK de Prisma (P2002 y P2003) siguen siendo un 500 genérico.** Por ejemplo, borrar una
   categoría en uso. Pasarlos a 409 se propone al BACKLOG, con análisis de enumeración por unicidad global.
6. **La falla de base en el guard da 500, no 503.** Se puede cambiar a 503 si el monitoreo lo necesita.
7. **`axios` y `@nestjs/axios` quedan sin uso** tras borrar `axios-filter.ts`. Se propone quitarlos en un ítem del
   BACKLOG, porque implica cambiar dependencias y el lockfile.
8. **I-4:**
   - en la app real, los errores de middleware ya los toma el handler de error de Nest, y no el de Express (§1.2);
   - el manejador final se agrega igual, como defensa en profundidad;
   - el documentador debería corregir la nota de I-4 en el BACKLOG.
9. **Organización inexistente en `fee-resolution`: 500 controlado, no 404.** Es un estado que no debería ocurrir,
   porque quien llama ya verificó la organización.

VEREDICTO: APROBADO
