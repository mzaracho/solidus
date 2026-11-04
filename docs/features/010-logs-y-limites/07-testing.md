# 07 — Testing: 010-logs-y-limites

> Autor: tester. Fecha: 2026-11-04. No se modificó código de producción ni se agregaron tests (los 567 tests de Jest cubren los 8 criterios; la verificación en vivo los confirma). Sin seeds, sin SQL de escritura, sin commit, push, stash, reset ni checkout. No se tocaron los puertos 3000 ni 3001 ni `.env` ni `.claude/`. `backend/.env` solo lo modificó `.\dev.ps1 -Init`. Token HS256 firmado en memoria (issuer `solidus-api`, audience `solidus-web`, 10 min); no se imprimió ni guardó ningún token, secreto o dato personal. Scripts y log auxiliares en el scratchpad.

## 1. Resultados automáticos

| Comando | Resultado |
|---|---|
| `backend: npx tsc --noEmit` | Sin errores |
| `backend: npx jest` | 32 suites, 567 tests, todo en verde |
| `scripts\dev-lib.tests.ps1` | 1026 OK, 0 fallidos |
| `.\dev.ps1 -Init` (x2) | 1.ª: avisa que quita la clave (sin valores) y remite a `-ExportCa`. 2.ª: sin aviso |
| `.\dev.ps1` (desarrollo, `FRONTEND_PORT=3002`, sin Docker) | OK, backend y frontend responden |
| `.\dev.ps1 -Smoke` | Backend OK, Frontend OK, Login OK |
| `.\dev.ps1 -Stop` | OK, datos conservados |

## 2. Verificación en vivo

Los backends del `dev.ps1` escriben en una ventana propia, cuyo log no se puede capturar. Para auditar las líneas de acceso levanté un backend auxiliar (`ts-node`, mismo código y misma base, puerto 8090, `NODE_ENV=development`) con la salida a un archivo del scratchpad, y lo detuve al final (solo ese PID).

| Caso | Esperado | Obtenido | Línea de acceso |
|---|---|---|---|
| GET `/api/activity?secretq=1`, token válido, org propia | 200 | 200 | `GET /api/activity 200 2132ms` (sin query) |
| GET sin token | 401 | 401 | `GET /api/activity 401 7ms` |
| GET con org ajena | 403 | 403 `org-access-denied` | `GET /api/activity 403 18ms` |
| GET ruta inexistente | 404 | 404 | `GET /api/no-existe-xyz 404 3ms` |
| POST con body de 2 MB | 413 `payload-too-large` genérico | 413, `{"code":"payload-too-large","errors":[{"message":...}]}`, sin stack ni details | `POST ... 413 10ms` |
| POST con JSON inválido | 400 genérico | 400 `bad-request`, genérico | `POST ... 400 14ms` |
| POST con `Content-Encoding: foo` | 415 genérico | 415 `unsupported-media-type`, genérico | `POST ... 415 0ms` |

- 7 requests, 7 líneas de acceso con formato `METHOD ruta STATUS Nms`, exactamente una por request.
- Ausentes en el log (conteo 0): `Bearer`, `eyJ` (JWT), `cookie`, `@` (emails), `password`, el id del usuario, el id de la organización y el valor de la query. El debug del interceptor redacta la query (`[REDACTED]`).
- Los POST de prueba fallaron antes de escribir (413/400/415 en una ruta inexistente).
- Arranque con `NODE_TLS_REJECT_UNAUTHORIZED=0` solo en el entorno de un proceso auxiliar (puerto 8091, `ts-node`): no arranca. Mensaje: "NODE_TLS_REJECT_UNAUTHORIZED=0 desactiva la verificación TLS ... use .\dev.ps1 -ExportCa". `.env` y `backend/.env` no se modificaron para esta prueba.
- `backend/.env`: líneas que empiezan con `NODE_TLS_REJECT_UNAUTHORIZED` antes de `-Init`: 1. Después del primer `-Init`: 0. Después del segundo: 0.

## 3. Criterio por criterio

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Línea de acceso para todo request (200, 401, 403, 404, 400, 413, 415; una vez; warn en 4xx/5xx) | Vivo (sección 2) y `access-log.spec` (200, 401, 403, 404, 413, 400, 415, 500) | Cumple |
| 2 | Sin datos sensibles | Vivo: 0 coincidencias de Bearer, JWT, cookie, email, password, ids, query; Jest con `userId`, `orgId`, token, firma, email, cookie y query | Cumple |
| 3 | Límite del body: default 1mb, validación al arrancar, 413 genérico y logueado | `body-parser-config.spec` (default, válidos, rechazo de 50mb, 11mb, 0, negativos, unidades inválidas); vivo: 2 MB da 413 genérico, con línea de acceso | Cumple (el arranque con valor inválido de `BODY_SIZE_LIMIT` se cubrió solo con Jest) |
| 4 | Sin `NODE_TLS_REJECT_UNAUTHORIZED=0` | `-Init` quita la clave y avisa una vez (vivo); backend no arranca con la variable en el entorno (vivo); `runtime-env.spec` y caso 3 de `dev-lib` actualizados | Cumple |
| 5 | Documentación operativa | `.env.example` y `backend/.env.example` con `BODY_SIZE_LIMIT` (en `git status` figuran modificados). `COMANDOS.md` queda para el documentador (no verificado aquí) | Cumple (COMANDOS.md pendiente del documentador) |
| 6 | Tests | Jest 567 en verde, `dev-lib` 1026 OK | Cumple |
| 7 | Calidad | `tsc` sin errores, Jest y `dev-lib` en verde. ESLint no lo corrí (lo informa 04/05) | Cumple (ESLint según 04) |
| 8 | Verificación en vivo | Sección 2: clave ausente, `-Smoke` OK, líneas para 200/401/403/404, 413 a 2 MB, sin tokens ni contraseñas, conteos sin cambios | Cumple |

## 4. Conteos (solo `SELECT count`)

| Momento | User | Organization | Patient | WorkItem | Total filas de `public` (sin `_prisma_migrations`) |
|---|---|---|---|---|---|
| Antes | 9 | 3 | 72 | 324 | 1483 |
| Después | 9 | 3 | 72 | 324 | 1483 |

## 5. Bugs

Ninguno que bloquee los criterios. Observaciones, no bloqueantes y fuera de alcance (013):
- Los cuerpos de 401, 403 y 404 de los filtros siguen incluyendo `details` con el JSON de la excepción (sin stack). Es el comportamiento previo; la spec lo deja a la 013. Los errores del body parser (413, 400, 415) ya salen sin `details`.

## 6. Qué no pude verificar

- Los logs de las ventanas que abre `dev.ps1`: no son capturables; se auditó un backend auxiliar equivalente.
- Arranque con `BODY_SIZE_LIMIT` inválido: solo Jest (función pura).
- Que el aviso de `-Init` cubra la variable de entorno del sistema (la spec lo limita al archivo): el chequeo de arranque sí la cubre (probado).
- ESLint de los archivos tocados.
- Modo Docker (fuera de la salvaguarda).

## 7. Estado del entorno

- `.\dev.ps1 -Stop` ejecutado: backend, frontend y base detenidos, volumen intacto. Puertos 3002, 8080, 8090, 8091 y 5433 libres. Los puertos 3000 y 3001 no se tocaron.
- Docker Desktop ya estaba encendido.
- `backend/.env` sin `NODE_TLS_REJECT_UNAUTHORIZED` (comportamiento esperado). `.env` raíz y `.claude/` sin cambios míos (`.claude/settings.json` ya figuraba modificado antes).

VEREDICTO: APROBADO
