# 04 - Implementación: 003-arranque-local-rapido

> Autor: desarrollador. Entrada: `01-spec.md` y `03-diseno-tecnico.md` (aprobado).
> No se imprimió ni se copió ningún valor de `.env` ni de `backend/.env`. No se hizo commit ni push.
> `.\dev.ps1` **no** se ejecutó en modo real contra los `.env` del usuario: eso lo hace el tester.

## 1. Paso 0: volúmenes (resultado)

Solo lectura. Docker Desktop estaba apagado y se inició.

| Volumen | Proyecto | Usado por | Contenido |
|---|---|---|---|
| `healthops-gem_solidus_postgres_data` | raíz (`healthops-gem`) | `healthops-gem-db-1` (el compose raíz) | **Datos de trabajo**: 8 usuarios, 3 organizaciones, 72 pacientes, 324 WorkItems (total 407 filas en las tablas principales) |
| `backend_postgres_data` | `backend` (compose viejo) | ningún contenedor | Directorio de datos de Postgres de unos 63 MB (`PG_VERSION`, `base`, `global`). No se levantó Postgres sobre él, por lo que no se contaron filas |
| `healthops-gem_healthops_postgres_data` | raíz (más viejo) | nadie | Sin tocar |

Conclusión: los datos de desarrollo están en el volumen del compose de la raíz. No se cumple la condición
de frenar ("solo en el de `backend/`"), así que se **eliminó `backend/docker-compose.yml`**. No se migró
ni se borró ningún dato, volumen ni contenedor. `backend_postgres_data` queda huérfano. Cada ejecución
de `dev.ps1` lo avisa (R-1 del diseño).

Efectos secundarios de la verificación:
- Se descargó la imagen `alpine:latest` para montar los volúmenes en solo lectura (`du`). No modifica datos.
- El contenedor `healthops-gem-db-1` quedó corriendo (por `restart: always`). El `restart:
  unless-stopped` nuevo aplica cuando se recree el contenedor.

## 2. Archivos

### Creados
| Archivo | Descripción |
|---|---|
| `dev.ps1` | Punto de entrada. Parameter sets `Dev` (por defecto), `Docker`, `Stop`, `Smoke`, `Init`; `-Seed` en `Dev` y `Docker`. Ayuda con `Get-Help .\dev.ps1`. UTF-8 con BOM |
| `scripts/dev-lib.ps1` | Funciones sin efectos al cargarse: `.env`, prerrequisitos, puertos, `npm install` con sello, Postgres, ventanas y PIDs, seeds, prueba de humo. UTF-8 con BOM |
| `scripts/dev-lib.tests.ps1` | 93 aserciones sin Pester (runner propio). UTF-8 con BOM |
| `frontend/.env.example` | Plantilla opcional, solo comentarios. Queda versionable (`!.env.example` en `frontend/.gitignore`) |

### Modificados
| Archivo | Cambio |
|---|---|
| `docker-compose.yml` | Sin `version`, sin `CORS_ORIGIN`, build arg `NEXT_PUBLIC_API_BASE_URL: "${NEXT_PUBLIC_API_BASE_URL:-http://localhost:8080/api}"`, `db` con `restart: unless-stopped`. Sin IP de red local |
| `.env.example` | Agrega `NEXT_PUBLIC_API_BASE_URL`, `SMOKE_USER`, `SMOKE_PASSWORD` y comentarios (solo placeholders) |
| `backend/.env.example` | Reescrito como referencia: sin `POSTGRES_*`, aclara que `backend/.env` lo genera `dev.ps1` |
| `frontend/src/services/data.ts` | Default SSR `http://backend:8080/api` pasa a `http://localhost:8080/api`, con comentario. En Docker lo sigue definiendo el compose |
| `.gitignore` | Agrega `.dev/` |

### Eliminado
- `backend/docker-compose.yml` (tras el paso 0).

### Sin cambios (como el diseño)
Código del backend, `schema.prisma`, Dockerfiles, `.dockerignore`, `next.config.ts`, `login/page.tsx`,
`.claude/launch.json`. No hay migraciones.

### Pendiente para el documentador (criterio 17)
Siguen apuntando a `backend/docker-compose.yml` o a la IP de LAN: `.claude/CLAUDE.md`,
`docs/auditoria/COMANDOS.md`, `docs/auditoria/ARQUITECTURA.md`, `docs/auditoria/RIESGOS.md`,
`docs/auditoria/CLAUDE.borrador.md`. No se tocaron.

