# Re-revisión: cambio FRONTEND_PORT (vuelta 4)

> Alcance: criterio 18 de `01-spec.md` (puerto del frontend configurable en modo desarrollo), sección 11 de `04-implementacion.md`.
> Revisados `dev.ps1`, `scripts/dev-lib.ps1`, `scripts/dev-lib.tests.ps1` (archivos nuevos sin trackear, leídos completos en lo relevante) y `.env.example`.
> No se ejecutó `.\dev.ps1` en ningún modo, ni SQL. No se leyó ni imprimió ningún `.env`. No se tocaron contenedores, volúmenes ni procesos (ni pm2 ni el puerto 3000). Sin commit, stash, reset ni checkout. No se modificó código.

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-lib.tests.ps1` (Windows PowerShell 5.1) | **240 OK, 0 fallidos** |
| Parser de PowerShell sobre `dev.ps1`, `scripts/dev-lib.ps1`, `scripts/dev-lib.tests.ps1` | 0 errores en los 3 |
| `docker compose config --quiet` | código 0 |
| Búsqueda de `3000` / `3001` en `dev.ps1` y `dev-lib.ps1` | Todo literal restante es intencional: default (`DefaultFrontendPort`), constante Docker (`DockerFrontendPort`), ayuda, modo Docker y mensajes |
| CORS del backend (`cors-config.ts`) | `origin: true` (refleja el origen): un frontend en otro puerto no queda bloqueado. `frontend/package.json` usa `next dev` sin puerto fijo, así que `-p` no choca con nada |

## Uso del puerto configurado (modo desarrollo)
| Lugar | Estado |
|---|---|
| `Test-Ports -Mode Dev` / `Get-PortPlan` | OK: 5433, 8080 y el configurado (la validación corre dentro de `Test-Ports`). Pista de ocupado sugiere `FRONTEND_PORT` y `-Stop` |
| Ventana del frontend | OK: `Start-DevWindow ... -NpmArgs (Get-FrontendDevArgs)` arma `npm.cmd run dev -- -p <puerto>`; el puerto es un `[int]` validado, sin inyección posible en el comando codificado |
| `Wait-Http` del frontend y `Show-Urls` | OK: usan `$frontendUrl` |
| Rama "ya está levantado" | OK: muestra la URL con el puerto configurado (ver M-1 menor abajo) |
| `-Stop` | OK: avisa de ocupación en 8080 y en el puerto configurado; si `FRONTEND_PORT` es inválido, avisa y usa 3000 (no aborta); no mata procesos ajenos |
| `-Smoke` | OK: `Get-SmokeFrontendPort` usa el configurado en desarrollo y 3001 si el servicio `frontend` de compose está corriendo |
| Ayuda de `dev.ps1` y `.env.example` | OK: documentan rango, exclusiones y que Docker no se ve afectado |
| Modo Docker | Sin cambios: `Test-Ports -Mode Docker` (5433, 8080, 3001), `Wait-Http` y URL en 3001 fijos; `docker-compose.yml` no usa `FRONTEND_PORT` |

## Validación (`ConvertTo-FrontendPort`)
- Vacío, ausente o solo espacios: 3000. Recorta espacios. Acepta comentario en línea (`3005 # ...`) y comillas por el parser de dotenv.
- Rechaza (código 1): no numérico, más de 5 dígitos, menor a 1024, mayor a 65535, 5433 y 8080. Probados 1024 y 65535 como límites válidos.
- Los mensajes no imprimen el valor ingresado (hay test). Para 5433/8080 el mensaje nombra el puerto, que es una constante pública del proyecto, no el dato del usuario: aceptable.
- Fallo temprano: `Initialize-Config` llama a `Test-RootEnv` antes de prerrequisitos, así que el error 1 sale antes de tocar Docker o procesos.

