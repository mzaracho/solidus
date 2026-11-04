# 015 — Revisión

Revisor, 2026-11-04. Base `9e7f321`. Sin cambios de código.

## Resultados
- `npx tsc --noEmit` (backend): 0 errores.
- `npm test` (backend): 45 suites, 815 tests, todo en verde.
- `npx eslint` por archivo contra `git show HEAD:`: delete-activity 3→3, merge 5→5, staff-commands 23→23, activity-type-commands 23→23, fake-prisma.ts 4→4;
  `prisma-writes.ts`, `transactions-invariants.spec.ts` y `transactions.spec.ts` en 0. Sin errores nuevos.
- Cumplimiento: los 8 criterios y el diseño están cubiertos. No hay desvíos de fondo.

## Bloqueantes
Ninguno.

## Mayores
Ninguno.

## Menores
- **m1 — Falsos negativos del analizador** (`backend/test/helpers/prisma-writes.ts`, `isWrite` líneas 68-86 y `isUnit` líneas 97-106). La guardia no ve:
  1. Alias del cliente: `const p = this.prisma; await p.a.create(); await p.b.create();` y `const { patient } = this.prisma`.
  2. `this.prisma.$executeRaw\`...\``: es una `TaggedTemplateExpression`, no una `CallExpression`. Hoy no hay usos en `src/`, pero la regla A lo declara como escritura y no la detecta.
  3. Servicios inyectados que no se llamen `this.<x>Service` (la regex `DELEGATED_OWNER`) o métodos fuera de `DELEGATED_METHOD` (p. ej. `register`, `close`, `assign`).
  4. Propiedades de clase con arrow (`foo = async () => {...}`) y métodos de object literal: `isUnit` no las toma como unidad, así que no se analizan.
  5. Una escritura fuera de `$transaction` más una dentro (`writesOutsideTx` = 1, no llega a 2): atomicidad parcial no detectada.
  Hoy no hay casos reales (el grep manual del paso 0 lo confirma), y la limitación 3 ya está documentada. Sugerencia: agregar los puntos 1, 2 y 4 a la cabecera "Limitaciones", y para el 1 y el 2 sumar
  `ts.isTaggedTemplateExpression` en `visit` y un chequeo de `VariableDeclaration` cuyo inicializador sea `this.prisma`/`prisma` (marcar la unidad como "alias" y fallar si tiene escrituras, o contar el alias como cliente).
  Para el 5 se puede exigir que una unidad con `$transaction` y escrituras fuera de ella sea infractora (regla A').
- **m2 — Falta una prueba del detector por cada limitación** (`src/transactions-invariants.spec.ts`). Las pruebas cubren bien los falsos verdes principales (await+await, await+return, bucle, map, Promise.all, delegada,
  B, C, función de primer nivel, `Map.delete`), pero ninguna fija el comportamiento ante alias o `$executeRaw` con plantilla. Sugerencia: un caso `it.todo` o una prueba que documente la limitación vigente.
- **m3 — `fake-prisma`: el contador de `failOn` no se revierte con el rollback** (`fake-prisma.ts`, `record`). Es correcto para el uso actual (un fallo inyectado se consume una vez). Solo conviene dejarlo escrito
  en el comentario de cabecera, porque un test que reintente la operación dentro de otra transacción no volverá a fallar.
- **m4 — `fake-prisma`: la instantánea es superficial por fila** (`snapshot[m] = rows.map(r => ({...r}))`). Alcanza mientras las filas no tengan valores anidados mutados en el lugar (p. ej. `settings` JSON). Hoy los `update`
  hacen `Object.assign` con valores nuevos, así que no hay problema; anotarlo en el comentario.
- **m5 — `merge-patient-command.ts`, línea 59-68**: el `updateMany` de bloqueo reescribe `updatedAt` de ambos pacientes (efecto visible solo en la base). Aceptado y documentado en 04; mencionarlo en la spec/CHANGELOG
  para que nadie lo tome por un cambio de dominio. En Postgres real, dos fusiones cruzadas (A→B y B→A) bloquean filas en orden no garantizado y podrían dar deadlock (`P2034`/40P01), que hoy sale como 500.
  Sugerencia: ordenar los ids (`[sourceId, targetId].sort()`) no alcanza con `updateMany`; aceptar el riesgo (caso rarísimo, la base aborta una de las dos sin corrupción) y anotarlo en el BACKLOG.
- **m6 — Documentación**: `CLAUDE.md` sigue diciendo "Jest (13 suites)" (ahora 45). Ya lo registró el desarrollador para el documentador.

## Sugerencias
- Delete de atención (`delete-activity-command.ts`, líneas 56-77): la lógica es correcta. `NOT: { paymentStatus: PAID, paymentDate: { not: null } }` es `NOT (A AND B)`; `paymentStatus` es no nulable
  (`@default(UNPAID)`) y `paymentDate` se compara con `IS NOT NULL`, así que no hay lógica trivaluada que excluya filas por error. P2025 → `findFirst` con `inScope(scope)` → 404 genérico (`resourceNotFound`) o el mismo 403
  de hoy (mensaje y `code` idénticos, vía `paidActivityForbidden`). Otros errores se propagan. Cubierto por 4 casos en `activity-handlers.spec.ts`. Opcional: un test de integración con Postgres real (ya lo anota 04 para el tester) porque
  el fake solo simula el filtro extra en `delete`.
- Merge de pacientes: `updateMany` con `organizationId: source.organizationId` e `id in [...]`, `count !== 2` → `resourceNotFound()`; `sourceId === targetId` ya se rechaza antes con 400, así que no hay riesgo de `count` 1 por ids repetidos.
  El test de atomicidad simula la carrera correctamente (borrado del destino antes de la transacción, `rolledBack`, solo `patient.updateMany` intentado).
- `fake-prisma.ts`: rollback real (restaura tablas, trunca `writes`, relanza el mismo error), `inTx` correcto, `failOn` antes de aplicar, P2025 en `update`/`delete`. `rows()` devuelve copias, así que las comparaciones
  `snapshot(before)` vs después no son triviales. `org-isolation.spec.ts` no cambia de resultado; no se debilitó ningún test previo (solo se agregaron casos).
- #70: `staff-commands.ts` línea 156 usa `@IsOptionalNotNull()` + `@IsBoolean()` (null → 400); import correcto; tests de `canLoadActivities` null/string y de roles `[null]`, `[1]`, `["x"]` en create y update.
  Comentarios de `ActivityTypeRoleDto` coinciden con el handler (`isRequired ?? true`, `feeStrategy` ausente sin clave). Imports de N3 partidos a mano, sin ruido.
- Seguridad (lo evidente): ningún endpoint nuevo; organización siempre del scope; 404 y 403 siguen el contrato del 013 y del 007.

VEREDICTO: APROBADO
