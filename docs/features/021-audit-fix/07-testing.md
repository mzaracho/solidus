# 021 — Testing

Tester. Fecha: 2026-11-18. Node 24.13.0, npm 11.6.2, `NODE_OPTIONS=--use-system-ca` (TLS nunca se desactivó). No se modificó código ni
dependencias del repo; no se ejecutó `next upgrade`, commit ni escrituras en la base. Los 4 archivos `package*.json` tienen el mismo SHA-1
antes y después de toda la sesión (incluido el reinstalado de `dev.ps1`).

## 1. Instalación limpia (copia temporal)

| Proyecto | Comando (en copia de `package.json` + `package-lock.json`, `--ignore-scripts`) | Resultado |
|---|---|---|
| backend | `npm ci --legacy-peer-deps` | OK; lock con SHA-1 idéntico; `npm ls axios @nestjs/axios` vacío; `npm audit --omit=dev` = 4 moderados |
| frontend | `npm ci` | OK; lock con SHA-1 idéntico; `npm audit` = 0; `npm ls next` = 16.4.6 |

El repo conserva su `node_modules` (sin borrarlo); `dev.ps1` en el arranque en frío hizo su propia verificación de dependencias sin cambiar locks.

## 2. Backend

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` | 0 errores |
| `npx nest build` | OK, existe `dist/src/api/main.js` |
| `npm test` | **58 suites / 1036 tests, todo verde** (incluye `dependency-floors.spec.ts` y `body-parser-gzip.spec.ts`) |
| `npx prisma validate` / `generate` | OK / OK |
| `npm audit --omit=dev` | 0 críticos, 0 altos, 4 moderados (`@nestjs/core` SSE, `@nestjs/common`, `file-type`, `platform-express`; van al 022) |
| `npm audit` (todo) | 18: 0 críticos, 4 altos, 11 moderados, 3 bajos (cadena dev de `@nestjs/cli`; van al 022) |
| `npm ls axios @nestjs/axios --legacy-peer-deps` | `(empty)` |
| Versiones instaladas (raíz) | express 4.22.3, body-parser 1.20.9, multer 2.5.0, proxy-addr 2.0.8, qs 6.16.2, lodash 4.18.1; `path-to-regexp` raíz 3.3.0 (la 0.1.13 y la 8.4.2 son anidadas y las verifica `dependency-floors.spec.ts`, verde). Todas >= pisos |
| Lint `npx eslint "{src,apps,libs,test}/**/*.ts"` (sin --fix) | 755 errores / 153 advertencias = valor esperado (deuda aceptada por el PO para el 025; no peor) |

## 3. Frontend

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` | 0 errores |
| `npm test` | 148 pass / 0 fail |
| `npm audit` | 0 vulnerabilidades |
| `npm ls next` | 16.4.6 |
| `npm run lint` | 140 errores / 42 advertencias (igual a la base) |
| `npm run build` en frío (se borró `.next`) | Exit 0 a la primera; 0 coincidencias de `SecurityFatalError` / "known security" |

## 4. `.\dev.ps1 -CheckMigrations`
Exit 0: "Schema y migraciones coinciden".

## 5. Arranque en frío real (2 corridas)
Cada corrida, en una misma invocación: `.\dev.ps1 -Stop`, borrar `frontend\.next`, `.\dev.ps1`, `.\dev.ps1 -Smoke`.

| Corrida | `dev.ps1` | `-Smoke` |
|---|---|---|
| 1 | exit 0; backend y frontend responden (3002) | exit 0: Backend OK, Frontend OK, Login OK (cookie HttpOnly, sin token en el cuerpo) |
| 2 | exit 0 | exit 0: Backend OK, Frontend OK, Login OK |

