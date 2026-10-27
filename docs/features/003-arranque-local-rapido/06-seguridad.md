# 06 - Seguridad: 003-arranque-local-rapido

> Nota del PO: el agente de seguridad no puede escribir archivos de informe. Devolvió esta sección y el
> PO la insertó sin cambios de contenido.

## Re-verificación: cambio FRONTEND_PORT

Alcance: `dev.ps1`, `scripts/dev-lib.ps1`, `scripts/dev-lib.tests.ps1`, `.env.example`, `.claude/settings.json` (solo estado).
Solo lectura: no se ejecutó `dev.ps1`, no se tocaron puertos ni procesos, no se leyeron valores de `.env` ni de backups, no se
corrió `npm audit`. No se volvió a correr `scripts/dev-lib.tests.ps1` (abre listeners de puertos); se toma el resultado del revisor
(240 OK, 0 fallidos).

| Punto | Resultado | Evidencia |
|---|---|---|
| Inyección por el valor del .env | OK | `ConvertTo-FrontendPort` (dev-lib.ps1:340-354) recorta, exige `^\d{1,5}$`, `[int]::TryParse` y rango 1024-65535. Devuelve el `[int]`, nunca el texto original. `Get-FrontendDevArgs` (`:363`) recibe `[int]$Port` y arma `'-- -p {0}'`. Ese entero es lo único del .env que llega al `-EncodedCommand`, vía `-NpmArgs` en dev.ps1:158. Un dígito Unicode que pase el `\d` de .NET no pasa `TryParse`. Comillas, `;`, `$()` y espacios no llegan. |
| Mensajes sin el valor | OK | El error de formato (`:348`) es texto fijo. El de choque (`:351`) imprime el entero ya validado y las constantes 5433/8080. El test `dev-lib.tests.ps1:448` verifica que 'abc' no aparece. `Invoke-StopMode` captura el error con un texto fijo. |
| Exposición en red | Informativo, no regresión | `frontend/package.json` define `"dev": "next dev"` sin `-H`, así que Next dev escucha en todas las interfaces (0.0.0.0), igual que antes en el 3000. Solo cambia el número de puerto. El backend en desarrollo también está en 0.0.0.0 (hallazgo previo R-2/R-5), y `BIND_ADDRESS` solo protege el modo Docker. Mitigación opcional: agregar `-H 127.0.0.1` a `Get-FrontendDevArgs`. |
| No mata procesos ajenos | OK | Los únicos `taskkill` están en dev-lib.ps1:909 (PID recién lanzado por `Start-Process -PassThru`) y `:929` (PIDs del estado, previamente validados por nombre `powershell`/`pwsh` y hora de inicio). Un puerto ocupado por otro proceso solo produce un aviso (`dev.ps1:234`) o un aborto con código 2 (`Test-Ports`). Nunca se mata al dueño del puerto. |
| Barrido de secretos | 0 | `grep -c -F -f valores.txt` da 0 en `dev.ps1`, `scripts/*`, `.env.example`, `frontend/.env.example`, `docker-compose.yml`, `.claude/settings.json` y los md 00-06. Con patrones genéricos solo aparecen `change-me`, los plantillados `<usuario>` y los valores ficticios de los tests. |
| `.env.example` | OK | `# FRONTEND_PORT=3000` va comentada, solo con placeholders. |

### Hallazgos
- BLOQUEANTE: ninguno.
- MAYOR: ninguno.
- MENOR
  - **F-1. `.claude/settings.json` sigue modificado (regla 12), sin tocarlo.** `allow` pasó de `[]` a `Bash(cat >> *)`,
    `Bash(git show *)` y el parser de PowerShell, y `additionalDirectories` suma `"\\dev"`.
    - `cat >> *` permite agregar texto a cualquier archivo sin pedir confirmación y es el más amplio de los tres.
    - `\dev` es una ruta relativa a la raíz de la unidad actual, fuera del repo.
    - Ninguna entrada tiene secretos, pero las agregó el harness y no el usuario (regla 2). Antes del commit hay que restaurar
      el archivo a HEAD o no incluirlo en `git add` (regla 12); lo hace el usuario o el PO.
  - **F-2. Next dev en 0.0.0.0** (ver "Exposición en red"): preexistente, informativo.
  - **F-3. Disponibilidad:** `Test-Ports` llama a `Get-FrontendPort` también en modo Docker, así que un `FRONTEND_PORT` inválido
    aborta ese modo aunque no lo use. No es de seguridad.

