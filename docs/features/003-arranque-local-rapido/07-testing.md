# 07 - Testing: 003-arranque-local-rapido

> Autor: tester. Windows 11, Windows PowerShell 5.1 (`pwsh` no instalado), Docker Desktop. Todo se ejecuto con
> `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 ...`. No se leyeron ni imprimieron valores de
> `.env`, `backend/.env` ni respaldos (solo nombres, hashes y largos). Sin seeds, sin SQL de escritura, sin
> `BORRAR`, sin `down -v`/`volume rm`/`docker rm`, sin git stash/reset/checkout/commit/push. No se modifico codigo.

## Paso 0 - Limpieza del intento anterior
| Item | Hallazgo |
|---|---|
| `docker ps -a` | Solo `healthops-gem-db-1` (Exited, 18 min), `-backend-1` y `-frontend-1` (Exited hace 4 meses) del proyecto; otros proyectos ajenos (reto-solidario, n8n) intactos. **Ningun proyecto `solidus-clone-003`** (`docker compose ls -a` solo lista healthops-gem y reto-solidario). |
| Ventanas/procesos de dev.ps1 | Ninguno vivo; ningun node/powershell con ruta del repo. |
| Puertos 5433, 8080, 3000-3005 | Solo 3000 escuchando: node PID 19988 (pm2 de coach-claudio). No se toco. |
| `.dev/processes.json` | No existia (carpeta `.dev` vacia). |
| `%TEMP%\solidus-clone-003` u otras copias | No existian. |
| Estado de los .env | `.env` y `backend/.env` ya modificados por el intento previo (backend GENERADO, `.bak` presente, `.env` con `BIND_ADDRESS`). El prefijo de `.env` es byte a byte igual al respaldo `003-pre-tester\env.root`. |
| Accion | Nada que cerrar. Solo se hizo `docker compose start db` (sin recrear) para poder contar filas. |

## Paso A - Linea base
| Verificacion | Resultado |
|---|---|
| Variables `.env` | POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, JWT_SECRET, NEXT_PUBLIC_API_BASE_URL, SMOKE_USER, SMOKE_PASSWORD, BIND_ADDRESS (sin FRONTEND_PORT antes de configurarlo) |
| Variables `backend/.env` | DATABASE_URL, JWT_SECRET, NODE_ENV, APP_NAME, PORT, NODE_TLS_REJECT_UNAUTHORIZED, CORS_ORIGIN, CORS_METHODS (sin POSTGRES_*) |
| Volumenes (9) | 2 anonimos, backend_postgres_data, e-commerce_pgdata, healthops-gem_healthops_postgres_data, healthops-gem_solidus_postgres_data, healthops_healthops_pgdata, infra_healthops_pg, infra_node_modules, n8n_data, reto-solidario-tracking-system_pgdata (identicos al final) |
| Conteos | User 8, Organization 3, Patient 72, WorkItem 324, total public (sin `_prisma_migrations`) **1482** = esperado |
| `prisma migrate status` | 8 migraciones, "Database schema is up to date" |
| Hashes lock | frontend/package-lock.json `7A019FD2...`, backend/package-lock.json `521BA5F3...` |
| `git status` | `frontend/package-lock.json` ya figuraba modificado ANTES de las pruebas (preexistente, ver hallazgos) |

`FRONTEND_PORT=3002` (libre) agregado/ajustado en `.env`: el hash del contenido sin esa linea coincide con el hash del archivo previo (`54AF41E2...`); una sola linea, UTF-8 sin BOM, LF.

