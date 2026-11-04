# 07 — Testing: 015-transacciones

> Autor: tester. Fecha: 2026-11-04. No se modificó código de producción ni se agregaron tests (los 815 de Jest del desarrollador cubren los criterios; la verificación contra Postgres real se hizo sobre una copia descartable). Sin seeds, TRUNCATE, `down -v`, prune, commit, push, stash, reset ni checkout. Puertos 3000/3001 intactos; FRONTEND_PORT=3002; sin `-Docker`. Tokens HS256 firmados en memoria (issuer `solidus-api`, audience `solidus-web`, 10 min); no se imprimió ni guardó ningún token, secreto, URL con credenciales ni dato personal. Scripts auxiliares solo en el scratchpad.

## 1. Resultados automáticos (base)

| Comando | Resultado |
|---|---|
| backend `npx tsc --noEmit` | Sin errores |
| backend `npm test` | 45 suites, 815 tests, todo en verde |

## 2. Verificación en vivo sobre la base del usuario (solo smoke y lecturas)

- `.\dev.ps1` (con `FRONTEND_PORT=3002`): migraciones sin pendientes, backend y frontend OK.
- `.\dev.ps1 -Smoke`: **Backend OK, Frontend OK, Login OK**.
- Conteos (solo `SELECT` dentro de `BEGIN READ ONLY`):

| Momento | User | Organization | Patient | WorkItem | Total de filas de `public` (sin `_prisma_migrations`) |
|---|---|---|---|---|---|
| Referencia de la tarea (y copia al crearla, que se hizo con la base detenida) | 9 | 3 | 72 | 324 | 1483 |
| Después de `.\dev.ps1` y `-Smoke` (antes de `-Stop`) | 9 | 3 | 72 | 324 | 1483 |

Ninguna escritura sobre la base del usuario.

## 3. Escrituras reales: SOLO sobre una copia descartable

Procedimiento (con la base del usuario detenida, `healthops-gem-db-1` en `Exited (0)`):
1. Volumen `solidus-copy-015` creado por mí; el volumen del usuario `healthops-gem_solidus_postgres_data` se montó **`:ro`** en un contenedor efímero sin red (`solidus-volcopy-015`, `--rm`) que lo copió con `cp -a`.
2. Contenedor `solidus-copy-015` (`postgres:16.11-alpine`) sobre la copia, en `127.0.0.1:55439`. Contraseña nueva aleatoria para el rol **dentro de la copia** (`ALTER ROLE` por socket local; el volumen original no se tocó).
3. Preparación solo en la copia: una atención puesta en `UNPAID` sin fecha de pago (todas las originales eran `PAID`) y un paciente ficticio en la organización B (que no tenía pacientes).
4. Backend auxiliar `ts-node` del código actual en `127.0.0.1:8091`, con `DATABASE_URL` de la copia y `JWT_SECRET` solo en el entorno del proceso (sin escribir `.env`). Como la base del usuario estaba detenida, cualquier conexión equivocada habría fallado.
5. Se probó contra Postgres real que **Prisma 5.22 acepta el filtro extra `NOT: { paymentStatus, paymentDate: { not: null } }` en el `where` de `delete`** (nota del desarrollador): funciona.

Resultados (ADMIN de la organización A, salvo donde se indica; todos los errores con el contrato `code`/`errors` y 404 genérico idéntico):

| Caso | Esperado | Obtenido | Estado en la copia |
|---|---|---|---|
| `DELETE activity` PAID con fecha de pago | 403, sigue existiendo | 403 `forbidden` | La atención sigue (1 fila) |
| `DELETE activity` UNPAID sin fecha | 200 y deja de existir | 200 | 0 filas |
| `DELETE` de la misma otra vez | 404 | 404 `not-found` | — |
| `DELETE activity` PAID **sin** fecha de pago | 200 (la salvaguarda exige fecha) | 200 | 0 filas |
| `DELETE` con id inexistente | 404 genérico | 404 `not-found` | — |
| `DELETE` de atención de A con admin de B (header de B) | 404 idéntico al inexistente | 404 `not-found`, mismo cuerpo | La atención de A sigue |
| `DELETE` de atención de A con token de B y `x-org-id` de A | 403 de acceso a la org (guard, preexistente) | 403 `org-access-denied` | Sin cambios |
| `POST v1/patients/:id/merge` OK (mismas org) | 200, atenciones reasignadas | 200 | Origen borrado; el destino pasó de 21 a 43 atenciones (21 + 23 menos la atención borrada arriba); 0 atenciones huérfanas; total de atenciones 322 (324 menos las 2 borradas) |
| Merge de nuevo (origen ya borrado) | 404 | 404 `not-found` | — |
| Merge con destino inexistente | 404 sin cambios | 404 | Sin cambios |
| Merge con destino de otra organización | 404 sin cambios | 404 (mismo cuerpo) | Sin cambios |
| Merge con origen de otra organización / inexistente | 404 | 404 / 404 | Sin cambios |
| Merge con mismo id | 400 | 400 `bad-request` | — |
| `PUT org/staff/:id` con `canLoadActivities: null` (cuerpo válido) | 400 | 400, "canLoadActivities must be a boolean value" | Valor sin cambios |
| Ídem con `"x"` | 400 | 400 | Sin cambios |
| Controles: sin `canLoadActivities` / `false` | 200 | 200 / 200 | `false` guardado |

