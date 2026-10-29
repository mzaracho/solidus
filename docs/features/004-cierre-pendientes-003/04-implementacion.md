# 04 - Implementación: 004-cierre-pendientes-003

> Autor: desarrollador. Entrada: `01-spec.md`, `00-estado.md` y `03-diseno-tecnico.md` (aprobado).
> Alcance: código y configuración versionada. **No** se hizo la parte operativa real: no se ejecutó
> `.\dev.ps1` en la raíz (ni Dev, `-Docker`, `-Stop`, `-Seed`, `-Init`, `-ExportCa`, `-CreateSmokeUser` ni
> `-RotateDbPassword`), no se rotó la contraseña, no se creó el usuario de humo, no se borraron `.bak`,
> volúmenes ni `_backup_git`, no se cambió `core.hooksPath` del repo real, no se hizo commit ni push.
> No se leyó ni imprimió ningún valor de `.env`, `backend/.env` ni de los respaldos.
> Para no repetir patrones de secretos, este documento describe los patrones y no los transcribe (el hook los
> revisa al commitear).

## 1. Resumen

Se implementó el diseño completo salvo lo que corresponde al documentador (criterio 21) y al tester
(criterios 3, 14, 16 a 19 en vivo). **No hizo falta ningún plan B**: `apk` y Turbopack toman la CA extra con
las variables previstas, y el frontend no cambió.

| Criterio | Estado |
|---|---|
| 1 CA extra opcional en los builds | Hecho y verificado con un build real (ver §5) |
| 2 `-ExportCa` | Hecho. Verificado en una copia: detecta la CA de AVG sola |
| 3 Docker en vivo | Lo hace el tester (el build con CA ya se verificó aparte) |
| 4 Código 9 y pista de certificados | Hecho y verificado con un build real que falla |
| 5 Sin `RemoteException` | Hecho y verificado |
| 6 Puerto con que se lanzó el frontend | Hecho (tests) |
| 7 Solo dígitos ASCII | Hecho (tests) |
| 8 Loopback en desarrollo | Hecho (backend, compose, script). La prueba en vivo la hace el tester |
| 9 Daemon TCP en loopback | Hecho (tests) |
| 10 `-Stop` verifica la línea de comandos (S-5) | Hecho (tests); el caso con procesos reales lo hace el tester |
| 11 Permisos de archivos (S-1) | Hecho y verificado en una copia |
| 12 Postgres fijado | Hecho: `postgres:16.11-alpine` |
| 13 `-CreateSmokeUser` | Hecho. SQL verificado contra un Postgres 16.11 descartable |
| 14 Login OK con el usuario de humo | Lo hace el tester |
| 15 Hook pre-commit | Hecho. Probado en repos temporales (unidad e integración) |
| 16 `package-lock.json` | Sin código; el PO lo commitea |
| 17 `-RotateDbPassword` | Hecho. SQL y verificación por TCP validados contra un Postgres 16.11 descartable |
| 18 y 19 Limpieza y datos | Lo hace el tester |
| 20 Calidad | Hecho (ver §6) |
| 21 Documentación | Pendiente del documentador (ver §9) |

## 2. Archivos

### Creados
| Archivo | Descripción |
|---|---|
| `docker-compose.extra-ca.yml` | Override opt-in: declara el secreto `extra_ca` (desde `.dev/certs/extra-ca.pem`) para los builds de backend y frontend |
| `backend/docker/with-extra-ca.sh`, `frontend/docker/with-extra-ca.sh` | Envoltorio idéntico (LF). Sin el secreto ejecuta el comando tal cual; con él arma un bundle temporal (sistema + CA extra) y exporta las variables de `apk`, Node y Turbopack solo para ese proceso |
| `.gitattributes` | `*.sh` y `.githooks/*` con LF (con `core.autocrlf=true` un checkout dejaría CRLF) |
| `.githooks/pre-commit` | Envoltorio `sh`: busca `powershell.exe` o `pwsh` y ejecuta `scripts/pre-commit.ps1`. Si no hay PowerShell, rechaza el commit |
| `scripts/pre-commit.ps1` | Entrada del hook (UTF-8 con BOM). Lee lo staged con `git` por `System.Diagnostics.Process`, llama a las reglas y sale con 0 o 1 (falla cerrado) |
| `scripts/secret-scan.ps1` | Reglas puras del hook (UTF-8 con BOM, sin efectos al cargarse) |
| `backend/src/infrastructure.bootstrap/config/app/listen-config.ts` | `getListenHost(config)`: lee `LISTEN_HOST`; default `127.0.0.1` (fail-closed, ver correcciones M-4) |
| `backend/src/infrastructure.bootstrap/config/app/listen-config.spec.ts` | Tests unitarios de la lectura del host |

### Modificados
| Archivo | Cambio |
|---|---|
| `backend/Dockerfile`, `frontend/Dockerfile` | Todo `RUN` con red va envuelto con el secreto de BuildKit y el script montado con `bind` (nada queda en capas): `npm install`, `npx prisma generate`, `apk add` (también en el runner del backend) y, en el frontend, `npm run build` (descarga Google Fonts) |
| `backend/.dockerignore`, `frontend/.dockerignore`, `.gitignore` | `*.pem`, `*.crt`, `*.key`, `*.pfx`, `*.p12` |
| `docker-compose.yml` | `postgres:16.11-alpine` y `LISTEN_HOST: "0.0.0.0"` en el backend |
| `backend/src/infrastructure.bootstrap/bootstrap.ts` | `app.listen(port, getListenHost(config))` |
| `.env.example`, `backend/.env.example` | `BIND_ADDRESS` ahora documenta también el modo desarrollo; `EXTRA_CA_THUMBPRINT` comentada; mención de `-CreateSmokeUser`; `LISTEN_HOST` comentada en el del backend |
| `dev.ps1` | Parameter sets `ExportCa`, `SmokeUser` (`-CreateSmokeUser`) y `Rotate` (`-RotateDbPassword` y `-Yes`); ayuda y tabla de códigos (9 y 10); `Initialize-Config` corrige permisos y activa el hook; `-Docker` usa la CA extra y sale con 9; rama "ya levantado" con el puerto lanzado; esperas con la dirección de prueba; `-Init` valida también el compose con la CA |
| `scripts/dev-lib.ps1` | Ahora es solo un cargador de 8 módulos `scripts/dev-lib.<módulo>.ps1` (ver §3 y las correcciones R-5/R-6) |
| `scripts/dev-lib.tests.ps1` | De 240 a 692 aserciones (ver §6); se ajustaron 4 tests existentes por cambios de comportamiento pedidos (tcp en loopback, argumentos de `next dev`, pista de contraseña corta, y un literal con URL con credenciales que ahora se arma en ejecución) |
| `frontend/package-lock.json` | Ya venía modificado; sin cambios míos (lo commitea el PO) |