## Alta en `.env`
- Clon nuevo: se descomenta `# FRONTEND_PORT=3000`; la segunda ejecución no agrega nada (test).
- `.env` existente: se agrega `FRONTEND_PORT=3000` solo si falta, en el bloque "Agregadas por dev.ps1", respetando el fin de línea; el prefijo queda intacto y un valor existente no se pisa (tests: 3005 conservado, una sola línea).
- `FRONTEND_PORT=` vacía cuenta como definida y se usa 3000 (decisión documentada; coherente con la spec).

## Compatibilidad 5.1 y regresiones
Sintaxis compatible con 5.1 (los 240 tests corren en 5.1; `switch` como expresión, `$script:` en dot-source ya se usaba antes). Los tests de `Test-Ports` usan listeners efímeros en loopback, no tocan el 3000. Las 186 aserciones previas siguen pasando. Sin regresiones.

## Duda del desarrollador: ¿FRONTEND_PORT inválido debe hacer fallar también `-Docker`?
Opino que sí, está bien como está. `Test-RootEnv` es la validación común del `.env`; un valor inválido es un `.env` mal escrito y conviene detectarlo antes de gastar un `compose up --build`. El costo es bajo: el mensaje nombra la variable y la pista dice "borra la línea para usar 3000", y `-Stop` no se bloquea (degrada a aviso). Solo hay que dejarlo escrito en la documentación (criterio 17) para que no sorprenda. No requiere cambio.

## Hallazgos

### BLOQUEANTE
Ninguno.

### MAYOR
Ninguno.

### MENOR
- **M-1.** `dev.ps1:110-111,122`: en la rama "ya está levantado" el puerto mostrado sale del `.env` actual, no del que usó la ventana ya abierta. Si el usuario editó `FRONTEND_PORT` con el entorno vivo, la URL mostrada no coincide con la real. Sugerencia: avisar en esa rama "si cambiaste FRONTEND_PORT, ejecutá `.\dev.ps1 -Stop` y volvé a levantar", o documentarlo. No bloquea.
- **M-2.** `scripts/dev-lib.ps1:347`: `\d` en .NET acepta dígitos Unicode no ASCII; hoy `TryParse` los rechaza o los interpreta igual, así que es inofensivo. Opcional: `^[0-9]{1,5}$` por claridad.
- **M-3.** Sin test que cubra la cadena completa de `Invoke-DevMode` (requeriría levantar ventanas reales); queda para el tester: probar con un puerto libre (por ejemplo 3002) y comprobar que la ventana abre `next dev -p 3002`, la URL final y `-Smoke`. Aceptable.
- **M-4 (regla 12, informativo).** `.claude/settings.json` volvió a aparecer modificado en `git diff` (`+7 -2`): el harness agregó permisos (`Bash(cat >> *)`, `Bash(git show *)`, un `powershell -NoProfile -Command ...` del parser) y `"\\dev"` en `additionalDirectories`. No lo toqué (no edito configuración). El PO debe moverlos a `.claude/settings.local.json` o revertirlos antes de cualquier commit, y no incluir `settings.json` en el `git add`.

## Conformidad
| Criterio | Estado |
|---|---|
| Criterio 18 de la spec (todos los puntos) | OK |
| Criterios 7, 10, 14 en modo desarrollo | OK (usan el puerto configurado) |
| Modo Docker sin cambios | OK |
| Reglas 2, 3, 10 | OK |
| Regla 7 (tests, parser, compose) | OK: 240/240, 0 errores de parser, `compose config` en 0 |
| Docs (criterio 17) | Pendiente del documentador |

VEREDICTO: APROBADO

---

# (Informe anterior, vuelta 3)

(05 - Revision: 003-arranque-local-rapido, vuelta 3)

Historial: vuelta 1 RECHAZADO por B-1 (`Get-DevProcesses` fallaba en PowerShell 5.1 con 2 o mas procesos) mas M-1 a M-6 y S-1 a S-3; vuelta 2 APROBADO con N-1 y N-2 menores.

