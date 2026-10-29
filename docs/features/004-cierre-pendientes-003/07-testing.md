# 07 - Testing: 004-cierre-pendientes-003

## Re-test vuelta 2

Alcance: B-1, H-2 y N-3 (más regresión rápida). Mismas salvaguardas: sin seeds ni escrituras SQL, sin `down -v`/prune, sin tocar el puerto 3000 (pm2), sin imprimir secretos, sin git de escritura, `_backup_git` intacto.

| Paso | Resultado |
|---|---|
| 1. Estado inicial | Sin contenedores del feature en ejecución ni ventanas; 3000 de pm2 (pid 19988) intacto. Conteos (SELECT de solo lectura): **9 / 3 / 72 / 324 / 1483**, como se esperaba |
| 2. B-1 (criterio 4) | **PASA.** PEM movido a %TEMP% (hash SHA256 `480D71DB...16D3B9`). `-Docker` sin CA: **código 9**, 0 líneas `RemoteException`, mensaje final "Error de certificados: un antivirus o proxy intercepta HTTPS. Exporta su CA con .\dev.ps1 -ExportCa y repeti .\dev.ps1 -Docker." Error TLS que disparó la pista: **apk** (`apk add --no-cache openssl` del builder del backend: "TLS: server certificate not trusted"). El caso de Turbopack no se pudo reproducir en vivo (el build cortó antes, en apk); solo lo cubren los tests de patrón. PEM restaurado: hash idéntico; la ACL quedó heredada de `.dev/certs` (solo SYSTEM, Administradores y el usuario), equivalente a la anterior |
| 3. H-2 con CA | **PASA.** `-Docker` con CA: código 0, backend reconstruido. En el contenedor: `node_modules/@prisma/engines` incluye `schema-engine-linux-musl-openssl-3.0.x` y `libquery_engine-linux-musl-openssl-3.0.x.so.node`; `node_modules/.prisma/client` incluye `libquery_engine-linux-musl-openssl-3.0.x.so.node`. Log de `migrate deploy`: "8 migrations found ... No pending migrations to apply.", sin `binaries.prisma.sh`, sin errores de certificado. Prueba sin red (`docker run --network none ... npx prisma -v`): no descarga nada y lista Query Engine y Schema Engine (ambos `linux-musl-openssl-3.0.x`, en `node_modules/@prisma/engines`). `-Smoke`: Backend OK, Frontend OK (3001), Login OK. `docker ps`: `127.0.0.1:8080`, `127.0.0.1:3001` (y `127.0.0.1:5433`). CA fuera de las imágenes (backend y frontend): sin variables de CA en `Config.Env`; `/run/secrets` no existe; `sha256` de `ca-certificates.crt` = `5961c0a3...` igual al de `node:22-alpine`; 0 coincidencias de "AVG" en el bundle; `docker history --no-trunc` sin PEM. `-Stop` OK |
| 4. N-3 | **PASA.** No existía `processes.json`. Con `{no es json`: `-Stop` mostró "Aviso: No se pudo leer el registro de procesos (.dev\processes.json): puede haber ventanas de backend/frontend de dev.ps1 sin detener ... cerralas a mano. No se mata ningun proceso sin verific[ar]", sin imprimir el contenido; 0 procesos detenidos; código 0. El archivo de prueba quedó eliminado (por `-Stop`/por mí) |
| 5. Modo desarrollo | **PASA.** `.\dev.ps1` código 0 (migraciones aplicadas, backend y frontend responden, URL 3002); escuchando solo `127.0.0.1:8080` y `127.0.0.1:3002`; `-Smoke` Login OK; `-Stop` detuvo 2 procesos y los contenedores |
| 6. Calidad | Tests de PowerShell **980 OK, 0 fallidos**; `tsc --noEmit` backend 0 y frontend 0; `npm test` backend 2 suites / 21 tests OK; `docker compose config --quiet` con y sin `-f docker-compose.extra-ca.yml`: 0 y 0 |
| 7. Conteos finales | **9 / 3 / 72 / 324 / 1483**, idénticos al paso 1 |
| 8. Barrido de secretos | `POSTGRES_PASSWORD`, `JWT_SECRET` y `SMOKE_PASSWORD` vigentes (comparados en memoria) contra mis capturas, `git diff HEAD`, archivos sin trackear, `docs/features/004` y scripts del scratchpad: **0 coincidencias**. Capturas y copias temporales (PEM y hash en %TEMP%) borradas |
| 9. Estado final | Sin contenedores en ejecución ni ventanas del feature; 3000 intacto (único listener de los puertos revisados); `.dev/` solo con `certs/`; `git status --porcelain`: 32 entradas (14 modificadas + 18 sin trackear, las mismas que antes); `git diff --ignore-cr-at-eol .claude/settings.json`: vacío |