### No tocados
`schema.prisma` y migraciones (sin cambios de schema), código del frontend, `login-query-handler.ts`,
seeds, `.env` y `backend/.env`, `.claude/CLAUDE.md`, `docs/auditoria/*`.

## 3. Qué hay en `dev-lib.*.ps1`

> Tras la pasada de correcciones (R-5/R-6) las funciones de abajo viven en `dev-lib.core.ps1` (constantes, mensajes, nativos, HTTP),
> `dev-lib.dotenv.ps1` (lectura de `.env`), `dev-lib.env.ps1` (ACL, escritura segura, `.env` raíz y backend, bind), `dev-lib.docker.ps1`,
> `dev-lib.process.ps1` (puertos, ventanas, PIDs, humo), `dev-lib.db.ps1` (Postgres, seeds, usuario de humo, rotaciones),
> `dev-lib.ca.ps1` y `dev-lib.hooks.ps1`. `dev-lib.ps1` las carga todas. Los nombres de función no cambiaron.

- **CA:** `Get-PemMarker` (cabeceras PEM armadas en ejecución), `ConvertFrom-PemBundle`,
  `ConvertTo-PemCertificate` (solo `RawData`, nunca la clave), `Get-PemThumbprints`,
  `Select-ExtraCaCandidates`, `ConvertTo-CaThumbprintList`, `Test-ExtraCaFile`, `Get-ExtraCaComposeArgs`,
  `Get-TlsHint`, `Test-CertificateIsCa`, `Get-WindowsCertificates`, `Get-PublicCaThumbprints` (`docker run
  --rm --network none`), `Get-TlsRootCertificate` (validación normal de Windows, sin aceptar cualquier
  certificado), `Get-ObservedRootCertificates` e `Invoke-ExportCa`. Detección y modo manual como el diseño.
- **Códigos 9 y 10, salida nativa:** `ConvertTo-NativeOutputText` (usado por `Invoke-Native`),
  `Invoke-Compose -ExtraFiles -OutputHints`.
- **Puerto lanzado:** `Resolve-RunningFrontendPort`; `processes.json` guarda `port` y sigue leyendo archivos viejos.
- **Bind:** `ConvertTo-BindAddress` (IPv4 estricta o IPv6 sin zona; error 1 sin mostrar el valor),
  `Get-BindAddress`, `Get-ProbeHost`, `Get-FrontendDevArgs -BindHost`, `LISTEN_HOST` derivado en
  `Sync-BackendEnv`. `Test-RootEnv` valida `BIND_ADDRESS` y `EXTRA_CA_THUMBPRINT`.
- **Daemon:** `Test-DockerEndpointLocal` acepta `tcp://localhost`, `tcp://127.0.0.1` y `tcp://[::1]`.
- **S-5:** `New-DevWindowCommand`, `Get-DevWindowExpectedPrefix`, `Get-ProcessCommandLine` (CIM),
  `Test-DevWindowCommandLine`; `Get-DevProcesses` verifica la línea de comandos contra una firma que sale de
  constantes y `RootDir`, no del archivo.
- **S-1:** `Get-OwnerOnlySids`, `New-OwnerOnlySecurity`, `Invoke-ApplyAcl`, `Set-OwnerOnlyAcl`,
  `Set-OwnerOnlyDirectoryAcl`, `Write-SecretFile` (temporal con ACL restringida y reemplazo atómico),
  `Protect-LocalSecretFiles`, `Set-DotEnvValues`. Los escritores de `.env` y `backend/.env` migraron a `Write-SecretFile`
  y el `.bak` se restringe tras copiarlo.
- **Usuario de humo:** `New-SmokeUserSql`, `Test-BcryptAvailable`, `Get-BcryptHash` (contraseña por stdin, cost 10),
  `Invoke-CreateSmokeUser`.
- **Rotación:** `New-RotatePasswordSql`, `Invoke-RotateDbPassword`.
- **Hook:** `Enable-RepoHooks`.
- La pista de contraseña corta de `Test-RootEnv` y la de `P1000` (en `dev.ps1`) ahora recomiendan `-RotateDbPassword`.

## 4. Decisiones y desvíos del diseño

Ningún desvío cambia el comportamiento pedido; son detalles de implementación.

1. **Hook: lista de archivos con `--name-only -z --no-renames`** en lugar de `--name-status -z`. Es equivalente
   para lo que se revisa (rutas agregadas, copiadas, modificadas o renombradas, estas últimas como alta) y evita
   parsear los estados. Se agregó `--no-textconv` al diff.
2. **`Get-ExtraCaComposeArgs` devuelve un objeto** `{Used; Files; Count; Path}` y no solo los argumentos, para
   poder mostrar "Usando CA extra (N certificados)" y para que `Invoke-Compose` reciba `-ExtraFiles`.
3. **`Test-DevProcessAlive` recibe `-ExpectedPrefix` opcional.** Sin él se comporta como antes (compatibilidad
   con los tests previos); `Get-DevProcesses` siempre lo pasa. Nombre de proceso distinto de `backend` o
   `frontend`: se considera no vivo.
4. **`SMOKE_USER` se guarda entre comillas simples en el `.env`.** `ConvertTo-EnvValue` solo deja sin comillas
   `[A-Za-z0-9._~-]` y la `@` del email las fuerza. Es válido para dotenv, compose y `Read-DotEnv`. No se
   cambió `ConvertTo-EnvValue` para no alterar cómo se escriben otras credenciales.
5. **Los patrones de usuario y contraseña de humo se comparan con `-cmatch`/`-cnotmatch`** (sensibles a
   mayúsculas). Un email con hex en mayúsculas no cuenta como usuario de humo de `dev.ps1`.
6. **`ConvertFrom-PemBundle` y las funciones del hook devuelven la lista sin el truco de la coma**; los
   llamadores usan `@(...)`. Con la coma, `@(f)` devolvía un arreglo con un único elemento (la lista).