> Alcance: correcciones de la vuelta 2 de seguridad (M-1, S-2, S-3 de `06-seguridad.md` y N-1 de mi revision). Revisados el `git diff` de
> `docker-compose.yml`, `.env.example`, `backend/.gitignore` y los archivos nuevos `dev.ps1`, `scripts/dev-lib.ps1`, `scripts/dev-lib.tests.ps1`.
> No se ejecuto `.\dev.ps1` en modo real, ni `-Seed`, ni `-Stop`, ni SQL. No se leyo ni toco ningun `.env`. Sin commit, stash, reset ni checkout.

## Verificaciones ejecutadas
| Verificacion | Resultado |
|---|---|
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-lib.tests.ps1` (Windows PowerShell 5.1) | **186 OK, 0 fallidos**, codigo 0 |
| `docker compose config --quiet` | codigo 0 |
| `npx tsc --noEmit` en `frontend/` | 0 errores |
| Deteccion del daemon contra el Docker real (solo lectura, `docker context inspect`) | `Test-DockerDaemonLocal` -> `IsLocal=True`. Contextos de esta PC: `default` (`npipe:////./pipe/docker_engine`), `desktop-linux` (activo, `npipe:////./pipe/dockerDesktopLinuxEngine`), `desktop-windows` |
| `Test-DockerEndpointLocal` con endpoints de muestra | `npipe://...docker_engine`, `npipe://...dockerDesktopLinuxEngine` y `unix://...` -> True; `tcp://127.0.0.1:2375` y `ssh://...` -> False. Con `DOCKER_HOST=tcp://192.0.2.1:2375` (solo en el proceso de la prueba) -> False |

## Estado de los puntos

| Punto | Estado | Verificacion |
|---|---|---|
| **M-1 puertos** | RESUELTO | `docker-compose.yml`: `db` en `'127.0.0.1:5433:5432'` fijo; backend y frontend en `'${BIND_ADDRESS:-127.0.0.1}:8080:8080'` y `'${BIND_ADDRESS:-127.0.0.1}:3001:3000'`. El `:-` cubre variable ausente y vacia (`BIND_ADDRESS=` en el `.env` no rompe). `restart: unless-stopped` se mantiene. `compose config --quiet` en 0 |
| **M-1 `BIND_ADDRESS` sin tocar existentes** | RESUELTO | `dev-lib.ps1:271-278`: en un `.env` existente se agrega solo si `-not $dict.Contains('BIND_ADDRESS')`, en el bloque "Agregadas por dev.ps1", respetando el fin de linea del archivo; el resto del texto no se reescribe, asi que el prefijo queda byte a byte. Un `0.0.0.0` del usuario no se pisa. En `.env` nuevo (`:231-234`) se descomenta la linea del ejemplo, por lo que la segunda ejecucion no agrega nada. Una linea comentada `# BIND_ADDRESS=...` del usuario no cuenta como definida, entonces se agrega `127.0.0.1` debajo: es el valor seguro y correcto |
| **M-1 contrasena debil** | RESUELTO | `Test-RootEnv` (`:309-310`): aviso (no error) si `POSTGRES_PASSWORD` tiene menos de 16 caracteres; no imprime el valor, no la modifica, explica la rotacion con `\password` |
| **S-2 daemon local** | RESUELTO | `Test-DockerEndpointLocal` acepta solo `npipe://` y `unix://`; `Get-DockerContextHost` usa `docker context inspect --format` sin nombre (contexto activo, respeta tambien `DOCKER_CONTEXT`); `DOCKER_HOST` manda sobre el contexto. Se invoca en `Test-Prerequisites` (`:601`, antes de cualquier escritura de Docker) y al inicio de `Invoke-Seeds` (`:953`). `-Stop` no aborta: avisa y no toca contenedores. No se imprime el endpoint |
| **Sin falsos negativos con Docker Desktop** | OK | Los tres contextos de Docker Desktop en Windows usan `npipe://`; el real devuelve `IsLocal=True`. `docker_engine`, `dockerDesktopLinuxEngine` y `dockerDesktopWindowsEngine` pasan porque la regla es por esquema, no por nombre de contexto. Docker Desktop en Linux/WSL (`unix://`) tambien pasa |
| **Codigo de salida 8 documentado** | OK | `dev.ps1` (ayuda, ultima linea de codigos): "8 el daemon de Docker no es local". Constante `$script:ExitCodeRemoteDocker = 8` (`dev-lib.ps1:12`) |
| **S-3** | RESUELTO | `backend/.gitignore`: `.env.*` en la seccion dotenv; el `!.env.example` del final sigue despues, por lo que el ejemplo no queda ignorado |
| **N-1** | RESUELTO | `Start-DevWindow` (`:853-863`): si no se lee `StartTime`, `taskkill.exe /PID <$p.Id> /T /F`. `$p` es el objeto devuelto por `Start-Process -PassThru` de esa misma llamada: solo el PID recien lanzado (y sus hijos). No usa nombres de proceso, puertos ni el archivo de PIDs. Si `taskkill` falla, avisa el PID y pide cerrar a mano. Ambos caminos terminan con codigo 5. Sin test (requiere lanzar una ventana real); aceptable |
| **N-2** | ABIERTO (no es del desarrollador) | Ver hallazgos nuevos, N-3 |