## Paso B - Modo desarrollo (FRONTEND_PORT=3002)
| # | Prueba | Resultado |
|---|---|---|
| B.1 | `.\dev.ps1` | **Codigo 0.** `backend/.env` empieza con `# GENERADO por dev.ps1`, 0 lineas `POSTGRES_*`. `.env` conservo su contenido. Mensajes: "Puertos 5433, 8080 y 3002 disponibles"; `migrate deploy` "No pending migrations"; `generate` OK. Dos procesos en `.dev/processes.json` (backend y frontend, powershell vivos); node del backend (`nest start --watch`) y del frontend con linea de comandos `next dev -p 3002`. URLs mostradas con 3002. Aviso de contrasena de menos de 16 caracteres (esperado, no se rota). |
| B.2 | HTTP | `:8080/` = 200; `:3002/login` = 200; `:3002/` = 307 a `/login`; `POST :3002/api/v1/auth/login` con credenciales ficticias = 401 (el rewrite de Next llega al backend por localhost). `next-development.log` sin `ENOTFOUND`/`ECONNREFUSED`/`backend:8080`. |
| B.3 | `-Smoke` | **Codigo 0.** "Backend OK", "Frontend OK (puerto 3002)", "Login saltado" (SMOKE_* vacios, no se cargaron). |
| B.4 | 2da ejecucion | **Codigo 0.** "El entorno ya esta levantado... No se relanza nada", URL con 3002, sin procesos nuevos (siguen 2 PIDs). |
| B.5 | `-Seed` con stdin `/dev/null` | **Codigo 0.** "Aviso: La base tiene datos... no hay consola interactiva" y "Seeds cancelados. No se modifico la base." Informa que `seed_activities.sql` y `seed_psicolsa.sql` no se cargan solos. Conteos = A. |
| B.6 | `-Docker` con dev levantado | **Codigo 2**: "Hay procesos del modo desarrollo levantados. Detene primero el modo desarrollo con .\dev.ps1 -Stop." |
| B.7 | `-Stop` | **Codigo 0.** "Procesos detenidos: 2". Sin procesos del repo, 8080/3002/5433 libres, `db` Exited, `.dev` vacio, mismos 9 volumenes, el 3000 de coach-claudio sigue (PID 19988, respondiendo). |
| B.8 | Conteos | 8 / 3 / 72 / 324 / 1482 = A. |

Limitaciones de B: (1) SSR autenticado no se pudo ejercitar: el middleware redirige toda ruta a `/login` sin cookie, y no se fabrico un token. La evidencia es indirecta (rewrite 401 desde 3002 hacia el backend y log sin errores `ENOTFOUND`). (2) El titulo de las ventanas ("Solidus backend (dev.ps1)") no es visible por `MainWindowTitle` (las ventanas viven en la terminal); se verificaron por PID en `processes.json` y por las lineas de comandos de node. (3) No se pudo leer la salida de las ventanas; solo el log de Next.

## Paso C - Modo Docker
| # | Prueba | Resultado |
|---|---|---|
| C.1 | `.\dev.ps1 -Docker` | **No verificable: codigo 3.** `docker compose up --build -d` fallo en el build del frontend, `RUN apk add --no-cache libc6-compat`: `TLS: server certificate not trusted` (APKINDEX de alpine). **Es del entorno, no del feature:** se reprodujo sin el proyecto con `docker run --rm node:22-alpine apk add libc6-compat` (mismo error; inspeccion TLS de la red/antivirus). El `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS` no ayuda (afecta a Next, no a `apk`) y no se modifico el Dockerfile. Antes del build, el chequeo de puertos dio "5433, 8080 y 3001 disponibles". No se levanto ningun contenedor. |
| C.2 | `-Smoke` con nada levantado | Codigo 7 con mensajes claros ("Backend no responde... Ejecuta .\dev.ps1", "Frontend no responde en el puerto 3002"). La rama "frontend en 3001" **no se probo en vivo** (cubierta por tests unitarios). |
| C.3 | Puertos publicados | Verificado sobre la configuracion resuelta (`docker compose config --format json`, solo puertos): `db 127.0.0.1:5433->5432`, `backend 127.0.0.1:8080->8080`, `frontend 127.0.0.1:3001->3000`; `restart: unless-stopped` en los tres. **Publicacion real con `docker ps` no verificada** (no hubo stack). |
| C.4 | `git grep -n "192\.168\."` | 0 fuera de docs/. En docs/ (para el documentador): `docs/auditoria/ARQUITECTURA.md:168` y `docs/auditoria/COMANDOS.md:123`. |
| C.5 | `-Stop` | **Codigo 0**, contenedores Exited (nada se elimino), mismos volumenes. Conteos = A. |

