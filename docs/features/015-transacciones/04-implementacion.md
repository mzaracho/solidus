# 015 — Implementación: transacciones en toda operación que escribe varias tablas

Desarrollador, 2026-11-04. Base: `main` en `9e7f321` (014 ya commiteado). Sin commit ni push.

## Paso 0 — Relevamiento sobre el estado actual
Se repitió el grep del diseño (§2) sobre `backend/src/**` sin `*.spec.ts`: `create|createMany|update|updateMany|upsert|delete|deleteMany|$executeRaw*|$queryRaw*|$transaction`.
**Coincide con la tabla del diseño: el 014 no agregó escrituras.** Las únicas transacciones son `ActivityService.createActivity`,
`DeleteStaffCommandHandler` (rama con usuario) y `MergePatientCommandHandler`; todas las demás unidades escriben una sola vez
(las coincidencias de `login-rate-limiter.ts` y `redact.ts` son `Map.delete` / `Set.delete`). Sin hallazgos nuevos. La guardia
(paso 2) lo confirma de forma automática sobre todo `src/`.

## Qué se hizo por paso
1. **fake-prisma** (`backend/test/helpers/fake-prisma.ts`) y sus tests (`backend/test/helpers/fake-prisma.spec.ts`, 8 casos). Ver "Cambios en fake-prisma".
2. **Guardia**: `backend/test/helpers/prisma-writes.ts` (analizador) y `backend/src/transactions-invariants.spec.ts` (19 casos). Ver "La guardia".
3. **Tests de atomicidad**: `backend/test/transactions.spec.ts` (10 casos), sin tocar producción para createActivity y DeleteStaff.
4. **Merge de pacientes** con bloqueo y re-verificación (cierre de carrera 1).
5. **Borrado de atención** con la salvaguarda en el `where` (cierre de carrera 2).
6. Calidad (tsc, eslint, `npm test`) y #70 del BACKLOG.

## La guardia
Análisis estático con la API del compilador de TypeScript (sin dependencias nuevas). `analyzeSource(fileName, text)` devuelve un informe por
unidad (método, constructor, función o función asignada a una variable de primer nivel; lo anidado cuenta para la unidad).
- **Escritura directa:** `C.<modelo>.<op>` con `op` de escritura y `C` en `this.prisma|prisma|this.db|db`, o `C.$executeRaw[Unsafe]`.
  **Delegada:** `this.<x>Service.<create|update|delete|upsert|remove|merge|save…>`.
- **Regla A:** fuera de `$transaction`, 2 o más escrituras y al menos una no terminal (terminal = expresión directa de un `return` o cuerpo de arrow).
  Una escritura en un bucle o en `map/forEach/flatMap` cuenta como 2.
- **Regla B:** dentro de un callback de `$transaction` no aparece `this.prisma`, `prisma` ni `this.db` (si `prisma` es el parámetro del propio callback, no cuenta).
- **Regla C:** no existe `$transaction([ ... ])`.
- **Lista blanca** `TX_ALLOWLIST` (clave `archivo::Clase.método`): **vacía**. El spec exige que cada entrada exista, siga siendo infractora y tenga justificación.
- **Cómo se prueba el detector** (en el mismo spec, contra falsos verdes): dos `await create` seguidos, `await create` + `return update`, escritura en `for…of`,
  en `map`, dos en `Promise.all`, escritura delegada + directa (todos infractores); ramas excluyentes con `return`, una sola escritura, tres escrituras con `tx`
  en `$transaction(async (tx) => …)`, y `this.entries.delete` dos veces (no infractores); `findFirst` y `create` con `this.prisma` dentro del callback (B);
  `$transaction([a, b])` (C); función de primer nivel. Más un control: `ActivityService.createActivity` se detecta como unidad con 0 escrituras fuera de transacción.
- Resultado sobre el código actual: sin infracciones A, B ni C.
- Limitaciones (documentadas en `prisma-writes.ts`): helpers con otros nombres no se ven; ramas excluyentes sin `return` dan falso positivo.