7. **Los tests no parchean `Set-DotEnvValues` con `Remove-Item`**: guardan y restauran `${function:...}` para
   no perder la función real ni las demás redefiniciones.
8. **`Write-SecretFile` usa `[IO.File]::Replace(tmp, destino, [NullString]::Value)`**: pasar `$null` lo convierte
   en cadena vacía y falla con "ruta no válida".
9. **Los mensajes de los `.ps1` siguen en ASCII sin tildes** (criterio heredado del 003).
10. **La advertencia `LegacyKeyValueFormat` de `ENV NODE_ENV production`** en los Dockerfiles es preexistente
    y no se tocó.

## 5. Verificaciones

### Calidad estática
| Verificación | Resultado |
|---|---|
| `scripts/dev-lib.tests.ps1` (Windows PowerShell 5.1) | **692 OK, 0 fallidos** (antes 240). Tarda unos 12 s |
| Parser de PowerShell en `dev.ps1`, `dev-lib.ps1`, `dev-lib.tests.ps1`, `secret-scan.ps1` y `pre-commit.ps1` | 0 errores |
| BOM (`EF BB BF`) en esos 5 archivos | Presente |
| Construcciones prohibidas para 5.1 (`??`, `?.`, `-AsHashtable`, `::Fill(`, `&&`, `\|\|`) en los `.ps1` | Ninguna |
| `npx tsc --noEmit` en `backend/` y en `frontend/` | 0 errores en ambos |
| `npx eslint` sobre `listen-config.ts` y `listen-config.spec.ts` | Sin problemas |
| `npx eslint` sobre `bootstrap.ts` | 2 errores **preexistentes** (`DocumentBuilder` y `SwaggerModule` sin usar, ya están en `HEAD`); no agregué ninguno |
| `npm test` del backend | 2 suites, 22 tests OK (`jwt-config` y `listen-config`) |
| `docker compose config --quiet` en la raíz | 0, y también con `-f docker-compose.extra-ca.yml` |
| Prettier | Los archivos nuevos y `HEAD:bootstrap.ts` pasan; el `bootstrap.ts` del árbol de trabajo está en CRLF por `core.autocrlf=true` (preexistente) |

### Build Docker con la CA (proyecto de compose `solidus-ca-test`, copia en el scratchpad con `.env` ficticio)
- **Sin la CA** el build de `backend` falla igual que hoy (`apk`: `TLS: server certificate not trusted`), por lo que sin
  certificado el comportamiento no cambia. El `mount` de un secreto ausente no rompe nada.
- **Con la CA** (`-f docker-compose.yml -f docker-compose.extra-ca.yml`): **el build del backend y el del frontend
  terminan bien**. Funcionan `apk` (backend runner y frontend builder), `npm install`, `npx prisma generate` y
  `next build` con Turbopack descargando Google Fonts. Las variables previstas alcanzan; no hace falta plan B.
- **La CA no queda en la imagen**: `Config.Env` no tiene `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS` ni la variable de
  Turbopack; `/run/secrets` no existe y `/tmp` está vacío; el hash de `/etc/ssl/certs/ca-certificates.crt` es idéntico al de
  `node:22-alpine`; una búsqueda del contenido del certificado en todo el sistema de archivos de las dos imágenes
  finales no encuentra nada. `docker history` solo muestra los nombres de los scripts.
- **Código 9 real:** `Invoke-Compose` sobre un build sin la CA y con `--no-cache` sale con código **9**, con la
  pista que menciona `-ExportCa` y **0 líneas `RemoteException`** en la salida.
- Limpieza: se borraron las dos imágenes del proyecto `solidus-ca-test`; no se crearon contenedores ni volúmenes.
  Quedó la caché de BuildKit de esos builds (la gestiona Docker; no se hizo `prune`).

### `-Init`, `-ExportCa`, permisos y hook en una copia temporal (scratchpad, `git init` propio, valores ficticios)
- `-Init`: código 0; `.env` y `backend/.env` creados con ACL solo del usuario, SYSTEM y Administradores (herencia cortada);
  `backend/.env` trae `LISTEN_HOST` (solo se comprobó el nombre); `core.hooksPath` queda en `.githooks`; una segunda ejecución
  deja los dos archivos con el mismo hash.
- `-ExportCa`: código 0. Detecta **`CN=AVG Web/Mail Shield Root`** (huella 2381...9F47) sola, sin
  `EXTRA_CA_THUMBPRINT`; escribe `.dev/certs/extra-ca.pem` con 1 certificado y ningún bloque de clave; ignorado por git
  (`.gitignore` línea de `.dev/`); ACL restringida. La segunda ejecución dice "Sin cambios" y el hash no cambia. Después, `-Init`
  valida la CA y el override ("CA extra valida (1 certificado(s))").
- `-RotateDbPassword` sin `-Yes` y con stdin redirigida: cancela con código 0 sin tocar el `.env` (mismo hash).
- `-CreateSmokeUser` sin `node_modules` del backend: código 2 con la pista, sin tocar el `.env`.
- `-Yes` solo, o `-ExportCa -Docker`: los rechaza PowerShell.
- **Hook sobre el árbol real** (copia del árbol de trabajo en un repo temporal, todo en el stage): lo único que rechazó
  fue `.claude/settings.json` con permisos del harness (regla 12). Con `settings.json` igual a `HEAD`, el resto pasa. Un commit
  chico tarda alrededor de 1 s; el primero de 40 archivos, unos 6 s.

### Postgres 16.11 descartable (red propia, `tmpfs`, sin volúmenes; borrado al terminar)
Se ejecutó el SQL real de las funciones contra un contenedor `postgres:16-alpine` (16.11) con la tabla `User` como la deja la migración:
- `SHOW log_statement` = `none`.
- Usuario de humo: primera ejecución `t` (inserta), segunda `f` (actualiza); una sola fila del humo y el resto de la tabla intacto;
  un email con el formato de humo pero de otro usuario (otro nombre): **sin filas devueltas y el hash original intacto**. El hash
  generado con el `bcrypt` del backend verifica con `compareSync`.
- Rotación: el `ALTER ROLE` por el socket local funciona sin conocer la contraseña anterior; la verificación por TCP al host `db`
  acepta la nueva y rechaza la vieja y cualquier otra (pasa por la regla `scram-sha-256`, no por `trust`); ni la nueva ni la vieja aparecen
  en los logs de Postgres.

## 6. Cobertura de los tests (692 aserciones)