Criterios afectados: 4 pasa; 1, 3, 5, 8, 14, 17 y 20 reconfirmados en la regresión; 21 queda para el documentador.

Hallazgos nuevos: ninguno de severidad media o alta. Observaciones menores:
- (info) El mensaje de N-3 sale con "Aviso:" y la línea siguiente igual muestra "Procesos detenidos: 0" en verde; es coherente, solo notable.
- (info) Sin CA, un `-Docker` ahora falla antes (en `apk add openssl` del builder) que con el cambio de H-2; sigue con la pista correcta.

Qué no pude verificar:
- B-1 con el error real de Turbopack/Google Fonts: la pista se comprobó con el error de apk; Turbopack solo por tests de patrón.
- H-2 "con una base nueva" (sin migraciones aplicadas): no se creó una base vacía (sin escrituras). Se comprobó que los engines están en la imagen y que `prisma -v` funciona sin red, lo que implica que `migrate deploy` no necesita descargar.
- Build sin CA en una red sin inspección TLS; PowerShell 7; N-4 (backend, queda para la 005).
- Criterio 21 (documentación) y el borrado de `_backup_git`.

Veredicto de esta vuelta: B-1, H-2 y N-3 resueltos; los 20 criterios verificables pasan.

---

## Informe anterior (vuelta 1)