## Regresiones
Ninguna. Las 186 aserciones pasan; `compose config` y `tsc` en 0. Los valores existentes de `docker-compose.yml` (`restart`, `depends_on`, secretos con `${VAR:?}`, volumen) no cambiaron salvo lo pedido. El cambio de `5433` a `127.0.0.1:5433` no afecta a `dev.ps1` ni a Prisma (usan `localhost:5433`; Docker Desktop publica en IPv4 de loopback y `localhost` cae a IPv4). Sintaxis compatible con 5.1 (los tests corren en 5.1; sin `??`, `?.`, `&&`).

## Hallazgos nuevos

### BLOQUEANTE
Ninguno.

### MAYOR
Ninguno.

### MENOR
- **N-3.** `.claude/settings.json` sigue apareciendo modificado en `git status` (`3 insertions, 1 deletion`): son permisos que agrega el harness al aprobar comandos de las revisiones, no parte del feature. No lo toque (no edito configuracion). El PO debe revertirlo antes de cualquier commit (regla 12 / N-2 anterior) o no incluirlo en el `git add`.
- **N-4.** `Test-DockerEndpointLocal` rechaza `tcp://127.0.0.1:2375` / `tcp://localhost:...` (Docker Desktop con "Expose daemon on tcp://localhost:2375"). Es un falso negativo conservador y aceptable (falla cerrado, con mensaje y pista de `docker context use default`); no afecta a la configuracion estandar de Docker Desktop. Opcional: aceptar `tcp://` solo si el host es `localhost`, `127.0.0.1` o `[::1]`, y documentarlo.
- **N-5.** Quien hoy use el stack Docker desde otro dispositivo de la LAN lo perdera hasta poner `BIND_ADDRESS=0.0.0.0` (ya avisado en `.env.example` y en 04, nota de la vuelta 2). El documentador debe reflejarlo en la guia de cierre.

## Conformidad
| Criterio | Estado |
|---|---|
| Spec y diseno (dev.ps1, compose, .env, seeds, detener) | OK |
| Reglas del proyecto 2, 3, 10 | OK (la regla 10 queda cubierta con el codigo 8) |
| Regla 7 (tsc, lint, tests) | OK: tests 186/186, `tsc` y `compose config` sin errores |
| Docs | Pendiente del documentador (como antes) |

Veredicto vuelta 3: APROBADO

Veredicto vigente (vuelta 4, cambio FRONTEND_PORT): APROBADO. Ver el VEREDICTO al final de la seccion de arriba.