Todo en carpetas temporales con valores ficticios armados en ejecución; ningún literal del repo coincide con las reglas del hook.
Nuevos: archivos de build y CA (las dos copias del script idénticas y con LF, el `FROM` de ambos Dockerfiles igual a la imagen de
`-ExportCa`, cada comando de red envuelto, sin desactivar TLS, `.gitignore`/`.dockerignore`, Postgres fijado, `LISTEN_HOST`
en el compose); PEM con un certificado autofirmado creado en memoria (ida y vuelta, sin clave privada, líneas de 64, CRLF y basura
entre bloques); selección de candidatos; huellas; validación del archivo de CA; `Invoke-ExportCa` con red y almacén redefinidos
(automático, públicas, ningún host, sin CAs públicas, manual, no-CA, inexistente); código 9, pistas y `Invoke-Native` real;
`RemoteException` (unidad y prueba real con `cmd`); puerto lanzado; `[0-9]`; `BIND_ADDRESS` (válidas e inválidas), sonda,
`next dev -H`, `LISTEN_HOST`; daemon tcp (positivos y negativos); `-Stop` (acepta la ventana real; rechaza otro título, otra carpeta,
sin `-EncodedCommand`, base64 inválido, `null`, un `processes.json` forjado con un `powershell` ajeno que no se mata); ACL
(archivo, directorio, herencia, falla simulada, `Write-SecretFile`, `Protect-LocalSecretFiles`); `Set-DotEnvValues`; usuario de humo
(formatos, SQL, hash real con bcrypt y `compareSync`, flujo completo con stubs, idempotencia, email ajeno, contraseña fuera de formato, sin node);
rotación (cancelaciones, ventanas vivas, ALTER fallido, `.env` que no se puede guardar, verificación fallida, éxito, backend de
compose corriendo, `db` detenida, contraseña nunca en argumentos ni en la salida); hook de unidad (rutas, valores, un positivo y un
negativo por patrón, archivos reales versionados sin hallazgos, parser del diff, `settings.json`) y de integración (repo temporal con
`git init`: commit limpio, `.env`, valor de `JWT_SECRET`, `--no-verify`, `.env.example`, `.pem`, `settings.json` con y sin `allow`, patrón
genérico); `Enable-RepoHooks` con git redefinido.

## 7. Cómo probarlo

> Las instrucciones vigentes para el tester están al final, en "Correcciones post-revisión" (nuevo `-RotateJwtSecret` y `-Yes` de `-ExportCa`).

Estática (sin efectos): `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-lib.tests.ps1` (692 OK) y
`cd backend; npx tsc --noEmit; npm test`.

Para el **tester**, el plan del §6 del diseño con estas precisiones de lo implementado:
1. `-Init` activa el hook en el repo real (`git config --local --get core.hooksPath` debe dar `.githooks`) y restringe
   `.env`, `backend\.env`, los `.bak` y `.dev`. El hook se prueba con un commit real del PO (o con un repo temporal).
2. `-ExportCa` debe dar `CN=AVG Web/Mail Shield Root` (huella 2381...9F47), igual que en mi copia.
3. `-Docker` sin CA debe salir con **9** y la pista de `-ExportCa`; con CA, 0. Para verificar capas: `Config.Env` de las imágenes,
   `/run/secrets` inexistente y el hash del bundle igual al de `node:22-alpine`.
4. En modo desarrollo: `Get-NetTCPConnection -State Listen -LocalPort 8080,3002` en `127.0.0.1`; `-H '127.0.0.1'` en la línea
   del proceso de Next; `localhost` y `127.0.0.1` en el puerto del frontend dan 200; **el rewrite de `/api` por `localhost` (autoSelectFamily) y el SSR
   siguen siendo la verificación pendiente**. Si fallara, el plan B del diseño (§2.8) es `INTERNAL_API_URL=http://127.0.0.1:8080/api`; no se aplicó.
5. `-RotateDbPassword -Yes` (con el stack Docker arriba para ver la recreación del backend), luego `-Smoke` en los dos modos.
6. S-5: el `powershell` ajeno del tester registrado en `processes.json` debe quedar vivo tras `-Stop` (el nombre `frontend` y la hora
   coinciden, pero la línea de comandos no).
7. Orden de la limpieza y barrido final como en el diseño. Recordar que el `.env.example` de la raíz ahora trae `EXTRA_CA_THUMBPRINT`
   comentada (no se agrega sola al `.env` real).

## 8. Notas para el PO y el tester

- **Regla 12:** el harness volvió a agregar permisos a `.claude/settings.json` durante la tarea (eran 23 entradas). Se pasaron a
  `.claude/settings.local.json` las que no son amplias ni puntuales y se descartaron 7 (`cd`, `echo`, `awk`, `docker run *`).
  `.claude/settings.json` quedó igual a `HEAD`. **Hay que volver a revisarlo antes del commit**: el hook lo rechaza si se stagea con `allow`.
- **Bit de ejecución de `.githooks/pre-commit`:** en Windows no hace falta (Git for Windows decide por el `#!`). Para clones en Linux o macOS:
  `git update-index --chmod=+x .githooks/pre-commit`.
- **Primer `-Docker` tras este cambio:** descarga `postgres:16.11-alpine` y recrea `db` sobre el mismo volumen (mismo formato de datos de la 16).
- **Caché de BuildKit** de mis builds de prueba: sigue en Docker; no afecta a los contenedores ni volúmenes.
- **Copias temporales:** la copia del repo y el proyecto de prueba del scratchpad (con `extra-ca.pem` y un `.env` ficticio) se borraron al terminar.

## 9. Pendiente para el documentador (criterio 21)

`.claude/CLAUDE.md` (carpeta de configuración: no la toqué) y `docs/auditoria/COMANDOS.md` deben documentar: la CA extra y
`-ExportCa`/`EXTRA_CA_THUMBPRINT`, el usuario de humo, la rotación, el hook (activación con `-Init`, qué bloquea, `--no-verify` solo sin
secretos), los códigos 9 y 10, y el bind en loopback del modo desarrollo con `BIND_ADDRESS` y `LISTEN_HOST`. `docs/auditoria/RIESGOS.md`
(archivo local e ignorado por git) debe marcar S-1, S-5 y S-6 como resueltos.

## 10. Dudas pendientes

