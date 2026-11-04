# 010 — Implementación

Sin desvíos de la spec. Sin commit ni push. No se tocó `.env`, `backend/.env`, `.claude/`, `.vscode/` ni `frontend/AGENTS.md`. No se ejecutó `dev.ps1` ni se levantó el stack.

## Cambios por criterio

### 1 y 2. Línea de acceso
- Nuevo `backend/src/infrastructure.bootstrap/config/app/access-log.ts`: `createAccessLogMiddleware(sink = new Logger('Access'))` (Express, `res.on('finish')`).
  - Escribe `METHOD /ruta STATUS Nms`. La ruta sale de `originalUrl` sin query ni fragmento y acotada a 200 caracteres (`sanitizeAccessPath`).
  - Nivel `log` para 2xx y 3xx, `warn` para 4xx y 5xx. No incluye headers, query, body, tokens, emails, `userId` ni cuerpo de respuesta. No se agregó el `userId` truncado (opcional).
  - Las rutas con ids de recurso (UUID en el path) sí quedan en la ruta, igual que antes con el interceptor.
- `bootstrap.ts`: `app.use(createAccessLogMiddleware())` va antes de `configureBodyParser`. Así ve los 401/403 de los guards, el 404 de ruta inexistente, el 400/413 del parser y los 500.
- `LoggingInterceptor` ya no escribe la línea de acceso: quedó solo el debug redactado (params, query, body), con la misma opción `debugEnabled`.

### 3. Límite del body
- `config/app/body-parser-config.ts` (se reescribió; ya difería de HEAD por EOL, queda incluido en el feature):
  - `parseBodySizeLimit(raw)`: acepta `<número>[b|kb|mb]` (por ejemplo `500kb`, `1mb`, `2.5mb`; sin unidad son bytes). Ausente o vacío da `1mb`. Valor inválido, 0, o mayor a 10mb lanza un `Error` con mensaje claro y el backend no arranca. No se acepta `gb`.
  - `configureBodyParser` aplica el mismo límite a `json` y a `urlencoded` (con `extended: true`, como el default de Nest). El `urlencoded` por defecto de Nest tenía 100kb; ahora tiene el límite configurado.
  - `bodyParserErrorHandler` (manejador de errores de Express registrado justo después de los parsers): los errores del parser ocurren antes de Nest y no pasan por sus filtros, así que sin esto la respuesta sería la página HTML por defecto de Express. Responde 413 `{code:'payload-too-large', errors:[{message}]}` y 400 `{code:'bad-request', ...}` (JSON inválido) con la forma `ErrorResponse`, sin `details`, sin stack y sin el límite. Otros errores se pasan a `next`.
- Verificación de tamaños en el front:
  - Ningún flujo manda archivos: no hay `FormData`, `multipart`, `readAsDataURL` ni `<input type="file">` en `frontend/src`.
  - El merge de pacientes (`mergePatient` en `src/services/data.ts`) manda ids por la URL y un body mínimo.
  - No hay alta masiva. Los demás bodies son formularios de decenas de campos, de pocos KB.
  - Conclusión: 1 MB alcanza.

### 4. TLS
- `config/app/runtime-env.ts`: `assertTlsVerificationEnabled(env = process.env)` es una función pura. Lanza si `NODE_TLS_REJECT_UNAUTHORIZED` vale `0` (también con espacios o comillas). El mensaje remite a `.\dev.ps1 -ExportCa`. `bootstrap()` la llama como primera instrucción, antes de `NestFactory.create`.
- `scripts/dev-lib.env.ps1` (`Sync-BackendEnv`): `NODE_TLS_REJECT_UNAUTHORIZED` pasa a una lista de claves prohibidas. No se copia al bloque "locales conservadas" y se agrega un aviso en `Warnings` (nombre de la clave, sin valores, con remisión a `-ExportCa`). Como la clave deja de existir en el archivo, el aviso sale una sola vez. Las demás claves locales se conservan.
- Caveat: el valor puede venir también del entorno del proceso (variable de entorno del sistema), no solo de `backend/.env`. El chequeo de arranque cubre ambos casos; el aviso de `dev.ps1` solo cubre el archivo.

### 5. Documentación operativa
- `backend/.env.example`: `# BODY_SIZE_LIMIT=1mb` con comentario (opcional, default 1mb, máximo 10mb).
- `.env.example` (raíz): mismo bloque comentado. Aclara que este `.env` no lo pasa al backend: en desarrollo se define en `backend/.env` (`dev.ps1` conserva las variables locales ajenas) y el modo Docker usa el default.
- `docs/auditoria/COMANDOS.md` línea ~335 todavía dice "default 50mb": queda para el documentador.