## Paso D - Clon nuevo simulado (`%TEMP%\solidus-clone-003`, 319 archivos de `git ls-files -co --exclude-standard`)
| Prueba | Resultado |
|---|---|
| Sin `.env` ni `backend/.env` antes | OK |
| `-Init` | **Codigo 0.** "`.env` creado... secretos aleatorios (no se muestran)", "backend\.env generado", "docker-compose.yml valido". |
| Largos / valores | POSTGRES_PASSWORD **48**, JWT_SECRET **64**, usuario != `change-me`, `FRONTEND_PORT=3000`, `BIND_ADDRESS=127.0.0.1`, SMOKE_USER presente. `backend/.env`: cabecera GENERADO, `DATABASE_URL` hacia `localhost:5433`, sin BOM. |
| Secretos en la salida | 0 coincidencias |
| 2da ejecucion | Hash de `.env` y `backend/.env` sin cambios |
| Borrar SMOKE_USER y re-ejecutar | Codigo 0; se re-agrega bajo `# Agregadas por dev.ps1`; el resto del archivo identico |
| `-Smoke` | **Codigo 7** (nada levantado), sin filtrar secretos |
| `docker compose config --quiet` en el clon | 0 |
| Limpieza | Carpeta borrada |

## Paso E y calidad
| Verificacion | Resultado |
|---|---|
| `scripts\dev-lib.tests.ps1` (5.1) | **240 OK, 0 fallidos**, codigo 0 |
| Parser de los 3 `.ps1` | 0 errores en los 3 |
| BOM `EF BB BF` | Presente en los 3 |
| Construcciones prohibidas (`??`, `?.`, `-AsHashtable`, `::Fill(`, `&&`, `\|\|`) | 0 |
| `npx tsc --noEmit` frontend / backend | 0 errores / 0 errores |
| `npx eslint src/services/data.ts` (frontend) | 15 problemas (13 errores, 2 warnings) = los preexistentes informados; sin nuevos |
| `docker compose config --quiet` | 0 |
| PowerShell 7 | **Solo estatico** (no instalado); no probado en ejecucion |
| `git check-ignore` | `.env`, `backend/.env`, `backend/.env.pre-003.bak`, `.dev/processes.json`, `frontend/.env.local` ignorados |
| Barrido de secretos (POSTGRES_PASSWORD y JWT_SECRET leidos en memoria) | 27 archivos revisados (toda la salida capturada de B, C, D y E, mas diff/archivos sin trackear del repo): **0 coincidencias** |

## Cierre del entorno
- `-Stop` ejecutado; sin ventanas, sin node del repo, sin contenedores de healthops-gem corriendo, `.dev` vacio. Solo escucha el 3000 de coach-claudio (PID 19988), intacto.
- Conteos finales 8 / 3 / 72 / 324 / 1482 = A.3. Volumenes identicos (9). Hashes de package-lock iguales a A.5.
- Capturas del scratchpad borradas. Carpeta del clon borrada.
- `git status` (fuera de `docs/features/`): ` M .claude/settings.json`, ` M .env.example`, ` M .gitignore`, ` M backend/.env.example`, ` M backend/.gitignore`, ` D backend/docker-compose.yml`, ` M docker-compose.yml`, ` M frontend/package-lock.json`, ` M frontend/src/services/data.ts`, `?? dev.ps1`, `?? frontend/.env.example`, `?? scripts/`. Solo lo esperado mas dos puntos de atencion (abajo).

## Criterios de la spec
| Criterio | Evidencia | Resultado |
|---|---|---|
| 1 Fuente unica | B.1, D (backend/.env generado, sin POSTGRES_*, DATABASE_URL derivada) | Pasa |
| 2 Sin IP fija | `git grep` fuera de docs/ vacio; build arg parametrizado; CORS_ORIGIN eliminado | Pasa |
| 3 SSR en dev | `data.ts` default localhost; sin `ENOTFOUND`; rewrite 401 | Pasa (SSR autenticado no ejercitado) |
| 4 Plantillas | D (clon desde `.env.example`), sin secretos en versionados (barrido 0) | Pasa |
| 5 dev.ps1 en 5.1 | B.1, tests 240 OK | Pasa en 5.1; **7 solo estatico** |
| 6 Primera vez | D (48/64, sin mostrar, no sobrescribe, idempotente) | Pasa |
| 7 Prerrequisitos y puertos | B.1 y C.1 (chequeo de 5433/8080/3002 y 3001) | Pasa (puerto ocupado ajeno cubierto por tests, no en vivo) |
| 8 Base | B.1 (migrate deploy + generate; sin db push) | Pasa |
| 9 Dependencias | B.1 "al dia" sin reinstalar; lockfiles intactos | Pasa |
| 10 Backend y frontend | B.1, B.2 | Pasa |
| 11 Modo Docker | C.1 | **No verificado en vivo** (falla TLS de `apk` del entorno) |
| 12 Detener | B.7, C.5 | Pasa |
| 13 Seeds | B.5 (cancela sin consola, conteos iguales); la rama interactiva con `BORRAR` no se ejecuto por salvaguarda | Pasa |
| 14 Humo | B.3, C.2, D | Pasa (login saltado; 3001 en vivo no probado) |
| 15 Probado de punta a punta | B y D completos; C parcial | Parcial (ver C.1) |
| 16 Calidad | tsc 0/0, eslint sin nuevos, compose 0 | Pasa |
| 17 Docs | Pendiente del documentador | Fuera de este paso |
| 18 FRONTEND_PORT | B.1 a B.7 con 3002 (`next dev -p 3002`, URLs, humo, puertos); validacion y limites por tests | Pasa |