Tester. Windows 11, Windows PowerShell 5.1, Docker Desktop, AVG activo. Todo se ejecutó con
`powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 ...` desde la raíz. Nunca se escribió BORRAR,
no se imprimió ningún valor de `.env`/`backend/.env`/respaldos (solo nombres, hashes y largos), no se tocó
el puerto 3000 (coach-claudio, pm2) ni `C:\Repositorios\_backup_git\`. Sin commit, push, stash ni reset.

## Resultado base y datos

| Momento | User / Organization / Patient / WorkItem / total `public` |
|---|---|
| Línea base (antes de tocar nada) | 8 / 3 / 72 / 324 / 1482 (Postgres 16.11, `log_statement=none`, `migrate status`: al día) |
| Tras `-CreateSmokeUser` (y 2.ª ejecución) | 9 / 3 / 72 / 324 / 1483 |
| Tras Docker, rotaciones, modo desarrollo, `-Seed` cancelado, limpieza y `-Docker` final | 9 / 3 / 72 / 324 / 1483 |

Única diferencia: +1 `User` ("Usuario de humo (dev.ps1)", email `smoke-<8 hex>@solidus.invalid`, 30 caracteres).
Tiene 0 filas en `OrganizationMember`, `UserRole` y `Professional`; los otros 8 usuarios siguen. El total sube 1
porque ese usuario es la única fila nueva. Las rotaciones no tocan tablas de `public`.

## Criterios

| # | Criterio | Prueba | Resultado |
|---|---|---|---|
| 1 | CA extra opcional en builds | Sin CA: el build corre con el secreto ausente y se comporta como hoy (falla por TLS de AVG). Con CA: `-Docker` construye ambas imágenes (apk, npm, prisma generate, next build). Imágenes finales: `Config.Env` sin `SSL_CERT_FILE`/`NODE_EXTRA_CA_CERTS`/Turbopack/`EXTRA_CA`; `/run/secrets` no existe; `/tmp` vacío; `sha256` de `ca-certificates.crt` igual al de `node:22-alpine` (`5961c0a3c6545993...`); `docker history --no-trunc` sin PEM; búsqueda en todo el FS de ambas imágenes de un fragmento del certificado: 0 coincidencias. Los Dockerfiles no desactivan TLS (test automático). | PASA |
| 2 | Obtención del certificado (`-ExportCa`) | Sin `-Yes` y sin consola: muestra sujeto y huella y cancela (código 0, no escribe). Con `-Yes`: detecta `CN=AVG Web/Mail Shield Root`, huella completa `<huella SHA-1 de la CA local>` en pantalla. PEM: 1 bloque `CERTIFICATE`, 0 `PRIVATE`. `git check-ignore`: ignorado por `.gitignore:33 (.dev/)`. ACL del archivo y de `.dev/certs`: solo usuario, SYSTEM y Administradores. 2.ª ejecución: "Sin cambios", hash idéntico. `-Docker` lo usa solo ("Usando CA extra ... 1 certificado(s)"). `docker compose config --quiet` con el override: 0. | PASA |
| 3 | Docker en vivo | `-Docker` código 0; `-Smoke` = Backend OK, Frontend OK (3001), Login OK; `docker ps`: `127.0.0.1:8080->8080`, `127.0.0.1:3001->3000`, `127.0.0.1:5433->5432`; `db` es `postgres:16.11-alpine`; `-Stop` conserva los datos (conteos iguales). Repetido 2 veces más (tras rotaciones y tras la limpieza). | PASA |
| 4 | Código propio de `up --build` + pista de certificados | `-Docker` sin CA: sale con **código 9**, `docker ps` sin contenedores nuevos. Pero la salida final dice "Revisa la salida del build de arriba y: docker compose logs": **no menciona `-ExportCa`**. El error fue el de Next/Turbopack ("Error while requesting resource... Hint: It looks like this error was TLS-related"), que `$script:TlsErrorPattern` no reconoce. Los errores de `apk`/`npm` sí lo cumplirían (lo reportó el desarrollador con un build real), pero aquí las capas anteriores estaban en caché. | **FALLA (parcial)**: ver bug B-1 |
| 5 | Sin `RemoteException` (5.1) | 0 líneas `RemoteException` en todas las salidas de `dev.ps1` capturadas (`-Docker` fallido incluido, build real, migrate/prisma) | PASA |
| 6 | Puerto con que se lanzó el frontend | 2.ª ejecución: "El entorno ya esta levantado", URL `http://localhost:3002`. Con `FRONTEND_PORT=3003` temporal: aviso "FRONTEND_PORT cambio ... (en uso: 3002, en .env: 3003). Ejecuta .\dev.ps1 -Stop" y URL 3002. `processes.json` guarda `"port": 3002`. Hash del `.env` restaurado (`BA40A1511EEE` antes y después) | PASA |
| 7 | `[0-9]` | Solo por los tests de PowerShell (958 OK, incluye dígitos no ASCII). No se probó en vivo | PASA (test) |
| 8 | Loopback en desarrollo | `Get-NetTCPConnection -State Listen`: 8080 y 3002 en `127.0.0.1` (no `0.0.0.0`/`::`). Línea de comandos de Next: `next dev -p 3002 -H 127.0.0.1`. `localhost:3002/login` y `127.0.0.1:3002/login` = 200. `POST /api/v1/auth/login` con credenciales ficticias por `localhost:3002` y por `127.0.0.1:3002` = 401 (igual que directo al backend 8080): el rewrite funciona. Docker sin cambios: publicados en `127.0.0.1` según `BIND_ADDRESS`. `backend/.env` trae `LISTEN_HOST`. Backend `npm test`: `listen-config` OK | PASA |
| 9 | Daemon TCP en loopback | Solo tests (positivos y negativos); el daemon real es `npipe`. No se probó en vivo | PASA (test) |
| 10 | `-Stop` verifica línea de comandos (S-5) | Lancé mi propio `powershell -NoProfile -NoExit -Command Start-Sleep 600` y lo registré en `processes.json` con nombre `frontend`, su PID y su `StartTime` reales. `-Stop`: "Procesos detenidos: 2" (las ventanas reales) y mi proceso siguió vivo; lo cerré yo. (Mi primer intento dejó el JSON mal formado por un error del arma de pruebas: ver nota N-3) | PASA |
| 11 | Permisos (S-1) | Antes de `-Init`: `.env` heredaba `Usuarios:(RX)` y `Usuarios autentificados:(M)`. Después (`icacls`): `.env`, `backend/.env`, `backend/.env.pre-003.bak`, `.dev` y `.dev/certs/extra-ca.pem`: solo SYSTEM, Administradores y el usuario actual, herencia cortada. `.dev` existía vacío antes y quedó protegido. Condición V-1 de seguridad: **cumplida**. El caso "sin ACL" solo por tests | PASA |
| 12 | Postgres fijado | `docker-compose.yml`: `postgres:16.11-alpine`; `db` recreado sobre el volumen existente sin migrar datos (`docker inspect`: `postgres:16.11-alpine`); datos intactos | PASA |
| 13 | Usuario de humo | `-CreateSmokeUser`: código 0; "SMOKE_PASSWORD, SMOKE_USER ... (no se muestran)"; `SMOKE_USER` con forma `smoke-xxxxxxxx@solidus.invalid`, `SMOKE_PASSWORD` de 48 caracteres; +1 `User` con ese nombre; 0 filas en `OrganizationMember`/`UserRole`/`Professional`; 2.ª ejecución "actualizado", código 0, sigue +1; los otros 8 usuarios no cambian | PASA |
| 14 | Login OK con ese usuario | `-Smoke` en modo desarrollo: Login OK (antes y después de rotar). En Docker: Login OK (tres veces, incluido tras ambas rotaciones) | PASA |
| 15 | Hook `pre-commit` | `-Init` real: `core.hooksPath=.githooks`. Repo temporal en TEMP con valores ficticios armados en ejecución: archivo limpio pasa; archivo con el valor de `JWT_SECRET` rechazado; con el de `POSTGRES_PASSWORD` rechazado; `.env` staged rechazado; URL con usuario:contraseña rechazada; `.pem` rechazado; `.env.example` pasa; `--no-verify` deja pasar (documentado). Ningún valor aparece en la salida del hook. En el repo real: `scripts/pre-commit.ps1` con índice vacío = código 0. Los tests de PowerShell cubren los demás patrones | PASA |
| 16 | `package-lock.json` | El diff (ignorando fin de línea) solo cambia `name` a `solidus-frontend` (2 líneas). El commit lo hace el PO | PASA (listo para commitear) |
| 17 | Rotar contraseña de Postgres | `-RotateDbPassword -Yes` con el stack Docker arriba: código 0; el `.env` cambia solo la línea `POSTGRES_PASSWORD` (comparación por hash línea a línea: 1 diferencia); largo 48 hex; `backend/.env` regenerado (DATABASE_URL coincide con la nueva); se recreó solo el backend; `-Smoke` Login OK. La contraseña vieja es rechazada por TCP (`password authentication failed`) y la nueva acepta. `docker compose logs db` sin ninguna de las dos. Modo desarrollo con la nueva: código 0, `migrate deploy` OK, ya no aparece el aviso de contraseña corta, Login OK. `-Docker` después: código 0, Login OK. Valor nuevo no está en `valores.txt` ni en los vigentes anteriores | PASA |
| 17b | `-RotateJwtSecret` (agregado por el PO) | `-RotateJwtSecret -Yes` con Docker arriba: código 0; solo cambia la línea `JWT_SECRET` (1 diferencia por hash); largo 64 hex; `backend/.env` coincide; se recreó solo el backend (db y frontend siguieron "Up 16 minutes"); Login OK. El valor viejo figuraba en `valores.txt`; el nuevo no | PASA |
| 18 | Borrar restos | `backend/.env.pre-003.bak` borrado. Para `backend_postgres_data` y `healthops-gem_healthops_postgres_data`, `docker ps -a --filter volume=` dio vacío; recién ahí `docker volume rm` de esos dos. Volúmenes: 11 antes, 9 después, la diferencia son exactamente esos dos (`healthops-gem_solidus_postgres_data` sigue). Datos iguales. El aviso de "volumen del compose viejo" desapareció de `dev.ps1`. `_backup_git` **no se borró** (lo hace el PO después del push) | PASA (queda `_backup_git`, pendiente por instrucción) |
| 19 | Datos intactos | Ver tabla de datos: solo +1 `User` (humo) y +1 en el total | PASA |
| 20 | Calidad | Tests de PowerShell: **958 OK, 0 fallidos**. Parser, BOM único y LF en `dev.ps1` y 12 `.ps1` de `scripts/`: 0 errores; sin `??`, `?.`, `-AsHashtable`, `::Fill(`, `&&`; el único `||` está en `dev-lib.tests.ps1` (literales de test). `npx tsc --noEmit`: backend 0, frontend 0. `npm test` backend: 2 suites, 21 tests OK. ESLint sobre `listen-config*.ts`: limpio; `bootstrap.ts`: 2 errores preexistentes (`DocumentBuilder`, `SwaggerModule`). `docker compose config --quiet`: 0 con y sin el override | PASA |
| 21 | Documentación | `.claude/CLAUDE.md` y `docs/auditoria/COMANDOS.md` aún no mencionan `-ExportCa`, `-RotateDbPassword`, `-CreateSmokeUser` ni el hook (0 coincidencias). Es la etapa del documentador (08), posterior a esta | NO VERIFICABLE AÚN |