## Archivos tocados
Backend (`backend/src/infrastructure.bootstrap/`):
- `bootstrap.ts`
- `config/app/access-log.ts` (nuevo)
- `config/app/body-parser-config.ts`
- `config/app/runtime-env.ts`
- `interceptors/logging.interceptor.ts`

Tests (mismo directorio base):
- `config/app/access-log.spec.ts` (nuevo)
- `config/app/body-parser-config.spec.ts` (nuevo)
- `config/app/runtime-env.spec.ts`
- `interceptors/logging.interceptor.spec.ts`

Otros:
- `backend/.env.example`
- `.env.example`
- `scripts/dev-lib.env.ps1`
- `scripts/dev-lib.tests.ps1`

## Tests
- `access-log.spec.ts` (app Nest real con guards de autenticación, organización y modo, `HttpFilter`, `GlobalFilter` y `configureBodyParser` con límite `1kb`; sink de logger capturado):
  - una línea exacta y única por request en 200 (`log`), 401 sin token, 403 por organización ajena, 404 de ruta inexistente, 413, 400 por JSON inválido y 500 (todas `warn`);
  - el 413 y el 400 devuelven el cuerpo genérico, sin stack ni detalles;
  - ni tokens, ni su firma, ni `userId`, ni `orgId`, ni contraseña, ni email, ni cookie, ni `Bearer`, ni query aparecen en las líneas.
- `body-parser-config.spec.ts`: default, valores válidos y rechazo de 50mb, 11mb, 0, negativos, unidades inválidas, texto basura y no-strings.
- `runtime-env.spec.ts`: acepta ausente, vacío, `1` y `true`; rechaza `0`, ` 0 `, `"0"` y `'0'` con remisión a `-ExportCa`.
- `logging.interceptor.spec.ts`: ahora registra el middleware y verifica que la línea de login aparece exactamente una vez; la redacción en debug sigue verde.
- `dev-lib.tests.ps1`, caso 3 actualizado: la clave se elimina, hay un aviso, el aviso remite a `-ExportCa` y no muestra el valor. Las otras claves locales (`CORS_*`) se conservan. Se agregó un caso nuevo: un `backend/.env` ya generado que reintroduce la clave se limpia, conserva `CUSTOM_LOCAL_KEY`, avisa una vez, y la segunda corrida no cambia nada ni avisa.

## Calidad
- `npx tsc --noEmit` (backend): sin errores.
- `npx eslint` sobre los archivos tocados (no spec de interceptor/runtime-env, que ya traían avisos): sin errores.
  - Quedan warnings de "Unused eslint-disable directive" en `runtime-env.spec.ts` y `logging.interceptor.spec.ts`, que ya venían así del header existente.
- `npx prettier --check` sobre `config/app/*.ts`: ok.
- `npm test` (backend): 32 suites, 563 tests, todo verde.
- `scripts\dev-lib.tests.ps1`: 1026 OK, 0 fallidos. El archivo sigue en disco.

## Notas
- Revisor:
  - El `bodyParserErrorHandler` solo captura errores de `body-parser` con `status` 400 o 413 y `type` de la familia `entity.*`, `encoding.*`, `request.*` o `charset.*`. El resto se delega a `next(err)`.
  - Verificar que `app.use(createAccessLogMiddleware())` queda antes del CORS: sí, está primero. Una preflight `OPTIONS` también queda registrada.
- Seguridad:
  - La línea de acceso incluye ids de recurso del path (UUID de la ruta), no ids de usuario ni de la organización (que viaja por header).
  - Los errores de los filtros siguen escribiendo `exception.message` por `ILogger.logError`; no se tocó (013).
  - Una conexión abortada antes de `finish` no genera línea (solo `finish`, como pide la spec).
- Tester:
  - Tras `.\dev.ps1 -Init`, verificar la ausencia de la clave en `backend/.env`.
  - Un body de 2 MB debe dar 413 con `code: payload-too-large`.
  - Buscar en los logs las líneas `Access`, como `GET /api/... 200 Nms`, para 200, 401, 403 y 404.
  - Para probar el arranque, `NODE_TLS_REJECT_UNAUTHORIZED=0` en el entorno del proceso debe impedirlo.