1. (Resuelta en R-6) El hook ya no parsea toda la biblioteca: carga solo `dev-lib.dotenv.ps1` y `secret-scan.ps1`. Un commit grande sigue tardando unos segundos por el análisis de líneas.
2. `Get-TlsRootCertificate` usa TLS 1.2 (el máximo que expone .NET Framework 4.8 en `SslProtocols`); si algún host exigiera 1.3 se informa como "no se pudo
   comprobar" y se sigue con los demás.
3. (Resuelta en M-4) `LISTEN_HOST` en `backend/.env` solo lo respeta el backend de este repo; si falta, el backend ahora escucha solo en 127.0.0.1. Antes: si alguien arrancaba el backend a mano con otro `.env`, escuchaba en todas las
   interfaces (default compatible). Es lo pedido.

## Correcciones post-revisión (R-1..R-6, M-1..M-9)

Pasada de mejoras pedida por el PO tras la aprobación de 05 y 06 (no es un rechazo). Sin cambios de comportamiento fuera de lo indicado.
Misma salvaguarda que antes: no se ejecutó `.\dev.ps1` en la raíz ni contra el `.env`/base reales; `-ExportCa`, `-RotateJwtSecret`, `-Docker` (rechazo de IPv6)
y el hook se probaron solo en copias del scratchpad con `.env` ficticio (borradas al terminar).

### Tabla hallazgo, cambio, verificación

| Hallazgo | Cambio | Verificación |
|---|---|---|
| **R-1** pista de TLS con falsos positivos | `$script:TlsErrorPattern` (en `dev-lib.core.ps1`) sin `certificate` suelto: `x509`, `server certificate not trusted`, `certificate verify failed`, `invalid peer certificate`, `SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_GET_ISSUER_CERT`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `unable to get local issuer`, `unable to verify the first certificate`, `TLS: ` | Tests: positivos (incluidos Turbopack y curl) y negativos (`Installing ca-certificates-bundle`, `bad certificate option`, un error de `tsc` que dice "certificate", `Updating certificates`) |
| **R-2** `BIND_ADDRESS` IPv6 en modo Docker | `Assert-DockerBindAddress` (env): `-Docker` la rechaza con código 1 y mensaje "en modo Docker usa una IPv4", antes de los prerrequisitos. El modo desarrollo sigue aceptando IPv6. Documentado en `.env.example` | Tests de unidad y de `dev.ps1` (la rama Docker llama a la validación; la de desarrollo no). Prueba real en copia: `-Docker` con `BIND_ADDRESS=::1` sale con 1 |
| **R-3** `.dockerignore` no recursivo | `**/*.pem`, `**/*.crt`, `**/*.key`, `**/*.pfx`, `**/*.p12` en backend y frontend | Test de los dos archivos (patrón `**/`) |
| **R-4** test frágil del backend | Se quitó el `describe('bootstrap')` que leía `bootstrap.ts` como texto | `npm test`: 2 suites, 21 tests OK; eslint y prettier limpios |
| **R-5 y R-6** archivo gigante y hook que carga todo | `dev-lib.ps1` (18 líneas) carga 8 módulos: `core`, `dotenv`, `env`, `docker`, `process`, `db`, `ca`, `hooks`. `pre-commit.ps1` carga solo `dev-lib.dotenv.ps1` (`Read-DotEnv`) y `secret-scan.ps1`. Todos los `.ps1` con BOM | Comparación de líneas entre el original y los módulos (incompleta: no detectó que `dev-lib.core.ps1` quedó con todo su contenido duplicado; corregido en la vuelta 1). Tests: existencia de cada módulo, cargador, BOM y parser de todos los `.ps1`, y un proceso aparte que carga solo `dotenv` + `secret-scan` (el repo de prueba del hook ya no recibe `dev-lib.ps1`) |
| **M-1** `-ExportCa` sin confirmación | Muestra sujeto y huella SHA-1 completa (40 hex); pide confirmación `s/N` en consola interactiva o `-Yes`; sin consola y sin `-Yes` cancela con código 0 sin escribir; si el archivo no cambia no vuelve a preguntar. `Get-TlsRootCertificate` marca `Complete` (el último certificado es autofirmado): una cadena incompleta se avisa y no cuenta. Una raíz no pública que no está en el almacén se avisa (host, sujeto, huella) y, si no queda ninguna exportable, es error 1 en lugar de concluir "son públicas". Nueva `Confirm-Action` (core) | Tests (sin red ni almacén reales): cancelar sin consola, respuestas n y vacía, s, `-Yes`, sin cambios, modo manual, raíz fuera del almacén, cadena incompleta. Prueba real en copia: sin `-Yes` cancela (código 0); con `-Yes` exporta `CN=AVG Web/Mail Shield Root` (huella completa en pantalla), 1 certificado y ninguna clave; segunda vez "Sin cambios" |
| **M-2** `POSTGRES_USER`/`POSTGRES_DB` en `-CreateSmokeUser` | Mismo patrón que la rotación, ahora en una constante común `$script:PostgresIdentifierPattern`; código 1 antes de generar nada o llamar a docker | Tests con 8 usuarios y 4 bases inválidos (espacios, comillas, `-` inicial, `;`, cadena de conexión, vacío): código 1, sin llamadas y `.env` intacto |
| **M-4** exposición en red | `Get-BindExposureWarning`/`Write-BindExposureNotice`: `Write-DevWarn` en modo desarrollo y Docker cuando `BIND_ADDRESS` no es loopback (menciona JWT sin verificar y tenant por headers). `getListenHost` ahora tiene default `127.0.0.1`. `docker-compose.yml` fija `LISTEN_HOST: "0.0.0.0"` (comprobado) y `Sync-BackendEnv` siempre escribe `LISTEN_HOST` en el `backend/.env` generado | Tests de `Test-BindAddressLoopback` y del aviso (no repite la dirección); `listen-config.spec.ts` ajustado (default y valores explícitos); los tests existentes ya verifican el `LISTEN_HOST` del compose y del `backend/.env` |
| **M-5** cobertura del hook | `Test-ForbiddenPath` bloquea `.envrc`, `*.env` (no `*.env.example`), `*.sqlite`/`*.sqlite3`, `*.db`, `*.dump`, `*.sql` en cualquier carpeta salvo `backend/prisma/migrations/**`; patrón de hash bcrypt en líneas agregadas (sin excluir archivos: los tests arman los valores en ejecución, y ningún archivo versionado contiene un hash) | Tests positivos y negativos de nombres y de patrón (hash armado en ejecución; 52 caracteres, variante `2x` y la regex de validación de `dev-lib` no disparan); integración en repo temporal (10 nombres rechazados, migración aceptada, hash rechazado sin imprimirlo). Antes de esto no había ningún `.sql`, `.db`, `.zip` ni hash en los archivos versionados |
| **M-6** límites del hook | `--diff-filter=ACMRT`; también por nombre `*.jks`, `*.keystore` y, por decisión (ver abajo), `*.zip` y `*.7z`; si falta `.env` o no tiene valores de secretos el hook avisa (sin fallar) que la regla de valores no se aplicó. Se corrigió un fallo latente: con una lista de valores vacía el hook terminaba en "error interno" (rechazaba el commit) | Tests de integración: sin `.env` pasa con aviso y siguen las reglas de archivos y patrones; `.env` sin secretos avisa; el hook usa `ACMRT` en sus dos llamadas. Hook sobre una copia del árbol real: pasa (7 s) |
| **M-7** `.dev` en el primer uso | `Protect-LocalSecretFiles` crea `.dev` si no existe y le aplica la ACL | Tests: sandbox sin `.dev` queda con la carpeta protegida, y `processes.json` nace con permisos restringidos |
| **M-8** hash en el log de Postgres | Solo documentación (ver más abajo) | n/a |
| **M-9** rotar `JWT_SECRET` | `.\dev.ps1 -RotateJwtSecret [-Yes]` (`Invoke-RotateJwtSecret` en `dev-lib.db.ps1`): confirma con `ROTAR` o `-Yes`; 32 bytes hex nuevos; cambia solo la línea `JWT_SECRET` del `.env` con `Set-DotEnvValues` (prefijo y demás líneas byte a byte, conserva CRLF); regenera `backend/.env`; si hay Docker local y el backend corre, `up -d --no-deps --no-build backend` (solo ese servicio); avisa que invalida las sesiones y, si el modo desarrollo está vivo, que hay que reiniciarlo. Sin imprimir valores | Tests con valores ficticios y funciones redefinidas (cancelaciones, `ROTAR`, `-Yes`, prefijo byte a byte, CRLF, clave ausente, backend de Docker corriendo o no, sin Docker, Docker remoto, fallos). Prueba real en copia: sin `-Yes` cancela; con `-Yes` cambia solo `JWT_SECRET` (64 hex) |