## 3. Decisiones

- **Cadena de errores:** las funciones lanzan una excepción con `Data['ExitCode']` y `Data['Hint']`;
  `dev.ps1` imprime `ERROR:` y `Como resolverlo:` y sale con el código (tabla 2.3.6 del diseño).
- **`Invoke-Native`** muestra la salida y la captura para elegir la pista según el contenido
  (`P1000` en `migrate deploy`, `EPERM` en `generate`).
- **Archivo de PIDs** `.dev/processes.json` escrito apenas se lanza cada ventana; un PID cuenta como vivo
  solo si el proceso es `powershell`/`pwsh` y coincide `StartTime`. `-Stop` usa `taskkill /T /F` y
  luego `docker compose stop`. Nunca `down` ni `-v`.
- **Seeds:** la detección de destructivos es por contenido. Con `-Seed`, si la base tiene filas (>0) hace
  falta escribir `BORRAR` (si hay destructivos) o `s` (si no); sin consola interactiva cancela. Probado
  contra la base real **sin ejecutar nada**: en este entorno cancela y no modifica la base.
- **Humo:** `GET /` del backend, `GET /login` del frontend (3001 si el servicio `frontend` de compose está
  corriendo, si no 3000) y login con `SMOKE_*` (salteado con aviso si faltan o son `change-me`).
- **Mensajes en ASCII sin tildes** (desvío menor, ver sección 5).