## Cambios en fake-prisma
- `$transaction(fn)` toma una instantánea de las tablas (copia superficial por fila) y la longitud de `writes`; si `fn` lanza restaura todo, trunca `writes` y relanza el mismo error.
  Anidada: sin otra instantánea. El segundo argumento (opciones) se ignora; la forma de arreglo sigue con `Promise.all`.
- Cliente `tx` aparte que comparte las tablas: `FakeWrite` suma `inTx`. Una escritura con el cliente raíz mientras hay una transacción abierta queda con `inTx: false`.
- `transactions: { status: 'committed' | 'rolledBack'; writes }[]` para afirmar que hubo una transacción deshecha.
- `failOn({ model, op, nth = 1, error? })`: la enésima llamada que coincide lanza **antes** de aplicar (por defecto `PrismaClientKnownRequestError` `P2034`). `reset()` los borra.
- `update` y `delete` sobre una fila inexistente lanzan `PrismaClientKnownRequestError` `P2025` (antes `Error`). `org-isolation.spec.ts` no cambió su resultado.

## Tests de atomicidad (`test/transactions.spec.ts`)
- **createActivity:** (1) falla `workItemParticipant.createMany` en CLINIC sin pagador por defecto: no quedan pagador, atención ni participantes; (2) falla `workItemSplit.createMany`
  (la última): tablas iguales; (3) SOLO_PRACTICE en modo pro sin Professional, falla `workItem.create`: no quedan el Professional ni el pagador automáticos; (4) caso feliz:
  las 4 escrituras con `inTx: true` y transacción `committed`.
- **DeleteStaff con usuario:** feliz; falla `organizationMember.deleteMany` (Professional sigue con `deletedAt = null`); falla `user.update` (Professional, membresía y User intactos).
- **Merge:** feliz (`patient.updateMany`, `workItem.updateMany`, `patient.delete`, todas `inTx`); falla `patient.delete` (atenciones siguen en el origen, los dos pacientes existen);
  otra sesión borró el destino entre la verificación y la transacción (404 genérico, nada escrito, transacción `rolledBack`, solo el `updateMany` de bloqueo intentado).
- Más, en los specs existentes: `patients-handlers.spec.ts` (mock de `tx` con `patient.updateMany` `{count: 2}`, aserción del `where` y caso `count: 1` → 404 sin `workItem.updateMany` ni `delete`) y
  `activity-handlers.spec.ts` (4 casos del borrado: `where` con `NOT`, P2025 con fila presente → 403 con el mensaje de hoy, P2025 sin fila → 404 genérico, otro error se propaga).

## Los dos cierres de carreras (decisión 2 de 00-estado)
1. **Fusión de pacientes** (`merge-patient-command.ts`): primera sentencia de la transacción, `tx.patient.updateMany({ where: { id: { in: [sourceId, targetId] }, organizationId: source.organizationId }, data: { updatedAt: new Date() } })`;
   si `count !== 2` lanza `resourceNotFound()` (404). La verificación de afuera se mantiene. Único efecto visible: el `updatedAt` del paciente destino y del origen (la API no lo expone).
2. **Borrado de atención** (`delete-activity-command.ts`): el `delete` lleva `NOT: { paymentStatus: PAID, paymentDate: { not: null } }` en el `where`. Ante `PrismaClientKnownRequestError` `P2025` se vuelve a leer
   con `{ id, ...inScope(scope) }`: sin fila, `resourceNotFound()`; con fila, la misma `ForbiddenException` de hoy (función local `paidActivityForbidden`, mismo mensaje). Otros errores se propagan.
   El 403 de la verificación previa no cambia.

## Resuelto del #70 (pendientes del 014)
- **M-1:** `UpdateStaffCommand.canLoadActivities` usa `@IsOptionalNotNull()` (+ `@IsBoolean()`): `null` da 400 en vez de 500. Test en `test/org-isolation.spec.ts` (sección (o), `PUT org/staff/:id`: "canLoadActivities null (M-1 del 014)" y string). Verificado: sin el cambio el caso falla.
  `CreateStaffCommand` no necesita cambio (el handler hace `?? false`).