Sin hallazgos nuevos que bloqueen. Los menores previos (S-1, S-4 a S-7, R-1 a R-6) no cambian.

---

## Re-verificacion vuelta 2

Solo lectura. No se ejecuto `.\dev.ps1`, ni `-Seed`, ni `-Stop`, ni SQL. No se leyeron valores de los `.env`.
Insumos: `git diff HEAD`, archivos sin trackear, seccion 10 de `04-implementacion.md`.

| Hallazgo | Estado | Evidencia |
|---|---|---|
| **M-1** puertos | CERRADO | `docker-compose.yml`: `db` publica `127.0.0.1:5433:5432` fijo; `backend` y `frontend` usan `${BIND_ADDRESS:-127.0.0.1}`. `docker compose --env-file` ficticio (scratchpad): 8080, 5433 y 3001 en `host_ip: 127.0.0.1`. Con `BIND_ADDRESS=0.0.0.0`: 8080 y 3001 en 0.0.0.0 y 5433 sigue en 127.0.0.1. `.env.example` trae la variable comentada. |
| **M-1** contrasena corta | CERRADO | `Test-RootEnv` (`dev-lib.ps1:309-310`): aviso si hay menos de 16 caracteres. El texto nombra la variable y la longitud minima, no el valor; no la modifica. Tests con 14, 15, 16 y 19 caracteres. |
| **S-2** daemon remoto | CERRADO | `Test-DockerDaemonLocal` (`:564`) da prioridad a `DOCKER_HOST` y si no, al contexto activo; solo acepta `npipe://` y `unix://`; indeterminado = no local. `Assert-LocalDockerDaemon` aborta con codigo 8 sin imprimir el endpoint. Se invoca en `Test-Prerequisites` (`:601`) y al inicio de `Invoke-Seeds` (`:953`), antes de plan, conteo y confirmacion. |
| **S-3** `.gitignore` backend | CERRADO | `.env.*` en `backend/.gitignore:44`; `git check-ignore` confirma `backend/.env.pre-003.bak` ignorado y `backend/.env.example` NO ignorado. |
| **N-1** `taskkill` | CERRADO | `Start-DevWindow` (`:856`): `taskkill /PID $p.Id /T /F` sobre el PID devuelto por `Start-Process -PassThru` en ese momento. Nunca usa PIDs del archivo de estado ni de terceros. (`Stop-DevProcesses`, `:876`, mantiene la validacion previa de nombre y hora de inicio). |
| **Barrido** | 0 | `git diff HEAD | grep -c -F -f valores.txt` = 0; mismo conteo en `dev.ps1`, `scripts/*`, `frontend/.env.example` y los md 03 a 05 = 0. Patrones genericos (password/secret/token con valor, `eyJ`, `AKIA`, `BEGIN ... KEY`, URL con credenciales): unica coincidencia `change-me:change-me` (placeholder). |
| **`.claude/settings.json`** | CERRADO | Sin diff contra HEAD de permisos: `allow: []`, sin `defaultMode`. (Aparece como modificado solo por aviso de fin de linea.) |
| Tests | OK | `scripts/dev-lib.tests.ps1`: 186 OK, 0 fallidos. |

Estado de menores no tocados (van a documentacion o backlog por decision del PO): S-1, S-4, S-5, S-6, S-7 y R-1 a R-6 siguen igual.
Observacion nueva menor: con `BIND_ADDRESS=0.0.0.0` la API se expone en la LAN con JWT sin verificar y CORS abierto (R-2, R-5);
queda como opt-in explicito y documentado en `.env.example`, no por defecto.

Sin hallazgos nuevos BLOQUEANTES ni MAYORES. M-1 pasa de MAYOR a cerrado.

---

# (Informe original, vuelta 1)