Otras comprobaciones del plan:
- `-Seed` sin consola: "Seeds cancelados. No se modifico la base." (código 0, conteos iguales). Nunca se escribió BORRAR.
- Barrido de secretos: 17 valores únicos (contraseña y JWT viejos, valores de `valores.txt`, los del `.bak`, y los vigentes de `POSTGRES_PASSWORD`, `JWT_SECRET`, `SMOKE_PASSWORD`; en memoria/archivo temporal) sobre 51 capturas y scripts, `git diff HEAD`, 23 archivos sin trackear, los 6 documentos de `docs/features/004` y las salidas de tareas: **0 coincidencias** en todos. Capturas y archivos de valores del scratchpad borrados.
- Entorno final: `-Stop` ejecutado; 0 contenedores de healthops-gem, sin ventanas del feature, 5433/8080/3001/3002 libres, `.dev/` solo con `certs/`. El 3000 (pm2, pid 19988) intacto.
- `git status --porcelain`: 14 modificados y 18 sin trackear, todos esperados (los del diseño §3, más `.claude/settings.json`). `.claude/settings.json` no se editó: `git diff --ignore-cr-at-eol` da 0 líneas (solo aviso LF/CRLF; V-2 cumplida). No aparecen `.env`, `.bak`, PEM ni `.dev` (ignorados).