- **M-2:** casos `roles: [null]`, `[1]`, `["x"]` en create y update de tipos de actividad (sección (o)). **Todos dan 400 sin cambios de código**: no hubo nada que corregir.
- **N1:** comentarios y descripción Swagger de `ActivityTypeRoleDto` actualizados (`isRequired` ausente se guarda `true`; `feeStrategy` ausente se guarda sin la clave, honorario 0), con `description` en `feeStrategy`.
- **N3:** imports de `MAX_PAGE_NUMBER, MAX_PAGE_SIZE` en `find-all-patients-query.ts` y `payer-commands.ts` partidos a mano en varias líneas (prettier reformatearía todo el archivo; ambos tienen muchos errores previos de prettier que no se tocaron).

## Archivos
Nuevos: `backend/test/helpers/fake-prisma.spec.ts`, `backend/test/helpers/prisma-writes.ts`, `backend/src/transactions-invariants.spec.ts`, `backend/test/transactions.spec.ts`.
Modificados: `backend/test/helpers/fake-prisma.ts`, `backend/src/application/features/patients/commands/merge-patient-command.ts`, `backend/src/application/features/activity/commands/delete-activity-command.ts`,
`backend/src/application/features/patients/patients-handlers.spec.ts`, `backend/src/application/features/activity/activity-handlers.spec.ts`, `backend/src/application/features/config/commands/staff-commands.ts`,
`backend/src/application/features/config/commands/activity-type-commands.ts`, `backend/src/application/features/patients/queries/find-all-patients-query.ts`, `backend/src/application/features/config/commands/payer-commands.ts`,
`backend/test/org-isolation.spec.ts`. Sin cambios de schema, API, front ni scripts.

## Calidad
- `npx tsc --noEmit` (backend): sin errores.
- `npm test` (backend): **45 suites, 815 tests, todo en verde** (antes: 42 suites, 773 tests).
- ESLint por archivo (sin `--fix` salvo en los 4 archivos nuevos propios): los 4 archivos nuevos y `fake-prisma.spec.ts` quedan en 0 errores. En archivos preexistentes los errores no crecen respecto de `HEAD`
  (comparado con `git show HEAD:… | eslint --stdin`): delete-activity 3→3, merge 5→5, staff-commands 23→23, activity-type-commands 23→23, activity-handlers.spec 2→2, patients-handlers.spec 4→4, org-isolation 84→84, fake-prisma.ts 4→4.
  Los dos imports del N3 ya no figuran. Se usó `eslint --fix` solo en archivos nuevos. Frontend: no se tocó.

## Desvíos del diseño
- Ninguno de fondo. Menores: el spec de la guardia importa el analizador desde `../test/helpers/` (el diseño lo ubicaba igual); `fake-prisma.spec.ts` suma un caso (`delete` con `NOT` en el `where`) por la carrera 2;
  el merge actualiza `updatedAt` de **ambos** pacientes (el `updateMany` cubre los dos ids, como en el diseño).
- Los ids de los tests de atomicidad son UUID reales: `requireId` rechaza otros formatos con 404.

## Cómo probarlo
`cd backend`; `npx tsc --noEmit`; `npm test` (o `npx jest test/transactions src/transactions-invariants test/helpers`). Para ver que la guardia muerde: agregar un segundo `await this.prisma.x.create` en un handler y correr `src/transactions-invariants.spec.ts`.

## Notas para revisor, seguridad y tester
- **Revisor:** mirar `prisma-writes.ts` (`isWrite`, `isTerminal`, alcance de `isTxCallback`) y el orden de operaciones del `catch` en `delete-activity-command.ts`.
- **Seguridad:** ambos cierres mantienen el 404 genérico y el 403 idéntico; la relectura usa `inScope(scope)`. La ventana residual (alta de atención para el paciente origen durante la fusión,
  borrar un tipo de actividad durante un alta, duplicados por "leer y luego insertar") sigue abierta y va al BACKLOG (§3.4 del diseño: `Restrict` y restricciones únicas, requieren schema).
- **Tester:** `-Smoke` y conteos de la base sin cambios; las escrituras se cubren con Jest. En una base real, probar fusión y borrado de una atención cobrada contra Postgres (Prisma 5 acepta filtros extra en el `where` de `delete`; la base en memoria solo lo simula).

## Dudas pendientes
- `CLAUDE.md` dice "Jest (13 suites)": ahora son 45. Lo actualiza el documentador.