Alcance: `dev.ps1`, `scripts/dev-lib.ps1`, `scripts/dev-lib.tests.ps1`, `docker-compose.yml`, eliminación de `backend/docker-compose.yml`,
los tres `.env.example`, `frontend/src/services/data.ts`, `.gitignore` y `.claude/settings.json`.
Entrada: `CLAUDE.md` (reglas 2, 3, 10 y 12), `01-spec.md`, `03-diseno-tecnico.md`, `04-implementacion.md`, `05-revision.md` (vuelta 2, APROBADO).

No se ejecutó `.\dev.ps1` en modo real, ni `-Seed`, ni `-Stop`, ni SQL. No se leyó el contenido de ningún `.env` (solo `icacls` sobre
`.env`, que lista permisos y no valores). No se modificó ningún archivo salvo este informe. No hubo commit.
Dependencias: este cambio no toca `package.json` ni lockfiles, así que no hay dependencias nuevas. No se corrió `npm audit`
porque envía el lockfile al registro (sistema externo) y CLAUDE.md no define un comando de auditoría.

Superficie sensible tocada: manejo de secretos locales, ejecución de procesos, scripts con operaciones destructivas opcionales
(`-Seed`) y configuración de red de Docker. No se agregan endpoints ni cambia la lógica del backend.

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-lib.tests.ps1` | 139 OK, 0 fallidos |
| `grep -c -F -f ..\_backup_git\002-redact\valores.txt` sobre `git diff HEAD` | 0 |
| Mismo conteo sobre `dev.ps1`, `scripts/*`, `frontend/.env.example` y los 4 md del feature | 0 en todos |
| Patrones genéricos con valor real (contraseña/secreto/token con valor, JWT `eyJ`, `AKIA`, `BEGIN`, URL con credenciales, IPv4) | Sin valores reales. 13 coincidencias, todas ficticias: `change-me`, `127.0.0.1`/`localhost`, un JWT ficticio de test, un ejemplo de escape en un test. Las únicas coincidencias con la IP de la red local son líneas **eliminadas** por el diff |
| `git check-ignore` de `.env`, `backend/.env`, `backend/.env.pre-003.bak` y la variante con sello, `.dev/processes.json`, `frontend/.env.local` | Todos ignorados |
| `.env.example` (raíz, backend y frontend) | No ignorados (correcto), con placeholders `change-me` |

## Resultado por punto

### 1. Secretos
- Generación: `New-RandomHex` usa `RandomNumberGenerator` (CSPRNG). Contraseña de Postgres con 24 bytes (192 bits) y `JWT_SECRET`
  con 32 bytes (256 bits), en hexadecimal. Longitud suficiente. OK.
- Impresión: ninguna función imprime valores. Los avisos nombran solo variables. `docker compose config` se usa con `--quiet`. OK.
  Las salidas de `npm`, `prisma` y `docker` se muestran tal cual (`Invoke-Native`); sus mensajes de error no suelen incluir la
  contraseña, pero es una salida de terceros.
- Historial de PowerShell: los secretos no se tipean en la línea de comandos, así que PSReadLine no los guarda. OK.
- Listado de procesos: `-EncodedCommand` lleva solo título de ventana, ruta de trabajo y `npm.cmd run <script>`. Sin secretos
  (revisado en `dev-lib.ps1:797-799`). Los hijos leen `backend/.env` desde disco. `psql` y `pg_isready` reciben usuario y nombre de
  base como argumentos (visibles, no secretos) y se conectan sin contraseña por el socket local del contenedor; no hay `PGPASSWORD`.
  La consulta de conteo viaja por stdin. Docker lee el `.env` por sí mismo (el compose usa `${VAR}` sin `env_file`).
- Archivo de PIDs: solo `name`, `pid` y `startTime`. El `.tmp` se mueve sobre el definitivo. OK.
- Archivos temporales: en el contenedor, `/tmp/<seed>.sql` se borra en `finally` (`dev-lib.ps1:924-926`). En el host no hay temporales.
- `SMOKE_PASSWORD` y `SMOKE_USER` viven en el `.env` raíz y no llegan a ningún contenedor ni al bundle del frontend (el compose no los referencia).

### 2. Prueba de humo
- El cuerpo del login se arma en memoria como bytes UTF-8 y va por POST a `http://localhost:8080/api/v1/auth/login` (URL fija).
  Ni la contraseña ni el token se imprimen, se guardan ni van en la URL. En los errores solo se muestra el código HTTP.
  Las variables se anulan en `finally`.
- Las `SMOKE_*` se leen con `Read-DotEnv` del archivo `.env` local, no del entorno del proceso. OK.
- Limitación: el login viaja por HTTP en loopback (aceptable en local). Ver riesgo residual R-1: el backend loguea ese cuerpo.

### 3. Archivos generados
- Ignorados por git: `.env`, `.env.*` (cubre `backend/.env.pre-003*.bak`), `.dev/`, `frontend/.env*`. Verificado con `git check-ignore`.
- Ignorados por Docker: `backend/.dockerignore` excluye `.env` y `.env.*`; `frontend/.dockerignore` excluye `.env*`. El `.env`
  de la raíz queda fuera de ambos contextos de build (`./backend`, `./frontend`). No hace falta un `.dockerignore` en la raíz.
- Permisos en Windows (se ejecutó `icacls .env`): el archivo hereda de `C:\Repositorios` y queda legible por `BUILTIN\Usuarios` y
  modificable por `Usuarios autentificados`. En una PC de un solo usuario es razonable; en una compartida, otro usuario local podría
  leer la contraseña de Postgres, el `JWT_SECRET` y `SMOKE_PASSWORD`. Ver S-1.

### 4. Operaciones destructivas
- `-Seed`: el flujo es opt-in. Muestra el plan, cuenta filas de todas las tablas de `public` (salvo `_prisma_migrations`) y, si hay
  `TRUNCATE`/`DELETE FROM`/`DROP`, exige escribir `BORRAR` exacto (`-ceq`). Si el conteo falla (-1) o hay datos, pregunta; sin consola
  interactiva cancela. Solo corre con 0 filas sin preguntar. Opera con `docker compose -f <raíz>/docker-compose.yml exec db`, y los
  nombres de archivo son una lista fija. `seed_activities.sql` y `seed_psicolsa.sql` nunca se cargan.
- `-Stop`: mata el árbol de PIDs registrados solo si el proceso es `powershell`/`pwsh` y su hora de inicio coincide con la guardada
  (protege contra reutilización de PID), y ejecuta `docker compose stop`. No hay `down`, `-v`, `volume rm`, `prune` ni `docker rm`.
- Único borrado en el script: `Remove-Item` de `.dev/processes.json` (`dev-lib.ps1:825`). Nada borra `.env`, `.bak` ni datos.
  El `.bak` nunca se pisa (se crea otro con sello de tiempo).
- Brecha contra la regla 10: el script usa el CLI `docker` con el contexto activo del usuario. Si `DOCKER_HOST` o `docker context`
  apuntan a un daemon remoto, `-Seed` correría contra ese servicio `db`. Ver S-2.

### 5. Inyección
- No hay `Invoke-Expression` ni `iex` (grep). Los comandos externos se llaman con `&` y arreglo de argumentos, sin shell intermedia.
- SQL: la consulta de conteo es constante y va por stdin. Los seeds son archivos del repo, con nombre de lista fija.
- URLs: `Build-DatabaseUrl` aplica `EscapeDataString` a usuario, contraseña y base; el resultado no contiene `"` ni `$`, así que es
  seguro dentro de las comillas dobles del `.env` y frente a `dotenv-expand`. Test de escape en `dev-lib.tests.ps1:70`.
- `ConvertTo-EnvValue` rechaza comilla simple y saltos de línea; el resto se escribe entre comillas simples.
- `-EncodedCommand`: título y ruta se escapan duplicando `'`; el script de script es constante salvo la ruta del repo.
- Excepción conocida y avisada: en modo Docker el compose interpola la contraseña sin escapar en `DATABASE_URL`; con caracteres fuera de
  `[A-Za-z0-9._~-]` la conexión falla. Los valores generados por el script cumplen esa regla. Solo disponibilidad, no seguridad.

### 6. Compose y frontend
- No quedan IPs ni claves fijas en `docker-compose.yml`: se quitó la IP de la red local (de `CORS_ORIGIN` y de `NEXT_PUBLIC_API_BASE_URL`).
  Todos los secretos usan `${VAR:?...}`. Se eliminó `backend/docker-compose.yml` (el volumen viejo `backend_postgres_data` no se borra y se avisa).
- `NEXT_PUBLIC_API_BASE_URL` va al bundle del cliente; es una URL pública por diseño y el default es `http://localhost:8080/api`.
  No lleva nada sensible. Queda como build arg en el historial de la imagen (es solo una URL).
- `data.ts`: el único cambio es el default de SSR, de `http://backend:8080/api` a `http://localhost:8080/api`. Las dos URL salen de
  variables de entorno, no de entrada del usuario, así que no abre SSRF. En Docker no cambia el destino porque el compose define
  `INTERNAL_API_URL`. Fuera del compose (otro orquestador) y sin esa variable, el SSR apuntaría a localhost: es de disponibilidad,
  no de seguridad. Conviene documentarlo.
- Se quitó `CORS_ORIGIN` del compose; no tiene efecto porque el código lo ignora (ver R-2).

### 7. Barrido previo al commit
Ver tabla de verificaciones: 0 coincidencias con `valores.txt` y ningún valor real con los patrones genéricos.
Los archivos untracked (`dev.ps1`, `scripts/`, `frontend/.env.example`, md del feature) están limpios.

### 8. `.claude/settings.json`
Aparece modificado: `allow` pasó de `[]` a 3 entradas `Bash(echo "EXIT=$?")`, `Bash(echo "compose=$?")`, `Bash(echo "tsc=$?")`.
Las agregó el harness al aprobar comandos de las revisiones; no son parte del feature. Hay que **revertirlas** antes del commit
(`git checkout -- .claude/settings.json` lo hace el usuario o el PO, regla 12), o no incluir el archivo en el `git add`.
No contienen secretos, pero ensanchan permisos del proyecto sin pedido explícito (regla 2).

## Hallazgos

### BLOQUEANTE
Ninguno.

### MAYOR
- **M-1. Postgres y la API publicados en todas las interfaces.** `docker-compose.yml:9-10` publica `'5433:5432'` (equivale a `0.0.0.0`), y el
  backend escucha en `0.0.0.0` (`bootstrap.ts:27`). Con `restart: unless-stopped` el contenedor de la base arranca con Docker Desktop
  y queda accesible desde la red local. La contraseña generada es fuerte, pero `Initialize-RootEnv` **conserva credenciales heredadas**
  de un `backend/.env` anterior, que pueden ser débiles o estar en el historial, y `Test-RootEnv` solo avisa por `change-me`. El `.env.example`
  además invita a usar el frontend "desde otro equipo de la red", lo que expone una API cuyo JWT no se verifica (regla 4).
  Preexistente en cuanto al puerto, pero este feature lo deja persistente y documentado para uso en red.
  Remediación: publicar solo en loopback (`'127.0.0.1:5433:5432'`; idem `8080` y `3001` si no se necesita red), y en `Test-RootEnv`
  avisar si la contraseña tiene menos de 16 caracteres o coincide con un valor conocido. No bloquea porque el riesgo ya existía y
  el uso previsto es una PC de desarrollo; debe quedar como tarea previa a recomendar el acceso por red.

### MENOR
- **S-1. Permisos del `.env` en Windows.** `icacls` muestra herencia con lectura para `BUILTIN\Usuarios` y modificación para `Usuarios autentificados`.
  Recomendación opcional en `Write-Utf8NoBom` (o en una función aparte, para `.env` y `backend/.env`), tras escribir:
  `icacls <archivo> /inheritance:r /grant:r "${env:USERNAME}:(R,W)"`. Aplicar el mismo criterio a `.env.pre-003*.bak`, que conserva los valores viejos.
- **S-2. Daemon remoto y regla 10.** Antes de `-Seed` (y mejor en `Test-Prerequisites`), comprobar que `DOCKER_HOST` esté vacío o sea local
  y que `docker context show` sea `default`/`desktop-linux`; si no, abortar. Hoy la protección es `BORRAR` más el conteo, pero ambos
  se mostrarían igual contra un daemon remoto.
- **S-3. `.gitignore` del backend sin `.env.*`.** `backend/.gitignore` ignora `.env`, pero no `.env.*` ni `*.bak`. En este árbol no importa
  (hay un solo repo y el `.gitignore` raíz cubre `.env.*`), pero CLAUDE.md describe `backend/` y `frontend/` como repos independientes.
  Si lo fueran, `backend/.env.pre-003.bak` (con credenciales viejas) quedaría como untracked y listo para un `git add .`. Agregar
  `.env.*` y `!.env.example` en `backend/.gitignore`. El de `frontend` ya usa `.env*`.
- **S-4. Respaldo `.bak` con credenciales viejas.** Queda en disco hasta que el usuario lo borre; el script avisa pero no lo ofrece
  borrar. Aceptable (el script nunca borra nada). Recordar en la guía de cierre borrarlo y rotar cualquier credencial que haya estado en git.
- **S-5. `-Stop` se apoya en un archivo editable.** `.dev/processes.json` es escribible por otros usuarios locales (ver S-1). Un PID forjado
  solo puede apuntar a un proceso `powershell`/`pwsh` con `StartTime` exacto, por lo que el daño máximo es cerrar una consola PowerShell
  propia. Aceptable; opcionalmente comparar también la línea de comandos con el título de ventana.
- **S-6. Imagen `postgres:16-alpine` sin fijar.** Fijar versión menor o digest para builds reproducibles. No es una vulnerabilidad actual.
- **S-7. Documentar el default SSR de `data.ts`** para despliegues fuera del compose (necesitan `INTERNAL_API_URL`).

## Riesgos residuales (fuera de alcance, a informar)
- **R-1. `LoggingInterceptor` loguea credenciales.** `backend/src/infrastructure.bootstrap/interceptors/logging.interceptor.ts` registra
  cabeceras (incluye `Authorization`), el body (la contraseña del login) y la respuesta (el token del login) con `logger.debug`.
  Por eso la prueba de humo deja `SMOKE_PASSWORD` y el token en la consola del backend. BACKLOG 7. Remediación: omitir o enmascarar
  `authorization`, `password` y `token`, o no loguear body/respuesta en rutas de auth, y no emitir debug fuera de desarrollo.
- **R-2. CORS `origin: true`** (`cors-config.ts:8`) refleja cualquier origen y `CORS_ORIGIN` se ignora. Combinado con la API sin JWT verificado
  y con el tenant tomado de headers del cliente (regla 4), cualquier página abierta en el navegador del desarrollador puede leer/escribir
  `http://localhost:8080`. Remediación: usar `CORS_ORIGIN` de verdad con una lista de orígenes.
- **R-3.** Los secretos de la base y el `JWT_SECRET` son visibles con `docker inspect` en los contenedores (variables de entorno). Normal en local.
- **R-4.** `npm install --legacy-peer-deps` ejecuta scripts de instalación de dependencias. Riesgo habitual de cadena de suministro; sin cambios en este feature.
- **R-5.** Los JWT no se verifican y el tenant viaja en headers (regla 4, `docs/auditoria/RIESGOS.md`). Preexistente.
- **R-6.** La IP privada de la red local que se elimina sigue en el historial de git. No es un secreto; no requiere acción.

## Conformidad con las reglas
| Regla | Estado |
|---|---|
| 2 (no tocar `.env`/credenciales/`.claude`) | El script solo escribe `.env`/`backend/.env` locales y ignorados. `.claude/settings.json` tiene entradas del harness: revertir antes del commit |
| 3 (sin secretos en versionados) | OK: barrido en 0, solo placeholders |
| 10 (solo base local) | OK con la reserva S-2 |
| 12 (settings del harness fuera del commit) | Pendiente: revertir `.claude/settings.json` |

El cambio no introduce vulnerabilidades explotables nuevas. Los secretos se generan y manejan correctamente, las operaciones destructivas
requieren confirmación explícita y no hay rutas que borren volúmenes, `.env` o datos. M-1 y los menores son mejoras recomendadas;
no impiden el commit, siempre que antes se revierta `.claude/settings.json`.

Veredicto vuelta 1-2: APROBADO

---

Veredicto vigente (re-verificación FRONTEND_PORT):

VEREDICTO: APROBADO