## 4. Verificaciones (criterio 16)

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` en `frontend/` | 0 errores |
| `npx tsc --noEmit` en `backend/` | 0 errores |
| `npx eslint src/services/data.ts` (frontend) | 13 errores y 2 advertencias, **todos preexistentes**: el archivo original en `HEAD` da exactamente lo mismo (15 problemas) |
| `npx eslint` en el backend | No aplica: no se tocó ningún `.ts` del backend |
| `docker compose config --quiet` | Código 0 (sin la advertencia de `version`) |
| Prueba negativa con `--env-file` vacío | Sigue fallando con los mensajes `:?` de `POSTGRES_*` y `JWT_SECRET` |
| `scripts/dev-lib.tests.ps1` (Windows PowerShell 5.1) | 93 OK, 0 fallidos |
| Parser de PowerShell sobre los 3 `.ps1` | 0 errores. Los 3 empiezan con `EF BB BF` |
| Búsqueda de construcciones prohibidas (`??`, `?.`, `-AsHashtable`, `::Fill(`, `&&`, `\|\|`) | Sin coincidencias |
| `git check-ignore -v` | Ignorados: `.dev/processes.json`, `.env`, `backend/.env`, `backend/.env.pre-003.bak`, `frontend/.env.local`. **No** ignorado: `frontend/.env.example` |
| Combinaciones inválidas (`-Seed -Stop`, `-Docker -Stop`) | Las rechaza PowerShell |

### `-Init` en copia temporal (simula clon nuevo)
Copia de `git ls-files -co --exclude-standard` en el scratchpad, sin `.env` ni `backend/.env`:
- `-Init` sale con 0. Crea `.env` (variables en orden; contraseña de 48 y JWT de 64 caracteres, usuario
  `solidus`) y `backend/.env` con cabecera de generado. Verificado: sin BOM, `DATABASE_URL` hacia
  `localhost:5433`, y **ningún secreto aparece en la salida**.
- Segunda ejecución: hashes de ambos archivos sin cambios.
- Se borró `SMOKE_USER` y se volvió a ejecutar: se re-agrega y el resto queda igual.
- `-Smoke` sin nada levantado: código 7 con mensajes claros y aviso de login saltado.
- `docker compose config --quiet` dentro del clon: OK.

### Copia de los `.env` reales (solo en el scratchpad, ya borrada)
Se probó `-Init` sobre una copia de `.env` y `backend/.env` actuales de esta máquina (caso 3 del diseño):
- Código 0. El `.env` nuevo empieza **byte a byte** con el anterior y agrega solo
  `NEXT_PUBLIC_API_BASE_URL`, `SMOKE_USER` y `SMOKE_PASSWORD`.
- Aviso emitido: la única diferencia entre los dos archivos es **`JWT_SECRET`** (los `POSTGRES_*` y la
  `DATABASE_URL` coinciden con el `.env` raíz). Se usa el de la raíz: invalida sesiones abiertas, sin otro
  efecto (hoy los JWT no se verifican, S1).
- `backend/.env` regenerado conserva `NODE_TLS_REJECT_UNAUTHORIZED`, `CORS_ORIGIN` y `CORS_METHODS`,
  sin `POSTGRES_*`. Se creó `.env.pre-003.bak`.
- Esa copia contenía secretos reales: se eliminó junto con el clon.

### Lecturas de solo lectura contra el entorno real
Con las funciones de la biblioteca (sin tocar archivos): prerrequisitos OK, `db` corriendo, Postgres
acepta conexiones, conteo de filas 407, plan de seeds correcto, aviso del volumen huérfano.

## 5. Desvíos del diseño

1. **Mensajes sin tildes ni eñes.** El diseño preveía tildes. Se usó ASCII en los textos de los `.ps1`
   (los archivos igual llevan BOM) para que no se rompan en consolas con otra página de códigos. Es
   solo cosmético y se puede cambiar.
2. **Aviso de diferencias entre `.env`:** redactado como "Valores distintos entre backend/.env y .env
   (variables: ...)" en lugar del ejemplo del diseño. Mismo contenido: solo nombres.
3. **PowerShell 7 no se instaló** (decisión del PO). La compatibilidad con 7 se verificó solo de forma
   estática (parser de 5.1 y lista de construcciones prohibidas). El código usa solo APIs de 5.1 y 7.
4. **`ls-files -co` incluyó `docs/features/`** en la copia: irrelevante para las pruebas.

## 6. Hallazgos para el PO y el tester

1. **Puerto 3000 ocupado ahora mismo**: `node` (PID 19988), con `ProcessContainerFork.js` de **pm2**
   (el `settings.local.json` menciona `pm2 ls`). Es un proceso del usuario; no se tocó. `.\dev.ps1` fallará
   con código 2 hasta que se libere (por ejemplo `pm2 ls` y `pm2 stop <app>`, decisión del usuario).
   Los puertos 8080 y 3001 están libres. El 5433 lo publica `healthops-gem-db-1` (propio).
2. **`frontend/node_modules` desactualizado respecto del lock**: `package-lock.json` es más nuevo que
   `node_modules/.package-lock.json`, así que la primera ejecución correrá `npm install` en
   `frontend/`. Revisar `git status` después, por si cambia `package-lock.json`. En `backend/` solo se
   escribirá el sello.
3. **Archivo `.claude/settings.json` (regla 12):** se movieron 5 permisos agregados por el harness a
   `settings.local.json` (sin duplicar; el `defaultMode` ya estaba ahí). `settings.json` quedó con
   `allow` vacío y sin `defaultMode`: `git diff` no muestra diferencias, aunque `git status` lo puede
   seguir marcando por el aviso de fin de línea. **Volver a revisarlo** al cierre, porque cada comando
   aprobado vuelve a ensuciarlo.
4. `LoggingInterceptor` sigue logueando contraseña y token en el login (fuera de alcance).
5. El `.env.pre-003.bak` contendrá los valores viejos: sugerir borrarlo cuando todo funcione.

## 7. Instrucciones para el tester (criterio 15)

Restricciones: no imprimir valores de `.env`; nunca `docker compose down -v` ni `volume rm`; no cargar
seeds contra la base real. Ejecutar con
`powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 ...` desde la raíz.

**A. Línea base (Docker encendido)**
1. SHA-256 de `.env` y `backend/.env`, y nombres de variables de cada uno.
2. `docker volume ls --format '{{.Name}}'` (guardar la lista).
3. Conteos de solo lectura: esperados 8 usuarios, 3 organizaciones, 72 pacientes, 324 WorkItems (407). Con
   `docker exec -i healthops-gem-db-1 psql -U <usuario> -d <base> -tA`, consulta por stdin.
4. `npx prisma migrate status` en `backend/` (solo lectura). Si hay migraciones pendientes, avisar al PO.
5. Liberar el puerto 3000 (hallazgo 1) con la autorización del usuario.
6. Opcional: el usuario completa `SMOKE_USER` y `SMOKE_PASSWORD` en `.env` (el tester no los escribe).

**B. Modo desarrollo (requiere OK del PO: primera modificación real de `.env` y `backend/.env`)**
1. `.\dev.ps1` -> código 0. Esperado: `.env` conserva su prefijo (comparar hash del prefijo con la línea
   base) y agrega 3 variables; `backend/.env` empieza con `# GENERADO por dev.ps1` y no tiene `POSTGRES_*`;
   existe `backend/.env.pre-003.bak`; aviso con solo el nombre `JWT_SECRET`; `npm install` en `frontend/`.
   Se abren dos ventanas ("Solidus backend (dev.ps1)" y "Solidus frontend (dev.ps1)").
2. `http://localhost:8080/` responde 200 y se muestran las tres URLs.
3. SSR: login en `http://localhost:3000` y dashboard con datos. En la ventana del frontend no debe haber
   `ENOTFOUND backend` ni `ECONNREFUSED`.
4. `.\dev.ps1 -Smoke` -> código 0 (login OK o saltado).
5. Segunda ejecución de `.\dev.ps1` -> "El entorno ya esta levantado" y sin ventanas nuevas.
6. `.\dev.ps1 -Seed` con la entrada redirigida (por ejemplo `echo no | powershell ... -Seed`) -> "Seeds
   cancelados"; conteos iguales a A.3. Con consola interactiva: aparece la advertencia; responder otra
   cosa que `BORRAR` cancela. **No** escribir `BORRAR`.
7. `.\dev.ps1 -Stop` -> ventanas y node cerrados, 8080 y 3000 libres, `db` detenido, mismos volúmenes que A.2.
8. Conteos iguales a A.3. `git status` solo con los archivos de la sección 2. Revisar que
   `package-lock.json` no cambió (hallazgo 2).
9. Buscar en la salida capturada los valores de `POSTGRES_PASSWORD`, `JWT_SECRET` y `SMOKE_PASSWORD`
   (leídos en memoria): 0 coincidencias.

**C. Modo Docker**
1. Con el modo desarrollo levantado, `.\dev.ps1 -Docker` -> código 2 ("Detene primero...").
2. `.\dev.ps1 -Stop` y luego `.\dev.ps1 -Docker` -> código 0 y URL `http://localhost:3001`. Si el build falla
   por Google Fonts (TLS), registrarlo como preexistente.
3. `.\dev.ps1 -Smoke` -> frontend en 3001. Login en el navegador en 3001.
4. `git grep -n "192\.168\."` sin resultados fuera de `docs/`.
5. `.\dev.ps1 -Stop` -> contenedores `Exited`, volúmenes intactos.

**D. Clon nuevo simulado**: ya probado por el desarrollador (sección 4). El tester lo repite en
`%TEMP%\solidus-clone-003`: copiar `git ls-files -co --exclude-standard`, `-Init` (0, sin secretos en la
salida, largos 48 y 64), segunda ejecución sin cambios, `-Smoke` -> 7. No ejecutar `.\dev.ps1` completo en el
clon. Borrar la carpeta al final.

**E. PowerShell 7**: solo estático (no instalado), salvo que el usuario autorice instalarlo.

## 8. Dudas pendientes

1. ¿El usuario quiere tildes en los mensajes del script (desvío 1)?
2. ¿Qué hacer con el volumen huérfano `backend_postgres_data` (63 MB, sin contenedor)? No se tocó. Si el
   usuario sabe que no tiene datos útiles, puede borrarlo a mano más adelante.
3. El proceso pm2 en el puerto 3000: ¿es el frontend del usuario? Determina cómo prueba el tester.

## 9. Correcciones vuelta 1

Origen: `05-revision.md` (RECHAZADO, vuelta 1 de 3). M-5, S-2 y S-3 no se tocaron (son del documentador y del backlog). Las lineas indicadas son las actuales de cada archivo.

| Hallazgo | Que cambio | Verificacion |
|---|---|---|
| **B-1** `Get-DevProcesses` fallaba con 2 entradas en PowerShell 5.1 | `scripts/dev-lib.ps1`, `Get-DevProcesses` (desde la linea ~735): el resultado de `ConvertFrom-Json` se aplana con `$parsed \| ForEach-Object { $_ }` (5.1 no enumera el array). Ademas, cada entrada se convierte dentro de `try`: una entrada corrupta se omite en vez de cortar todo. Es el unico `ConvertFrom-Json` del repo (se busco en todos los `.ps1`; no hay otros) | Tests nuevos de ida y vuelta de `Save-DevProcesses`/`Get-DevProcesses`/`Stop-DevProcesses` con 0, 1 y 2 entradas, PIDs inexistentes (999991..999993), objeto unico, JSON invalido y registro en carpeta temporal. Sin tocar procesos reales: el unico PID real usado es el del propio test, con `StartTime` distinto, y se comprueba que no se mata |
| **M-1** `StartTime` en 0 | `Start-DevWindow` (~linea 800): hasta 5 intentos con `$p.Refresh()` y pausa de 200 ms. Si no se logra leer, avisa con el PID y corta con `Stop-Dev` (codigo 5) pidiendo cerrar la ventana a mano. Nunca registra 0 | Revision estatica y parser. No se probo con una ventana real (lanzaria procesos); el camino de error es corto y usa `Stop-Dev` ya probado |
| **M-2** conteo de filas solo en 4 tablas | `Get-DatabaseRowCount` (~linea 860): cuenta con `count(*)` real todas las tablas de `public` (lista de `pg_stat_user_tables`, via `query_to_xml`; excluye `_prisma_migrations`). Si no se puede determinar devuelve `-1` en vez de abortar. `Confirm-SeedExecution`: solo continua sin preguntar si el conteo es exactamente `0`; con `-1` o `>0` pregunta (y sin consola cancela). Los mensajes dicen "puede tener datos" | Consulta de solo lectura ejecutada contra la base local con la funcion real: devolvio un total mayor que las 407 filas de las 4 tablas anteriores (hay datos en otras tablas, justo el caso del hallazgo). Tests con funciones redefinidas para `-1`, `0` y `>0` |
| **M-3** `.bak` existente no se refrescaba | `Sync-BackendEnv` (~linea 396): si ya existe `.env.pre-003.bak` se crea otro `.env.pre-003.<aaaaMMdd-HHmmss>.bak` (con sufijo `-n` si choca). Siempre se respalda un `backend/.env` heredado. El aviso nombra el archivo real | `git check-ignore -v backend/.env.pre-003.20261026-101500.bak` (y la variante `-1`): ignorados por `.gitignore:25 .env.*`. Test: segundo heredado genera un respaldo con sello, el original queda intacto y el nuevo es copia del heredado |
| **M-4** aviso de migracion incompleto | `Sync-BackendEnv`: agrega el aviso "Los comentarios y las lineas no parseables del backend/.env anterior NO se migraron: quedan solo en esa copia (.bak)" | Test: el aviso aparece; un comentario del heredado no pasa al archivo nuevo y queda en el `.bak` |
| **M-6** `-Quiet` sin uso | `dev.ps1:65`: `Initialize-Config` ya no declara parametros (ningun llamador lo usaba) | Parser sin errores; `.\dev.ps1 -?` sigue mostrando la ayuda |
| **S-1** tests de seeds | `scripts/dev-lib.tests.ps1`: redefine `Test-InteractiveConsole`, `Read-Host`, `Get-ComposeRunningServices`, `Get-DatabaseRowCount`, `Invoke-Compose` e `Invoke-ComposeCapture`; prueba `Confirm-SeedExecution` (sin consola cancela, `BORRAR` exacto continua, `borrar`/`BORRAR `/`s`/vacio/`BORRAR!` cancelan, `-1` pregunta) e `Invoke-Seeds` (cancelacion no ejecuta nada; con `BORRAR` registra truncate y luego seed). Al final borra las redefiniciones y recarga la biblioteca | Nunca se ejecuta SQL ni docker: los stubs solo registran los argumentos |

### Verificaciones
| Verificacion | Resultado |
|---|---|
| `scripts/dev-lib.tests.ps1` (Windows PowerShell 5.1) | **139 OK, 0 fallidos** (antes 93) |
| Parser de PowerShell sobre `dev.ps1`, `scripts/dev-lib.ps1`, `scripts/dev-lib.tests.ps1` | 0 errores; los 3 conservan BOM |
| Construcciones prohibidas (`??`, `?.`, `-AsHashtable`, `::Fill(`, `&&`) | Sin coincidencias |
| `docker compose config --quiet` | Codigo 0 |
| `npx tsc --noEmit` en `frontend/` | 0 errores |
| `git check-ignore -v` de los `.bak` con sello | Ignorados |

No se ejecuto `.\dev.ps1` en modo real, ni seeds, ni SQL de escritura. La unica consulta contra la base fue el `SELECT` de solo lectura de M-2. No se imprimieron valores de `.env`.

### Notas
- Si el conteo da `-1` (contenedor sin responder, tabla inaccesible), el seed destructivo igual pide `BORRAR`; sin consola interactiva, cancela.
- El conteo real recorre todas las tablas: en una base muy grande tardaria, pero es una base local de desarrollo.
- Regla 12: los 4 permisos que el harness agrego a `.claude/settings.json` durante esta vuelta se movieron a `settings.local.json`.

## 10. Correcciones vuelta 2 (seguridad)

Origen: `06-seguridad.md` (APROBADO con hallazgos) y decisiones del PO. S-1, S-4 a S-7 y R-1 a R-6 quedan para la documentacion y el backlog (no se tocaron).

| Hallazgo / decision | Que cambio | Verificacion |
|---|---|---|
| **M-1 puertos** | `docker-compose.yml`: `db` publica `127.0.0.1:5433:5432` siempre; `backend` y `frontend` publican `${BIND_ADDRESS:-127.0.0.1}:8080:8080` y `${BIND_ADDRESS:-127.0.0.1}:3001:3000`. `restart: unless-stopped` se mantiene. `.env.example`: `BIND_ADDRESS` comentada (`# BIND_ADDRESS=127.0.0.1`) con explicacion: `0.0.0.0` para acceder desde la red local, y en ese caso ajustar `NEXT_PUBLIC_API_BASE_URL` a la IP de la PC y correr `.\dev.ps1 -Docker`; aclara que Postgres no depende de la variable | `docker compose config --quiet`: codigo 0. Con un `.env` ficticio en el scratchpad (`--env-file`), `docker compose config` muestra `host_ip: 127.0.0.1` en 8080, 5433 y 3001; con `BIND_ADDRESS=0.0.0.0` muestra 0.0.0.0 en 8080 y 3001 y 127.0.0.1 en 5433 |
| **M-1 `BIND_ADDRESS` en el `.env`** | `Initialize-RootEnv` (`scripts/dev-lib.ps1`): en un `.env` existente agrega `BIND_ADDRESS=127.0.0.1` solo si falta (bloque "Agregadas por dev.ps1"), sin tocar valores existentes. Al crear el `.env` desde el ejemplo descomenta esa linea, para que la segunda ejecucion sea idempotente | Tests: clon nuevo queda con `127.0.0.1` y la segunda ejecucion no agrega nada; `.env` existente la recibe; `.env` con `BIND_ADDRESS=0.0.0.0` no se agrega ni se pisa y queda una sola linea; `.env.example` la trae comentada. Prefijo byte a byte del `.env` existente intacto (test previo, actualizado con la nueva variable) |
| **M-1 contrasena debil** | `Test-RootEnv`: si `POSTGRES_PASSWORD` tiene menos de 16 caracteres (`$script:MinRecommendedPasswordLength`) emite un AVISO (no error) que recomienda rotarla, dice que dev.ps1 NO la cambia y explica como: `docker compose exec db psql -U <usuario> -d <base>` y `\password <usuario>` (la pide sin mostrarla), actualizar `.env` y correr `.\dev.ps1 -Init`. No imprime el valor ni lo modifica | Tests con 14, 15 (avisa), 16 y 19 (no avisa) caracteres ficticios: el aviso no contiene el valor, `Test-RootEnv` no falla y el `.env` queda igual. Prueba manual de `-Init` en copia del scratchpad con contrasena ficticia corta: aviso mostrado, codigo 0 |
| **S-2 daemon local** | Nuevas funciones: `Test-DockerEndpointLocal` (solo `npipe://` o `unix://`), `Get-DockerContextHost` (`docker context inspect`, contexto activo), `Test-DockerDaemonLocal` (si `DOCKER_HOST` esta definida manda ella; si no, el contexto; indeterminado = no local) y `Assert-LocalDockerDaemon` (aborta con **codigo 8**). Se invoca en `Test-Prerequisites` (modos desarrollo y `-Docker`, antes de tocar nada) y de nuevo al inicio de `Invoke-Seeds`. En `-Stop` no aborta: avisa y no toca contenedores. El mensaje no imprime el endpoint. `dev.ps1`: codigo 8 documentado en la ayuda | Tests con `Get-DockerContextHost` redefinida (sin llamar a docker): npipe/unix local; tcp, ssh, http, vacio, null y texto raro no; `DOCKER_HOST` remoto gana sobre contexto local y viceversa; contexto indeterminado = no local; `Assert-LocalDockerDaemon` da 8; `Invoke-Seeds` con daemon remoto da 8 sin preguntar ni ejecutar nada. En copia del scratchpad: `DOCKER_HOST=tcp://...` con `-Docker -Seed` termina con codigo 8 en "Prerrequisitos"; `-Stop` avisa y sale 0. Con el Docker real de esta PC `Test-DockerDaemonLocal` devuelve `True` |
| **S-3** | `backend/.gitignore`: `.env.*` en la seccion dotenv (el `!.env.example` del final ya existia y queda despues) | `git diff backend/.gitignore` |
| **N-1 (05-revision)** | `Start-DevWindow`: si no se puede leer `StartTime`, cierra la ventana recien lanzada con `taskkill /PID <pid> /T /F` (PID propio, lanzado por el script en ese momento), avisa y corta con codigo 5; si el cierre tambien falla, mantiene el aviso de cerrarla a mano | Revision estatica y parser. No se probo con una ventana real: no hay forma de forzar la falla de `StartTime` sin lanzar procesos |

Ajuste menor: el aviso de `-Stop` sin Docker ahora dice "Docker no esta disponible o no es local".

### Verificaciones
| Verificacion | Resultado |
|---|---|
| `scripts/dev-lib.tests.ps1` (Windows PowerShell 5.1) | **186 OK, 0 fallidos** (antes 139) |
| `docker compose config --quiet` | Codigo 0 |
| `npx tsc --noEmit` en `frontend/` | 0 errores |
| BOM de `dev.ps1`, `scripts/dev-lib.ps1`, `scripts/dev-lib.tests.ps1` | Conservado |

No se ejecuto `.\dev.ps1` en modo real contra los `.env` del usuario: las pruebas manuales fueron en una copia en el scratchpad (borrada) con valores ficticios y `DOCKER_HOST` remoto ficticio (documentacion `192.0.2.x`), que aborta antes de cualquier operacion. Sin seeds, SQL, commits, ni cambios en volumenes o contenedores. No se imprimieron valores de `.env`. `pwsh` (PowerShell 7) no esta instalado: tests solo en 5.1.

### Notas y dudas
- Con `127.0.0.1` por defecto, `localhost` en el navegador resuelve bien; `Invoke-WebRequest` prueba IPv6 y cae a IPv4. No se observaron problemas en las pruebas locales, pero no se levanto el stack Docker real.
- El `.env` real del usuario recibira `BIND_ADDRESS=127.0.0.1` en la proxima ejecucion de `.\dev.ps1`. Quien ya use el stack Docker desde otro dispositivo de la LAN debe poner `BIND_ADDRESS=0.0.0.0` (y la IP en `NEXT_PUBLIC_API_BASE_URL`).
- En modo desarrollo el backend/frontend corren en el host (no en compose) y escuchan segun Nest/Next; no forman parte de este cambio.
- Regla 12: lo que el harness agrego a `.claude/settings.json` se movio a `settings.local.json`.

## 11. Cambio FRONTEND_PORT

Origen: criterio 18 de `01-spec.md` (ajuste de alcance pedido por el usuario). El puerto 3000 de esta PC lo usa otro proyecto (pm2), que no se toca. En modo desarrollo el frontend usa `FRONTEND_PORT` del `.env` de la raiz (vacio o ausente = 3000). Modo Docker sin cambios (3001 fijo).

### Que se cambio
| Archivo / funcion | Cambio |
|---|---|
| `scripts/dev-lib.ps1` `ConvertTo-FrontendPort` | Valida: vacio/null/espacios = 3000; entero de hasta 5 digitos entre 1024 y 65535; distinto de 5433 y 8080 (`$script:ReservedPorts`). Si no cumple: error con codigo 1, mensaje y pista claros, **sin imprimir el valor** |
| `scripts/dev-lib.ps1` `Get-FrontendPort` | Lee `FRONTEND_PORT` del `.env` de la raiz y lo valida (sin `.env` o sin la variable: 3000) |
| `scripts/dev-lib.ps1` `Get-FrontendDevArgs` | Devuelve `-- -p <puerto>` para `npm run dev` (`next dev -p`) |
| `scripts/dev-lib.ps1` `Get-PortPlan` (nueva) y `Test-Ports` | El plan de puertos en Dev es 5433, 8080 y el configurado; en Docker 5433, 8080 y 3001. La pista de puerto ocupado del frontend sugiere definir `FRONTEND_PORT` |
| `scripts/dev-lib.ps1` `Get-SmokeFrontendPort` (nueva) e `Invoke-SmokeTest` | En desarrollo la prueba de humo usa el puerto configurado; si el servicio `frontend` de compose esta corriendo, usa 3001 |
| `scripts/dev-lib.ps1` `Test-RootEnv` | Valida `FRONTEND_PORT` (por lo tanto `-Init` y todos los modos la comprueban) |
| `scripts/dev-lib.ps1` `Initialize-RootEnv` | Clon nuevo: descomenta `# FRONTEND_PORT=3000` (queda `FRONTEND_PORT=3000`, idempotente). `.env` existente: agrega `FRONTEND_PORT=3000` solo si falta, en el bloque "Agregadas por dev.ps1" al final, sin tocar el resto |
| `dev.ps1` `Invoke-DevMode` | Calcula `$frontendPort`/`$frontendUrl`; el resumen de puertos, `Start-DevWindow ... -NpmArgs (Get-FrontendDevArgs)`, `Wait-Http` del frontend (`$frontendUrl/login`) y `Show-Urls` usan ese puerto. La rama "el entorno ya esta levantado" muestra la URL con el puerto configurado |
| `dev.ps1` `Invoke-StopMode` | El aviso de puertos ocupados por procesos ajenos mira 8080 y el puerto configurado (si `FRONTEND_PORT` es invalido, avisa y usa 3000). Sigue sin matar nada ajeno |
| `dev.ps1` ayuda | Documenta `FRONTEND_PORT` (desarrollo) y el puerto fijo 3001 de `-Docker` |
| `.env.example` | `# FRONTEND_PORT=3000` comentada, con rango, exclusiones y aclaracion de que no afecta a Docker |
| `scripts/dev-lib.tests.ps1` | Casos nuevos de validacion, lectura del `.env`, alta en clon nuevo y `.env` existente, plan de puertos, argumentos de `next dev`, puerto de la prueba de humo, y `Test-Ports` con puertos ocupados reales efimeros |

En esta revision no hizo falta agregar codigo: se reviso cada lugar de modo desarrollo que usaba 3000 y todos usan el puerto configurado. El modo Docker (`Invoke-DockerMode`, `Test-Ports -Mode Docker`) sigue en 3001.

### Verificaciones
| Verificacion | Resultado |
|---|---|
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-lib.tests.ps1` (Windows PowerShell 5.1) | **240 OK, 0 fallidos** (antes 186) |
| Parser de PowerShell en `dev.ps1`, `scripts/dev-lib.ps1`, `scripts/dev-lib.tests.ps1` | 0 errores en los 3 |
| BOM `EF BB BF` en los 3 archivos | Conservado |
| Construcciones prohibidas (`??`, `?.`, `-AsHashtable`, `::Fill(`, `&&`, `\|\|`) | Ninguna |
| `docker compose config --quiet` | Codigo 0 |

### Notas
- No se ejecuto `.\dev.ps1` en modo real (ni Dev, ni `-Docker`, `-Stop`, `-Seed`, `-Init`) ni se leyeron o modificaron los `.env`. La cobertura de `-Init` sobre un `.env` nuevo o existente sale de los tests, que usan carpetas temporales con valores ficticios. `pwsh` (PowerShell 7) no esta instalado: tests solo en 5.1.
- Los tests de `Test-Ports` abren listeners TCP efimeros en el loopback; no tocan el 3000 ni procesos ajenos.
- Un `FRONTEND_PORT` invalido hace fallar tambien el modo `-Docker` (la validacion esta en `Test-RootEnv`, comun a todos los modos), aunque Docker no lo use. Es deliberado: se detecta temprano un `.env` mal escrito.
- Una linea `FRONTEND_PORT=` presente pero vacia no se reescribe: cuenta como "definida" y se usa 3000.
- Regla 12: los permisos que el harness agrego a `.claude/settings.json` se movieron a `settings.local.json` (sin duplicar); `settings.json` quedo igual que en HEAD.
- Pendiente para el tester: probar con `FRONTEND_PORT` libre (por ejemplo 3002) en el `.env` local; la documentacion (criterio 17) es del documentador.
