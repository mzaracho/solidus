# 07 — Testing: 013-errores-sin-details (incluye vuelta 1)

> Autor: tester. Fecha: 2026-11-04. No se modificó código de producción ni se agregaron tests (los 682 de Jest y los 53 del frontend cubren los criterios; la verificación en vivo los confirma). Sin seeds, SQL de escritura, commit, push, stash, reset ni checkout. Puertos 3000/3001 intactos; FRONTEND_PORT=3002; sin Docker para la app. Token HS256 firmado en memoria (issuer `solidus-api`, audience `solidus-web`, 10 min); no se imprimió ni guardó ningún token, secreto o dato personal. Solo emails ficticios `*@example.test`; el usuario de humo no se usó para provocar el 429. Scripts y log auxiliares solo en el scratchpad.

## 1. Resultados automáticos

| Comando | Resultado |
|---|---|
| backend `npx tsc --noEmit` | Sin errores |
| backend `npx jest` | 39 suites, 682 tests, todo en verde |
| frontend `npx tsc --noEmit` | Sin errores |
| frontend `npm test` (`node --test`) | 53 tests, 0 fallas |
| frontend `npm run build` (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK |
| ESLint | No lo corrí; lo informan 04 y 05 (sin errores nuevos; quedan los preexistentes) |

## 2. Verificación en vivo (modo desarrollo)

`.\dev.ps1` levantó DB, backend (8080) y frontend (3002). `.\dev.ps1 -Smoke`: Backend OK, Frontend OK, Login OK.
Las pruebas se hicieron contra el backend principal (8080) y contra un backend auxiliar (puerto 8081, `ts-node`, salida a un log en el scratchpad) para poder leer el log. Resultados idénticos en ambos. Para cada respuesta el script comprobó: claves del body, ausencia de `details`, stack, "prisma", "clientVersion", "invalid", HTML, id de usuario y de organización.

| Caso | Esperado | Obtenido |
|---|---|---|
| GET `/api/activity` sin token | 401 `unauthorized`, claves `code,errors` | 401, `unauthorized`, "No autorizado.", sin fugas |
| GET con token válido y `x-org-id` UUID ajeno | 403 `org-access-denied` | 403, `org-access-denied`, "No tenés permiso para realizar esta acción." |
| GET `/api/activity/<uuid aleatorio>` (recurso inexistente/ajeno) | 404 `not-found` | 404, "No se encontró el recurso." |
| GET `/api/activity/abc` (id inválido) | Mismo cuerpo | 404, cuerpo idéntico al anterior |
| GET `/api/no-existe` | 404 `not-found`, sin `Cannot GET` | 404, cuerpo idéntico byte a byte a los dos anteriores |
| POST login con campo ausente (`user` ficticio, sin `password`) | 400 `validation-failed` | 400, `validation-failed`, 3 mensajes de class-validator (inglés, sin valores) |
| POST login con objetos en `user` y `password` | 400 `validation-failed` | 400, `validation-failed`, 4 mensajes, sin valores |
| POST login con body de 2 MB | 413 `payload-too-large` | 413, `payload-too-large`, mensaje en español |
| POST login con JSON inválido | 400 genérico | 400, `bad-request`, "La solicitud no es válida." |
| GET `/api/activity?startDate=no-es-fecha&endDate=no-es-fecha` | 500 `unhandled-exception`, `X-Error-Id`, body genérico | 500, `unhandled-exception`, "Ocurrió un error en la aplicación. Por favor, intentá más tarde.", `X-Error-Id` presente y con formato UUID, body sin Prisma/Invalid/clientVersion/ids |
| Log del backend auxiliar tras el 500 | Una línea `error id=<uuid>`, clase y código, sin valores | Una sola línea: `error id=<uuid> GET /api/activity 500 PrismaClientValidationError`. Conteo 0 de: `no-es-fecha`, `clientVersion`, `Invalid`, consulta Prisma, `Bearer`, `eyJ`, id de usuario, id de organización |
| `X-Error-Id` en 4xx | Ausente | Ausente en los 401/403/404/400/413 |
| 429 del login (6.º intento con el mismo email ficticio; 5 x 401 antes) | 429 `too-many-requests`, `Retry-After`, sin `details` | 429, `too-many-requests`, `Retry-After: 900`, claves `code,errors`; el 401 previo también sin `details` |

Todas las respuestas tienen exactamente las claves `code` y `errors` (`[{ message }]`).

## 3. Criterio por criterio

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Contrato único `{ code, errors }`, sin `details`/stack/Prisma; códigos del frontend sin cambios | En vivo: 401, 403, 404 (x3), 400, 413, 429, 500 con solo `code,errors`; `org-access-denied`, `unauthorized` y el 404 genérico conservados. Jest: `error-contract.spec`, `error-filters.spec`, `org-isolation.spec` (helper `call` valida contrato en todo >= 400), invariante de claves de `ErrorResponse` | Cumple |
| 2 | 400 de validación con mensajes útiles | En vivo: `validation-failed` con mensajes de class-validator, sin valores enviados. Jest: tope de 20 mensajes y 200 caracteres | Cumple |
| 3 | 500: genérico, log con tipo/ruta/id, sin valores de consulta | En vivo: 500 genérico + `X-Error-Id` UUID; log solo con clase de Prisma, sin valores (conteos 0). Jest: log de Prisma sin `where` | Cumple |
| 4 | `throw new Error` de negocio a excepciones de Nest | Jest: CUIT duplicado 409, primera carga 400 `first-load-required`, falta profesional 400, `fee-resolution` controlado; invariante de lista blanca de `new Error(`. En vivo no se pudo provocar sin escribir datos | Cumple (en vivo: no verificado) |
| 5 | Falla de base en el guard: 500 genérico | Jest (`error-filters.spec`, B-1 con la base fallando). En vivo no se puede apagar la base sin afectar el entorno | Cumple (solo Jest) |
| 6 | Manejador final de Express | Jest: `final-error-handler.spec` (incluye `headersSent`, nunca HTML) y caso I-4 (middleware con `next(err)` sin `type`). En vivo: el JSON inválido y el 413 pasan por el contrato. El orden `init()` y `app.use` en el bootstrap real no tiene test propio (M-4 de revisión, menor) | Cumple |
| 7 | `axios-filter.ts` eliminado | Archivo borrado (staged), invariante de que no queda referencia, 682 tests en verde | Cumple |
| 8 | Frontend: sin `Failed to ...: {json}`, mensaje de `errors[0].message` o genérico en español, constantes | `node --test` 53 verdes (`api-errors.test.mts`, incluida la prueba estática sobre `data.ts`); build OK. Render de toasts: lista manual (sección 5) | Cumple (UI pendiente de comprobación manual) |
| 9 | Tests Jest y frontend | Cubren lo pedido; los tests existentes se ajustaron sin debilitarlos (según 04/05) | Cumple |
| 10 | Calidad | `tsc` backend y frontend sin errores, Jest 682, `node --test` 53, build OK; ESLint según 04/05 | Cumple |
| 11 | Verificación en vivo sin escribir | Sección 2 completa, `-Smoke` OK, conteos sin cambios (sección 4) | Cumple |

## 4. Conteos (solo `SELECT count`)

| Momento | User | Organization | Patient | WorkItem | Total filas de `public` (sin `_prisma_migrations`) |
|---|---|---|---|---|---|
| Antes (tras levantar y `-Smoke`) | 9 | 3 | 72 | 324 | 1483 |
| Después (antes del `-Stop`) | 9 | 3 | 72 | 324 | 1483 |

## 5. Lista de verificación manual en navegador (para el usuario)

1. `.\dev.ps1` y abrir http://localhost:3002.
2. Crear o editar algo con un error provocado (por ejemplo, un formulario con datos inválidos): el toast debe estar en español y sin JSON.
3. Eliminar una prestación (tipo de actividad) que tiene registros: debe verse el mensaje de conflicto (409) del backend, sin JSON.
4. Crear un profesional con un CUIT ya existente en la organización: toast con "Ya existe un profesional con ese CUIT en esta organización." (409).
5. Fallar el guardado de una atención (por ejemplo, un paciente no atendido previamente como profesional sin permiso de primera carga): debe aparecer un solo toast, no dos (M-8 corregido en la vuelta 1).
6. Con el backend detenido o ante un 500: toast genérico en español ("Ocurrió un error...") sin detalles técnicos.
7. 401 y 403 siguen igual: redirección al login y aviso de acceso.
8. `.\dev.ps1 -Stop` al terminar.

## 6. Bugs

Ninguno.

Observaciones (no bloquean): los mensajes de validación salen en inglés desde la API (decisión 4 del PO, el frontend muestra un genérico en español); el 429 y el 401 de login ya no llevan `details` (cierra la observación del 012).

## 7. Qué no pude verificar

- Toasts y render en navegador (lista manual, sección 5).
- 409 por CUIT duplicado, 409 al borrar prestación con registros, 400 `first-load-required`: requieren escrituras o datos específicos; cubiertos por Jest, no verificados en vivo.
- Falla real de base en el guard (B-1 del 006): solo Jest.
- 5xx de otra naturaleza que Prisma (Handler not found, `Error` genérico): solo Jest.
- Orden de `app.init()` y `app.use(finalErrorHandler)` en el bootstrap real: no hay test del bootstrap (M-4); en vivo los errores del body parser responden con el contrato.
- ESLint (según 04/05), modo Docker.

## 8. Estado del entorno

- Backend auxiliar (8081) detenido; `.\dev.ps1 -Stop` ejecutado al final: 2 procesos y contenedor detenidos, datos de la base conservados. Puertos 3002, 8080, 8081 y 5433 libres; 3000 y 3001 no se tocaron.
- `scripts/dev-lib.tests.ps1` sigue en disco (no se corrió; no aplica).
- Solo se suma este `07-testing.md`. `.env`, `backend/.env` y `.claude/` sin cambios míos.

VEREDICTO: APROBADO