Conteos por tabla (solo SELECT, consulta del procedimiento 016): corrida 1, corrida 2 y tras las pruebas funcionales son idénticos
(ActivityType 3, Organization 3, OrganizationMember 8, Patient 72, Payer 5, Professional 12, ProfessionalCategory 9, Role 2, User 9, UserRole 8,
WorkItem 324, WorkItemParticipant 352, WorkItemSplit 676; el resto 0). Limitación: el contenedor de la base no estaba levantado al
empezar (lo levanta `dev.ps1`), así que el primer conteo se tomó después del primer arranque y no antes; no hay escrituras en el flujo
de arranque más allá de `migrate deploy` sin migraciones pendientes. Se cerró con `.\dev.ps1 -Stop` (puertos 8080 y 3002 sin respuesta).
No se tocaron 3000/3001.

## 6. Funcional mínimo (backend levantado por `dev.ps1`)

| Prueba | Resultado |
|---|---|
| `GET /health/liveness` | 200 |
| Login por cookie (usuario de humo) | 201; cookie `solidus_session` HttpOnly; sin `token` en el cuerpo |
| GET autenticado (`/api/pro/memberships`) con cookie / sin cookie | 200 / 401 |
| Body JSON normal (login con credenciales inválidas) | 401 controlado |
| Body gzip válido (`Content-Encoding: gzip`) | 401 (se descomprimió y se procesó) |
| Body gzip con bytes de más después del frame | 400 controlado, sin 500 ni caída |
| Body con `Content-Encoding: gzip` no gzip | 400 controlado |
| Liveness después de todo lo anterior | 200 (el proceso sigue vivo) |
| Swagger `/docs` | 404: `backend/.env` no define `NODE_ENV` y se trata como producción. Esperado, no es regresión |

Nota: el 429 que apareció en una pasada intermedia fue el rate limit del login (012) por repetir el mismo usuario inválido; no es un defecto.

## 7. Docker
`docker compose build backend frontend` corta con `additional privileges requested: pass "--allow=fs.read=backend\\Dockerfile"` (buildx, #104).
**No verificable.** No se forzó ni se ejecutó `up`/`-Docker`.

## 8. Criterios

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Next >= 16.4.6, sin `SecurityFatalError` en build y primer `dev.ps1` en frío | `npm ls next` 16.4.6; build en frío OK; dos arranques en frío OK a la primera | Cumple |
| 2 | Frontend `npm audit fix` sin force; `--omit=dev` sin altos/críticos | `npm audit` = 0 (también sobre `npm ci` limpio) | Cumple |
| 3 | Backend: corregible sin major; `proxy-addr` resuelto; lo restante listado | proxy-addr 2.0.8, body-parser 1.20.9, express 4.22.3, multer 2.5.0; prod 0 crít./0 altos; 4 moderados y cadena dev al 022 | Cumple |
| 4 | Sin majors de Nest/Prisma/React/Next/TS | Versiones sin cambio de major (tsc, build y 1036 tests verdes con Nest 10 / Prisma 5.22) | Cumple |
| 5 | #61: se quitan `axios` y `@nestjs/axios` | `npm ls` vacío; build y tests verdes; test de pisos lo comprueba | Cumple |
| 6 | Lockfiles coherentes; `npm ci` desde cero | `npm ci` OK en copias, locks idénticos | Cumple |
| 7 | Calidad: tsc/build/test/prisma/CheckMigrations/lint/smoke a la primera; Docker se intenta | Todo verde y lint no peor (755/153 y 140/42); Smoke OK x2; Docker no verificable (#104, informado) | Cumple (Docker: no verificable, aceptado por la spec) |
| 8 | Seguridad de dependencias; rangos que no reabren avisos | Revisado en 05/06 (APROBADO); pisos `^4.0.4`/`^11.4.8` y overrides con `^` verificados por `dependency-floors.spec.ts` verde | Cumple |

## Bugs
Ninguno.

## No verificado
- Build Docker (#104).
- El corte/menú de `agentUpgrade: false` con una versión vulnerable de Next (no hay una instalada; solo lectura de código).
- Reproducción del DoS GHSA-27r3 con body-parser 1.20.4 (no se reproduce en Node 24; la protección real es el piso de versión).
- Conteos de base "antes" de la primera corrida (DB caída al inicio).
- Los `invalid` de `npm ls` por overrides sobre `express` se asumen benignos (documentado; `npm ci` y tests verdes).

VEREDICTO: APROBADO