## Hallazgos
1. **(Entorno, no bloquea) Build Docker falla por TLS de `apk` en esta PC.** Reproducible sin el proyecto. Para cerrar el criterio 11 hay que repetir `.\dev.ps1 -Docker` en una red sin inspeccion TLS o con el certificado raiz instalado en la imagen/VM. Pasos: `.\dev.ps1 -Docker` y observar `RUN apk add` del frontend.
2. **(Menor, cosmetico) Salida ruidosa en errores de comandos nativos.** Cuando `docker compose up --build` falla en 5.1 aparecen 9 lineas `System.Management.Automation.RemoteException` intercaladas con la salida del build (stderr envuelto como error). Reproducir: `.\dev.ps1 -Docker` con el build roto. No afecta al resultado.
3. **(Menor) Codigo de salida del fallo de `compose up --build` es 3**, que en el diseno es "Base de datos". Es un error de build, no de DB; el mensaje es claro, pero el codigo es confuso. No esta en la tabla de codigos del diseno.
4. **(Menor, informativo) Revision M-1 de la vuelta 4 confirmada en la logica**: la rama "ya esta levantado" toma el puerto del `.env` actual. No se reprodujo cambiando `FRONTEND_PORT` con el entorno vivo.
5. **(Atencion, regla 12) `.claude/settings.json` sigue modificado** (+18/-2): el harness agrego permisos de las pruebas (`Bash(cat >> *)`, `Bash(git show *)`, `powershell -NoProfile -Command ...`, `curl ...`, `docker run ...` y `"\\dev"` en `additionalDirectories`). No se edito. El PO debe moverlos a `settings.local.json` o descartarlos y no incluirlo en el `git add`.
6. **(Atencion) `frontend/package-lock.json` figura modificado** desde antes de las pruebas; su hash no cambio durante B, C y D (`7A019FD2...`), asi que no lo causo dev.ps1. Hay que revisarlo con `git diff` antes del commit (probable cambio del `npm install` de implementacion).
7. **(Informativo) `.env` con contrasena de menos de 16 caracteres**: el aviso aparece en cada ejecucion, correctamente. No se rota por diseno.

## Lo que no pude verificar
- Modo Docker completo (build, `up`, humo en 3001, publicacion real de 8080/3001 en 127.0.0.1) por el fallo de TLS del entorno.
- Login real del humo (SMOKE_USER/SMOKE_PASSWORD no cargados, por instruccion) y SSR autenticado con datos desde el navegador.
- PowerShell 7 en ejecucion (no instalado).
- Texto de las ventanas de backend/frontend (solo se leyo el log de Next).
- Rama interactiva de `-Seed` (escribir `BORRAR` esta prohibido; la cancelacion sin consola si se probo).
- Puerto ocupado por proceso ajeno en vivo (cubierto solo por los tests con listeners efimeros).
- Documentacion (criterio 17), pendiente del documentador.

## Veredicto
Todo lo verificable pasa (modo desarrollo con `FRONTEND_PORT=3002`, humo, idempotencia, seeds seguros, `-Stop` sin perdida de datos, clon nuevo, calidad, 0 secretos filtrados, datos intactos 8/3/72/324/1482). La unica brecha, el modo Docker (criterio 11 y parte del 15), no es un defecto del feature sino un fallo de TLS del entorno reproducido fuera del proyecto, y el diseno ya preveia fallos de TLS del build. Se aprueba con la condicion de repetir `.\dev.ps1 -Docker` y `-Smoke` (frontend en 3001) en una red sin ese problema antes de dar por cerrado el criterio 11.

VEREDICTO: APROBADO