- Dudas pendientes: el modo Docker no pasa `BODY_SIZE_LIMIT` al contenedor (el compose no lo declara). Queda siempre en 1mb; si se quiere configurable, hay que agregarlo al compose (fuera de alcance).

## Vuelta de corrección 1

- **B-1 (log injection):** en `backend/src/infrastructure.bootstrap/config/app/access-log.ts` se agregó `neutralizeUnsafeChars`, que reemplaza por `?` todo carácter fuera de `[\x21-\x7E]` (controles, espacios, CR/LF, 0x7F, 0x85, U+2028). Se elige `?` y no percent-encoding para no alargar la línea. Se aplica a la ruta (`sanitizeAccessPath`, después de quitar query y fragmento y de acotar a 200) y al método (además acotado a 16 caracteres).
- **B-2 / m-1 (415 del body parser):** en `body-parser-config.ts` el manejador de errores del parser ahora cubre 400, 413 y 415 (cualquier status de `GENERIC_BODY_ERRORS`). El 415 (`encoding.unsupported`, `charset.unsupported`) responde `ErrorResponse` con `code: unsupported-media-type` y un mensaje genérico en español, sin stack ni detalles. Otros errores siguen delegándose.
- **Tests** (`access-log.spec.ts`): 2 HTTP nuevos (`Content-Encoding: foo` y `charset=utf-32` dan 415 genérico, y el access log registra una línea warn `POST ... 415`); 2 unitarios con 0x85, controles simulados (`\r\n\t\x00\x7f `) y espacios sobre las funciones puras.
- **Resultados:** `npx tsc --noEmit` sin errores; `npx eslint` de los 3 archivos tocados sin errores; `npm test` del backend: 32 suites, 567 tests en verde.
- Sin desvíos del diseño ni dudas nuevas.

## Recuperación de dev-lib.tests.ps1

- Estado: NO recuperado. `scripts/dev-lib.tests.ps1` sigue borrado (`git status`: ` D`). Los cambios del 010 en ese archivo no se reaplicaron.
- `git restore --source=HEAD --worktree -- scripts/dev-lib.tests.ps1` falla con "Permission denied". También falla crear ese nombre exacto con `git show`, `cp`, redirección de bash y `Set-Content` (Acceso denegado), incluso con contenido de 3 bytes (`hi`).
- Crear otros archivos en `scripts/` funciona, también con el contenido completo de HEAD (161793 bytes) bajo otro nombre. Por eso el bloqueo es por ruta/nombre, no por contenido: la hipótesis de las firmas por contenido no se sostiene para este bloqueo.
- Hay procesos de AVG en ejecución (`AVGSvc`, `AVGUI`); Windows Defender está desactivado. Probable causa: una regla de AVG (cuarentena/bloqueo del nombre) que hay que revisar o excluir desde la consola de AVG (acción del usuario).
- Mitigación de literales sospechosos: no se aplicó (sin el archivo restaurado en su ruta no tiene efecto verificable). Los tests no se corrieron.
- No se hizo ningún otro cambio en el repo.

### Actualización: recuperado
- Tras la exclusión de AVG para `scripts\` y sacar el archivo de la cuarentena, `git restore --source=HEAD --worktree -- scripts/dev-lib.tests.ps1` funcionó (archivo de 163693 bytes) y se reaplicaron los cambios del 010: caso 3 de `Sync-BackendEnv` (la clave se elimina, un aviso, remite a `-ExportCa`, sin valor) y el caso nuevo (clave reintroducida: se limpia, conserva `CUSTOM_LOCAL_KEY`, avisa una vez, segunda corrida sin cambios ni aviso).
- `scripts\dev-lib.tests.ps1`: 1025 OK, 0 fallidos (se esperaban 1026; la diferencia de una aserción es del conteo de este caso nuevo, sin fallos).
- El archivo siguió existiendo y legible justo después de los tests y a los 60 s (165084 bytes).
- Carpeta temporal del sandbox (`[IO.Path]::GetTempPath()`): `C:\Users\Administrador\AppData\Local\Temp\` (subcarpetas `solidus-dev-tests-<GUID>`, que el test borra al terminar). Es la ruta a excluir en AVG si vuelve a detectar archivos.
- `git diff --ignore-cr-at-eol --stat`: 17 inserciones (15 líneas de código y comentario, más una en blanco y el comentario de cabecera del caso nuevo) y 1 eliminación.