## Bugs y hallazgos

**B-1 (menor/medio) La pista de certificados falta cuando falla `next build` por Google Fonts.**
Pasos: con la CA de AVG activa y sin `.dev/certs/extra-ca.pem`, y con las capas de `apk`/`npm install` en caché, ejecutar `.\dev.ps1 -Docker`. Sale con código 9 (bien), pero el mensaje final es "Revisa la salida del build de arriba y: docker compose logs", sin mención de `-ExportCa`. Causa: el error de Turbopack ("Error while requesting resource", "establishing a connection", "this error was TLS-related") no coincide con `$script:TlsErrorPattern` (`scripts/dev-lib.core.ps1:26`). Arreglo propuesto: agregar al patrón `TLS-related` y `Error while requesting resource` (con un test y sin reintroducir el falso positivo de `certificate` suelto). Incumple la parte "pista" del criterio 4.

**H-2 (informativo/medio, fuera de los 21 criterios) En modo Docker con AVG, `npx prisma migrate deploy` del arranque del contenedor falla por TLS.** El log del backend muestra `request to https://binaries.prisma.sh/... failed, reason: unable to verify the first certificate` antes de `start:prod`. El contenedor en tiempo de ejecución no tiene la CA (por diseño, criterio 1). El backend arranca igual y esta base ya está migrada, pero con una base nueva en esta máquina las migraciones no se aplicarían en Docker. Preexistente en el `CMD` del Dockerfile. Pasar la descarga del motor al build o aplicar migraciones desde el host (el modo desarrollo sí las aplica).

**N-3 (observación) `-Stop` con `processes.json` mal formado deja ventanas vivas.** Mi primer intento del S-5 escribió el JSON con un array anidado (error mío): `-Stop` informó "Procesos detenidos: 0", borró el registro y avisó que 8080 y 3002 estaban ocupados por procesos que no lanzó. Falla cerrada y segura, pero deja las ventanas huérfanas. Las cerré yo por PID, solo las que había lanzado `dev.ps1` (verificado con el registro previo). Repetí la prueba bien y pasó.

**N-4 (observación, backend, para la 005) `POST /auth/login` sin el campo `user` responde 500.** `LoginQuery` usa `user`/`password`; el plan del diseño usaba `email`, lo que da 500 por `throw new Error` en el handler (no 400). Con `user` inexistente da 401, que es lo que se verificó.

## Qué no pude verificar
- El log de la ventana de Next (`ECONNREFUSED ::1`, "Blocked cross-origin"): las ventanas no se capturan. Evidencia indirecta: 200 en `localhost` y 127.0.0.1, 401 por el rewrite y Login OK.
- Criterios 7 y 9 y el caso "sin ACL" (criterio 11): solo por tests, no en vivo.
- Hook en el commit real del PO y con el diff real (índice vacío). En el repo temporal vi que el rechazo no muestra valores, pero solo revisé el encabezado del mensaje, no el formato completo "archivo y tipo" (lo cubren los tests).
- Criterio 21 (documentación) y el borrado de `_backup_git` (el PO, tras el push).
- PowerShell 7: no instalado (fuera de alcance).
- Build desde cero sin caché de BuildKit en esta máquina: no se hizo `prune`, así que el caso "apk/npm fallan sin CA con la pista" lo respalda solo el informe del desarrollador.

## Veredicto

Todo lo operativo funciona (Docker en vivo, CA fuera de las imágenes, rotaciones de contraseña de Postgres y de JWT, usuario de humo, hook, permisos, loopback, S-5, limpieza, datos intactos y 0 secretos en el barrido). Se rechaza solo por el criterio 4: B-1 es un arreglo chico (una línea en el patrón más un test). El criterio 21 queda para el documentador. Tras corregir B-1 solo hace falta repetir el caso `-Docker` sin CA y los tests de PowerShell. (Resuelto: ver "Re-test vuelta 2" arriba.)

Estado global tras el re-test de la vuelta 2: criterios 1 a 20 pasan; el 21 (documentación) es de la etapa siguiente.

VEREDICTO: APROBADO