### Decisiones
- **Binarios en el hook:** se bloquean por extensión `*.pfx`, `*.p12`, `*.jks`, `*.keystore`, `*.zip` y `*.7z`. Los comprimidos no se pueden revisar por contenido y suelen esconder
  respaldos o volcados; en este repo no se versiona ninguno. Un falso positivo legítimo se resuelve con `--no-verify` (solo sin secretos) o, mejor, ampliando la regla.
  No se bloquean `.tar.gz`, `.rar` ni imágenes. Sigue siendo un hook local: la segunda barrera es activar *push protection* / *secret scanning* en GitHub.
- **Código de salida de la rotación de JWT:** no se creó un código nuevo. Se reutiliza el **10** (rotación incompleta) cuando `JWT_SECRET` ya quedó guardado pero no se pudo regenerar
  `backend/.env` o recrear el backend de Docker; la pista indica cómo terminar. Un fallo al guardar el `.env` es **1** y no cambia nada. La ayuda de `dev.ps1` documenta el 10 para ambas rotaciones.
- **`-Yes`** ahora vale para `-RotateDbPassword`, `-RotateJwtSecret` y `-ExportCa`. Solo, o con otro modo, lo rechaza PowerShell.
- **`Complete` en `Get-TlsRootCertificate`:** una cadena que no termina en un certificado autofirmado se trata como "no se pudo comprobar" ese host, no como una raíz candidata.
- **Hallazgo colateral:** el fallo latente del hook con `$null` en `Find-SecretValueHits` (sin `.env` o sin secretos) existía desde la primera versión y hacía que un clon sin `.env` no pudiera commitear; corregido y con test.

### Para el documentador (M-8)
Si el SQL de `-CreateSmokeUser` falla (con `ON_ERROR_STOP`), Postgres puede dejar la sentencia, que incluye el **hash bcrypt** (no la contraseña) de la contraseña de humo, en
`docker compose logs db`. Impacto bajo (es un hash de un usuario de humo sin organización ni roles, en una base local). Documentarlo en `docs/auditoria/COMANDOS.md`
junto al usuario de humo, con la recomendación de rotar la contraseña de humo (vaciar `SMOKE_USER` y `SMOKE_PASSWORD` en `.env` y repetir `-CreateSmokeUser`) si ese log se comparte.
También documentar `-RotateJwtSecret`, la confirmación de `-ExportCa`, el aviso por `BIND_ADDRESS` no loopback, el rechazo de IPv6 en modo Docker y el default `127.0.0.1` de `LISTEN_HOST`.

### Resultados de las verificaciones
| Verificación | Resultado |
|---|---|
| `scripts/dev-lib.tests.ps1` (Windows PowerShell 5.1; es el único archivo de tests de PowerShell) | **944 OK, 0 fallidos** (antes 692) |
| Parser y BOM de `dev.ps1` y los 12 `.ps1` de `scripts/` | 0 errores; todos con BOM, LF |
| Construcciones prohibidas para 5.1 (`??`, `?.`, `-AsHashtable`, `::Fill(`, `&&`, `\|\|`) | Ninguna |
| `npx tsc --noEmit` en `backend/` y `frontend/` | 0 errores |
| `npx eslint` sobre `listen-config.ts` y `listen-config.spec.ts`; `prettier --check` | Limpios (`bootstrap.ts` sí se modificó: usa `getListenHost`; sus 2 errores de eslint son preexistentes) |
| `npm test` del backend | 2 suites, 21 tests OK |
| `docker compose config --quiet`, con y sin `-f docker-compose.extra-ca.yml` | 0 y 0 |
| Pruebas en copias del scratchpad (borradas) | `-ExportCa` (sin `-Yes` cancela; con `-Yes` exporta la CA de AVG), `-RotateJwtSecret`, `-Docker` con IPv6 (código 1) y hook sobre una copia del árbol real (pasa) |