## 4. Criterio por criterio

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Relevamiento de handlers y servicios que escriben | `03-diseno-tecnico.md`; el desarrollador repitió el grep (04, paso 0) y la guardia lo confirma automáticamente sobre todo `src/` | Cumple (documental + guardia) |
| 2 | Toda operación con 2+ escrituras en `$transaction` interactiva | Jest: `transactions.spec` (10), guardia reglas A/B/C sin infracciones; en vivo en la copia: merge OK atómico (0 huérfanas, sin pacientes duplicados) | Cumple |
| 3 | Servicios llamados desde una transacción usan el cliente `tx` | Guardia regla B (ni `this.prisma` ni `prisma` dentro del callback); `transactions.spec` verifica `inTx: true` en las 4 escrituras de `createActivity` | Cumple |
| 4 | Sin cambios de comportamiento | En vivo: 403 (cobrada con fecha), 404 genéricos idénticos, 200 de merge y borrado, 400 de validación; `npm test` 815 verdes | Cumple |
| 5 | Guardia estática | `src/transactions-invariants.spec.ts` (19 casos, con casos positivos y negativos del detector); lista blanca vacía | Cumple |
| 6 | Tests de atomicidad (la segunda escritura falla y no queda nada) | `test/transactions.spec.ts` (createActivity x3, DeleteStaff x2, Merge x2), `fake-prisma.spec.ts` (rollback real del fake), `patients-handlers.spec`, `activity-handlers.spec` (4 casos del borrado). Más: merge y borrado contra Postgres real en la copia | Cumple |
| 7 | Calidad | `tsc` sin errores; `npm test` 45 suites / 815 tests en verde. ESLint: no lo corrí; lo informa 04 (sin errores nuevos respecto de HEAD) | Cumple |
| 8 | `-Smoke` OK y conteos sin cambios; escrituras con Jest | Sección 2: Backend OK, Frontend OK, Login OK; 9/3/72/324/1483 antes y después. Además, escrituras reales en la copia (sección 3) | Cumple |

## 5. Bugs

Ninguno.

Observaciones (no bloquean):
- Un body inválido de `PUT org/staff/:id` devuelve en `errors` el mensaje de campo en inglés (decisión del 013, igual que en el 014).
- `DELETE` de una atención PAID sin fecha de pago se permite (200): es coherente con la regla "cobrada con fecha de pago" de la spec, pero conviene que el PO lo sepa.

## 6. Qué no pude verificar

- **Las carreras reales** (dos sesiones simultáneas: fusión concurrente que comparte un paciente; cobro concurrente durante el borrado). Se cubren con mocks en Jest (`count: 1` → 404; P2025 con fila presente → 403, sin fila → 404) y se verificó en Postgres real el camino de cada rama secuencial, pero no una colisión en paralelo con bloqueo de filas. La rama P2025 del borrado contra Postgres real tampoco se ejerció (requeriría cambiar el estado entre la lectura y el `delete`).
- ESLint (según 04) y modo Docker.
- Interfaz del navegador (el feature no toca el frontend).

## 7. Contenedores y volúmenes

| Recurso | Estado |
|---|---|
| Volumen `solidus-copy-015` | Creado y **eliminado** (`docker volume rm`) |
| Contenedor `solidus-copy-015` (127.0.0.1:55439) | Creado y **eliminado** (`docker rm -f`) |
| Contenedor `solidus-volcopy-015` (sin red, `--rm`, volumen del usuario `:ro`) | Se eliminó solo |
| Backend auxiliar (8091) | Detenido; puerto libre |

Fuera de lo que creé, siguen existiendo tres volúmenes anónimos que **no son míos** (nombres que empiezan con `23a9e9ef…`, `70aa28d1…` y `d9e4e4f6…`); el último es el que `016/03-diseno-tecnico.md` pide borrar al usuario. No los toqué.

## 8. Estado del entorno

- `.\dev.ps1 -Stop` ejecutado: 2 procesos y el contenedor `healthops-gem-db-1` detenidos (`Exited (0)`); datos conservados. 3000 y 3001 no se tocaron.
- `scripts/dev-lib.tests.ps1` sigue en disco.
- Solo se suma este `07-testing.md`; `.env`, `backend/.env` y `.claude/` sin cambios. El archivo con la URL de la copia en el scratchpad se borró.

VEREDICTO: APROBADO