### Instrucciones actualizadas para el tester
Se mantienen las del §7, con estos cambios y agregados:
1. **`-ExportCa` ahora pide confirmación.** Interactivo: revisar sujeto y huella SHA-1 completa contra `certmgr.msc` (debe ser `CN=AVG Web/Mail Shield Root`, huella `2381...9F47`) y responder `s`.
   Sin consola interactiva (o en un script): `.\dev.ps1 -ExportCa -Yes`. Sin `-Yes` y sin consola cancela con código 0 y no escribe nada. Una segunda ejecución con el archivo igual no vuelve a preguntar.
2. **Nuevo `.\dev.ps1 -RotateJwtSecret` (`-Yes` opcional; escribir `ROTAR` si es interactivo).** Probar con el stack Docker arriba: se recrea solo el backend (`docker compose ps` debe mostrar `db` y `frontend` sin recrearse),
   el `.env` cambia únicamente la línea `JWT_SECRET` (comparar el resto con un respaldo propio, sin imprimir valores), `backend\.env` tiene el valor nuevo, y las sesiones abiertas dejan de valer (volver a iniciar sesión).
   Con el modo desarrollo levantado, avisa que hay que reiniciarlo (`-Stop` y `.\dev.ps1`). Luego `-Smoke` en los dos modos.
3. **`BIND_ADDRESS`:** con `0.0.0.0` o una IP de LAN, `.\dev.ps1` y `.\dev.ps1 -Docker` muestran el aviso de exposición. Con una IPv6, el modo desarrollo funciona y `-Docker` sale con código 1 y "usa una IPv4".
   Backend arrancado a mano sin `LISTEN_HOST`: escucha solo en 127.0.0.1.
4. **`-CreateSmokeUser`** con `POSTGRES_USER` o `POSTGRES_DB` raros en `.env` sale con 1 antes de tocar nada (no hace falta probarlo en vivo).
5. **Hook:** `.sql` fuera de `backend/prisma/migrations`, `.envrc`, `*.env`, `*.sqlite`, `*.db`, `*.dump`, `*.jks`, `*.keystore`, `*.zip`, `*.7z` y los hashes bcrypt en líneas agregadas se rechazan; en un clon sin `.env` el commit
   pasa con un aviso. Probarlo con un repo temporal (no cambiar `core.hooksPath` del repo real salvo el `-Init` que ya está en el plan).
6. **`.dev` en el primer uso:** tras `-Init` en el repo real, `icacls .dev` debe mostrar solo el usuario, SYSTEM y Administradores aunque no hubiera ejecuciones previas.
7. **Regla 12:** revisar `git diff .claude/settings.json` antes del commit (el harness vuelve a agregar permisos).

## Corrección vuelta 1 (re-revisión)

| Hallazgo | Cambio | Verificación |
|---|---|---|
| **M-1 / N-1** (mayor) `dev-lib.core.ps1` con las líneas 210-389 repetidas | Verificado con `diff` que 29-208 y 210-389 eran idénticas; se borró el bloque duplicado (el archivo pasa de 389 a 208 líneas). Los otros 7 módulos no tienen funciones ni constantes repetidas. Tests nuevos: ninguna `^function <nombre>` aparece más de una vez en los `dev-lib*.ps1` (sin el de tests) y ningún `$script:Nombre =` se asigna más de una vez en la biblioteca. No hay redefiniciones legítimas de constantes. | `diff` idéntico antes de borrar; tests nuevos en verde |
| **m-1** comentario de uso | `scripts/dev-lib.ps1:2`: `. .\scripts\dev-lib.ps1` | lectura del archivo; BOM y parser OK |
| **m-2** afirmaciones inexactas | Corregido en este documento: `bootstrap.ts` sí se modificó (usa `getListenHost`) y la comparación de líneas de la división en módulos no detectó la duplicación | revisión del texto |
| **N-2** `Set-DotEnvValues` y claves duplicadas | `Assert-DotEnvKeysUnique` (en `dev-lib.env.ps1`): falla con código 1 nombrando la clave (sin valores) si aparece más de una vez. Lo llama `Set-DotEnvValues` antes de escribir y, además, `Invoke-RotateDbPassword` (antes del `ALTER ROLE`, sin tocar la base) e `Invoke-RotateJwtSecret` (antes de pedir confirmación). Después de escribir, `Set-DotEnvValues` relee con `Read-DotEnv` y compara en memoria que el valor efectivo es el nuevo; si no, falla con código 1 sin imprimir. | Tests con valores ficticios: duplicada no escribe y el mensaje no incluye valores; duplicado de otra clave no bloquea; verificación posterior falla si el efectivo no coincide; rotación de base con duplicada da 1, no llama a docker y deja el `.env` intacto; rotación de JWT idem |

Verificaciones: tests de PowerShell 958 OK, 0 fallidos; parser y BOM (sin BOM doble) de todos los `.ps1` OK; sin construcciones prohibidas para 5.1; `npx tsc --noEmit` del backend sin errores; `npm test` del backend 2 suites, 21 tests; `docker compose config --quiet` con y sin `-f docker-compose.extra-ca.yml` OK; `.claude/settings.json` igual a `HEAD`.

## Corrección vuelta 2 (hallazgos del tester)

No se ejecutó `dev.ps1` en modo real, ni builds ni contenedores; no se tocó `.env`, `backend/.env` ni `.claude/`.

| Hallazgo | Cambio | Archivos |
|---|---|---|
| **B-1** (obligatorio) pista de `-ExportCa` ausente en el error de Turbopack | `$script:TlsErrorPattern` suma `TLS-related` y `Error while requesting resource`. Sigue sin `certificate` suelto | `scripts/dev-lib.core.ps1:26` |
| **H-2** `prisma migrate deploy` descarga el schema engine en runtime | Nuevo `RUN` en el builder: `sh /tmp/with-extra-ca.sh npx prisma -v` (con el secreto y el script montados como los demás, sin dejar la CA en capas). `prisma generate` solo baja el query engine (y `binaryTargets` solo cubre ese); `prisma -v` descarga el schema engine a `node_modules/@prisma/engines`, que ya se copia al runner. Sin CA se comporta como antes | `backend/Dockerfile:18-23` |
| **N-3** `-Stop` con `processes.json` ilegible | Nuevas `Test-DevStateReadable` (false si el JSON está mal formado o una entrada no tiene pid/startTime/name válidos; nunca devuelve el contenido) y `Get-DevStateUnreadableMessage`. `Invoke-StopMode` avisa con `Write-DevWarn` que el registro no se pudo leer y que hay que cerrar a mano las ventanas de dev.ps1. No se mata nada no verificado (`Stop-DevProcesses` no cambió) | `scripts/dev-lib.process.ps1` (tras `Get-DevProcesses`), `dev.ps1` (`Invoke-StopMode`) |

Tests agregados (958 -> 974):
- B-1: 3 positivos (`Error while requesting resource`, `TLS-related` con el hint de Turbopack, el error de conexión a fonts.googleapis.com) y 3 negativos (`Compiled successfully`, `Error while compiling resource map`, `related resources were requested`).
- N-3: JSON inválido, pid no numérico y entrada sin pid son ilegibles; registro válido, lista vacía y sin archivo son legibles; el aviso pide cerrar a mano; `dev.ps1` llama a la verificación antes de `Stop-DevProcesses` y muestra el aviso.
- H-2: el `RUN` de `npx prisma -v` debe ir envuelto con `with-extra-ca.sh` (test existente ampliado) y aparecer antes del `AS runner`.

Verificaciones: `scripts\dev-lib.tests.ps1` **974 OK, 0 fallidos**; parser sin errores en `dev.ps1` y todos los `scripts/*.ps1`; BOM único en los editados; `docker compose config --quiet` con y sin `-f docker-compose.extra-ca.yml`: 0 y 0. No toqué TypeScript, por eso no corrí `tsc`.

No pude hacer / dudas:
- **H-2 no está verificado con un build** (la regla prohíbe builds de Docker). La causa (schema engine sin descargar en el build) es una inferencia desde el log del tester y de cómo funciona Prisma 5.22. El tester debe correr `-Docker` con CA y comprobar que el log del backend ya no muestra `binaries.prisma.sh` en `migrate deploy`, idealmente con una base nueva. Si siguiera descargando, la alternativa es fijar el engine con `PRISMA_SCHEMA_ENGINE_BINARY` o aplicar las migraciones desde un paso del build/host; lo decide el PO.
- B-1 con el error real de Turbopack solo está cubierto por tests de patrón; falta repetir `-Docker` sin CA (debe dar código 9 con la pista de `-ExportCa`).
- `.claude/settings.json` ya figuraba modificado en `git status` al empezar; no lo toqué. Revisarlo antes de commitear (regla 12).

### H-2 completado tras la re-revisión

**Confirmado (lectura de código, sin builds).** El diagnóstico del revisor es correcto y mi `RUN npx prisma -v` solo no alcanzaba:
- `backend/node_modules/@prisma/engines/dist/scripts/postinstall.js:88-102`: el `postinstall` de `@prisma/engines` (corre en `npm install`) descarga el schema engine y el query engine del CLI para la plataforma que Prisma detecta, salvo que `PRISMA_CLI_BINARY_TARGETS` (lista separada por comas) la reemplace. Es la única variable de ese flujo.
- La detección usa la presencia de `openssl` en el sistema. `node:22-alpine` no lo trae, así que el builder se detecta como `linux-musl` (sin versión de openssl) y baja `schema-engine-linux-musl`. El runner instala `openssl` (3.x), se detecta `linux-musl-openssl-3.0.x`, busca ese schema engine, no lo encuentra y lo descarga en runtime, sin CA.
- `backend/prisma/schema.prisma:3` ya declara `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`: eso cubre el query engine (`libquery_engine-linux-musl-openssl-3.0.x.so.node`), no el schema engine del CLI.

**Cambio** (`backend/Dockerfile`):
- Líneas 9-13: nuevo `RUN ... sh /tmp/with-extra-ca.sh apk add --no-cache openssl` en el builder, antes de `npm install` (envuelto como el resto, CA solo vía secret/bind montados en ese `RUN`). Así el builder se detecta igual que el runner y `postinstall`/`prisma -v` bajan los engines correctos.
- Se mantiene `npx prisma -v` (ahora válido: baja el schema engine de la plataforma correcta si el `postinstall` no lo hizo).
- Líneas finales del bloque de dependencias: `RUN test -f .../schema-engine-linux-musl-openssl-3.0.x && test -f .../libquery_engine-linux-musl-openssl-3.0.x.so.node`. Es un paso de verificación sin red: si falta un engine, el build falla en el builder y no en runtime.
- Sin `ENV PRISMA_*`, sin cambiar la imagen base, sin desactivar TLS, sin CA en capas. Sin CA, el build es el de antes más el paquete `openssl`.

**Menor de N-3** (`scripts/dev-lib.process.ps1:240`): el mensaje ahora dice "puede haber ventanas de backend/frontend de dev.ps1 sin detener (con un registro parcialmente válido se pudo detener alguna): cerralas a mano". Ya no afirma que no se detuvo ninguna.

**Tests** (`scripts/dev-lib.tests.ps1`): el envoltorio de CA ya cubría `apk add`; se agregó que el builder instala `openssl` antes de `npm install`/`prisma generate`/`prisma -v`, que verifica los dos engines, que no hay `ENV PRISMA_*`, y para N-3 que el aviso no dice "no se detuvo ninguna" y sí "sin detener".

**Cómo verificarlo en vivo (tester).** Con `-Docker` y con la CA extra (red con inspección TLS):
1. Tras el build, en la imagen del backend: `docker compose run --rm --no-deps backend ls node_modules/@prisma/engines` debe listar `schema-engine-linux-musl-openssl-3.0.x`; y `ls node_modules/.prisma/client` debe incluir `libquery_engine-linux-musl-openssl-3.0.x.so.node`. Si el engine faltara, el build ya falla en el paso `test -f`.
2. En el log del backend al arrancar, `prisma migrate deploy` no debe mostrar descargas (`Downloading ... binaries.prisma.sh`, "Environment variable not found"/errores de certificado ni `self-signed certificate`) y debe terminar con las migraciones aplicadas o "No pending migrations".
3. Sin CA en una red sin inspección el build debe pasar igual. Riesgo no verificado: si Prisma 5.22 nombrara el archivo distinto de `schema-engine-linux-musl-openssl-3.0.x`, el `test -f` fallaría en el build (el nombre sale del patrón `schema-engine-<plataforma>` y de los de Windows en `@prisma/engines`); ajustar el nombre si ocurre.

**Resultados:** `scripts/dev-lib.tests.ps1` 980 OK, 0 fallidos (antes 974); parser sin errores en `dev.ps1` y todos los `scripts/*.ps1`, un solo BOM; `docker compose config --quiet` con y sin `-f docker-compose.extra-ca.yml`: 0 y 0. No ejecuté builds, contenedores ni `dev.ps1` real.
