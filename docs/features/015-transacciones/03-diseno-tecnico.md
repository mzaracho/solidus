# 015 — Diseño técnico: transacciones en toda operación que escribe varias tablas

Arquitecto, 2026-11-04. Base: `main` en `2155df6` (013), con el 014 en curso en el árbol de trabajo. El 015 se
implementa **después del commit del 014**: el paso 0 del plan repite el relevamiento sobre ese commit.

## 1. Conclusión del relevamiento

**No queda ninguna operación con dos o más escrituras fuera de `$transaction`.** Las tres que había (alta de atención,
fusión de pacientes y baja de staff con usuario) se envolvieron en el 007. Todas las demás escriben **una sola vez**.
Los ejemplos de la spec resultaron ser una sola escritura:
- Las fee rules **conectan** un pagador existente, no lo crean.
- El alta de staff crea solo el `Professional`: enlaza un `User` existente, no crea usuario ni membresía.
- Los roles del tipo de actividad y los settings de la organización son columnas JSON de la misma fila.
- El cobro de una atención es un `workItem.update`: los splits no se recalculan.

Por eso el 015 queda en:
1. La **guardia** del criterio 5 (análisis estático con el AST de TypeScript y lista blanca, hoy vacía).
2. El soporte de **rollback e inyección de fallos** en `fake-prisma` y los **tests de atomicidad** de las tres
   operaciones transaccionales (criterio 6). Hoy no existen: los specs del 007 solo verifican que las escrituras
   ocurren dentro del callback.
3. **Dos cierres de TOCTOU** (criterio 2) que sí tienen solución sin cambiar el aislamiento ni el schema: la fusión de
   pacientes y el borrado de una atención cobrada (§3.3). Las otras ventanas no se cierran con una transacción en
   READ COMMITTED. Se documentan en §3.4 y van al BACKLOG.

## 2. Relevamiento (criterio 1)

Se buscó `create|createMany|update|updateMany|upsert|delete|deleteMany|$executeRaw|$queryRaw|$transaction` en
`backend/src/**` (sin `*.spec.ts`). Se leyeron todos los handlers de `application/features/**`, los servicios de
`infrastructure/features/**` y los controladores. `$executeRaw` y `$queryRaw` no se usan en ningún lado. Las coincidencias de
`login-rate-limiter.ts` (`Map.delete`) y `redact.ts` (`Set.delete`) no son escrituras a la base. Login, guards,
dashboard, liquidaciones y todas las queries solo leen.

N = escrituras por request (rango cuando dependen de ramas). "Cascada" = la base borra las filas hijas en la misma
sentencia (`onDelete: Cascade`), así que es atómico sin transacción.

| # | Unidad (archivo → método) | Endpoint | Escrituras (modelo.op) | N | ¿`$transaction`? | Verificaciones previas y TOCTOU | Cambio en el 015 |
|---|---|---|---|---|---|---|---|
| 1 | `infrastructure/features/activity/activity.service.ts` → `createActivity` | `POST activity` | `payer.create` (si falta el pagador por defecto), `professional.create` (si es SOLO_PRACTICE en modo pro), `workItem.create`, `workItemParticipant.createMany`, `workItemSplit.createMany` (si hay splits) | 2–5 | **Sí** (007), interactiva; el motor de honorarios lee con `tx` | La organización, el tipo, el preset, el pagador, el paciente, los profesionales y la regla de primera carga se leen **fuera** de la transacción. La pertenencia a la organización no cambia (`organizationId` es inmutable). La búsqueda del pagador por defecto fuera de la transacción puede duplicar "Particular" con dos altas simultáneas: no se cierra con una transacción (§3.4 a). El `Professional` automático está protegido por `@@unique([organizationId, userId])`: si choca, la transacción entera falla | Solo tests de atomicidad (§6.2) |
| 2 | `application/features/activity/commands/update-activity-command.ts` → `execute` | `PUT activity/:id` (edición y cobro) | `workItem.update` | 1 | No hace falta | Lee el scope y la autoría (`createdByUserId`, `professional.userId`), que no cambian | Ninguno |
| 3 | `.../activity/commands/delete-activity-command.ts` → `execute` | `DELETE activity/:id` | `workItem.delete` (cascada a participantes y splits) | 1 | No hace falta | Scope, autoría y salvaguarda financiera (`PAID` con `paymentDate`). **TOCTOU:** si otra sesión cobra la atención entre la lectura y el borrado, se borra una atención cobrada | **Borrado condicional** (§3.3 b) |
| 4 | `.../config/commands/activity-type-commands.ts` → `CreateActivityTypeCommandHandler` | `POST org/activity-types` | `activityType.create` (`roles` es JSON) | 1 | No hace falta | — | Ninguno |
| 5 | idem → `UpdateActivityTypeCommandHandler` | `PUT org/activity-types/:id` | `activityType.update` | 1 | No hace falta | Scope (inmutable) | Ninguno |
| 6 | idem → `DeleteActivityTypeCommandHandler` | `DELETE org/activity-types/:id` | `activityType.delete` | 1 | No hace falta | Scope + conteo de uso. **TOCTOU:** si en el medio se crea una atención con ese tipo, `WorkItem.activityTypeId` es opcional, la FK tiene por defecto `SET NULL` y la atención pierde el tipo. Una transacción en READ COMMITTED no lo cierra (§3.4 b) | Ninguno (BACKLOG) |
| 7–9 | `.../config/commands/category-commands.ts` → Create / Update / Delete | `org/categories` | `professionalCategory.create` / `update` / `delete` | 1 | No hace falta | Scope. Borrar una categoría deja en `null` la categoría de sus profesionales (`SET NULL`): es el comportamiento actual, no una carrera | Ninguno |
| 10 | `.../config/commands/payer-commands.ts` → `CreatePayerCommandHandler` | `POST pro/payers` (y org) | `payer.create` | 1 | No hace falta | El CUIT de una organización y el `Professional` propio. Sin restricción única: no aplica | Ninguno |
| 11 | idem → `UpdatePayerCommandHandler` | `PUT pro/payers/:id` | `payer.update` | 1 | No hace falta | Scope y dueño (inmutables) | Ninguno |
| 12 | idem → `DeletePayerCommandHandler` | `DELETE pro/payers/:id` | `payer.delete` | 1 | No hace falta | Scope y dueño. Si el pagador tiene atenciones, la FK `RESTRICT` hace fallar el borrado entero. Si tiene fee rules, `FeeRule.payerId` pasa a `null` (`SET NULL`) y **la regla queda general** (ver Aclaración 4) | Ninguno (BACKLOG) |
| 13–15 | `.../config/commands/preset-commands.ts` → Create / Update / Delete | `org/presets` | `feePreset.create` / `update` / `delete` | 1 | No hace falta | Scope. `WorkItem.presetId` queda en `null` al borrar (`SET NULL`, comportamiento actual) | Ninguno |
| 16 | `.../config/commands/staff-commands.ts` → `CreateStaffCommandHandler` | `POST org/staff` | `professional.create` (enlaza un `userId` existente) | 1 | No hace falta | Categoría de la organización y CUIT repetido. Este último no tiene restricción única (§3.4 a) | Ninguno |
| 17 | idem → `UpdateStaffCommandHandler` | `PUT org/staff/:id` | `professional.update` | 1 | No hace falta | Scope | Ninguno |
| 18 | idem → `DeleteStaffCommandHandler` | `DELETE org/staff/:id` | Con usuario: `professional.update`, `organizationMember.deleteMany`, `user.update` (si no quedan vínculos). Sin usuario: `professional.update` **o** `professional.delete` (ramas excluyentes) | 2–3 / 1 | **Sí** en la rama con usuario (007); las otras ramas, una sola escritura | `userId` (inmutable) fuera de la transacción. Los conteos de otros vínculos ya están dentro. Si mientras tanto se crea una atención, el borrado físico choca con la FK `RESTRICT` de `WorkItem.professionalId` y falla entero | Solo tests de atomicidad |
| 19 | idem → `AssignStaffCategoryCommandHandler` | `PUT org/staff/:id/category` | `professional.update` | 1 | No hace falta | Profesional y categoría de la misma organización. Si la categoría se borra en el medio, la FK falla y no queda nada a medias | Ninguno |
| 20 | `.../config/commands/update-organization-command.ts` → `execute` | `PUT org` | `organization.update` (`settings` es JSON) | 1 | No hace falta | — | Ninguno |
| 21 | `.../fee-engine/commands/fee-rule-commands.ts` → `CreateFeeRuleCommandHandler` | `POST fee-rules` | `feeRule.update` **o** `feeRule.create` (upsert manual, ramas excluyentes; el pagador se conecta) | 1 | No hace falta | Pagador de la organización y regla existente. Dos altas simultáneas pueden duplicar la regla porque no hay restricción única (§3.4 a) | Ninguno |
| 22 | `.../patients/commands/create-patient-command.ts` → `PatientsService.create` | `POST v1/patients` | `patient.create` | 1 | No hace falta | — | Ninguno |
| 23 | `.../patients/commands/update-patient-command.ts` → `PatientsService.update` | `PUT v1/patients/:id` | `patient.update` | 1 | No hace falta | Scope | Ninguno |
| 24 | `.../patients/commands/merge-patient-command.ts` → `execute` | `POST v1/patients/:id/merge` | `workItem.updateMany`, `patient.delete` | 2 | **Sí** (007) | Los dos pacientes en el scope y de la misma organización, **fuera** de la transacción. **TOCTOU:** dos fusiones simultáneas que comparten un paciente (A→B y B→C) pueden dejar atenciones con `patientId = null` (`SET NULL`), y A→B junto con B→A pueden borrar los dos | **Bloqueo y re-verificación dentro de la transacción** (§3.3 a) + tests |
| 25 | `api/controllers/v1/config/pro-controller.ts` → `updateProfile` | `PUT pro/profile` | `professional.update` | 1 | No hace falta | `Professional` propio del usuario | Ninguno |

## 3. Decisiones

### 3.1 Forma de la transacción
- Solo la **forma interactiva**: `this.prisma.$transaction(async (tx) => { ... })`. La forma de arreglo
  (`$transaction([...])`) queda prohibida por la guardia (§4): no permite verificaciones intermedias ni pasar `tx`.
  Hoy no se usa.
- Se mantienen el aislamiento por defecto (READ COMMITTED) y los límites por defecto de Prisma (`maxWait` 2 s,
  `timeout` 5 s). No hace falta subirlos. La transacción más larga, `createActivity`, hace por índice entre 5 y 8
  lecturas y entre 2 y 5 escrituras. No hay I/O externo ni cálculos pesados.
- Regla para escribir código nuevo: dentro del callback solo se usa la base con `tx`. Nada de HTTP, colas ni
  `Promise.all` con escrituras independientes que no hagan falta.

### 3.2 Cliente de transacción en servicios auxiliares (criterio 3)
- Se mantiene el patrón del 007: un parámetro opcional al final, `db: Prisma.TransactionClient = this.prisma`
  (`FeeResolutionService.calculateSplits`, `ActivityService.calculateParticipantFee`). Hoy ningún otro servicio se
  llama desde una transacción, así que no hay más firmas que cambiar.
- Descartado: un contexto implícito con AsyncLocalStorage o CLS (por ejemplo `@nestjs/cls` o
  `@prisma/extension-transactional`). Es una dependencia nueva y una forma implícita de pasar el cliente que el
  proyecto no usa. Solo serviría para dos métodos.
- La guardia verifica que dentro de un callback de `$transaction` no aparezca `this.prisma.` ni `prisma.` (§4, regla
  B). El spec de `activity.service` ya verifica que `calculateSplits` reciba `tx`.

### 3.3 Verificaciones que van dentro (criterio 2)
En READ COMMITTED, mover una lectura dentro de la transacción **no** impide que otra transacción confirme un cambio
entre esa lectura y la escritura. Solo cierran la ventana dos cosas: un **bloqueo de fila** tomado con una escritura,
o una **escritura condicional** que Postgres vuelve a evaluar sobre la versión vigente de la fila. Los dos casos que se
cierran:

**a) Fusión de pacientes.** Primera sentencia dentro de la transacción:
```ts
const locked = await tx.patient.updateMany({
  where: { id: { in: [sourceId, targetId] }, organizationId: source.organizationId },
  data: { updatedAt: new Date() },
});
if (locked.count !== 2) throw resourceNotFound();
```
Después vienen `workItem.updateMany` y `patient.delete`, como hoy. El `UPDATE` bloquea las dos filas hasta el final, así
que una fusión concurrente que comparte un paciente espera. Al continuar, esa fusión ve el estado confirmado: si el
paciente ya se borró, `count` es menor que 2, responde 404 y no escribe nada. Si no, mueve también las atenciones que
la otra fusión acababa de reasignar. La verificación de scope de afuera se mantiene: da el 404 genérico sin abrir la
transacción. Descartado `SELECT ... FOR UPDATE` con `$queryRaw`: es SQL crudo, un patrón nuevo, y `fake-prisma` no lo
puede simular. Lo único que cambia hacia afuera es el `updatedAt` del paciente destino, que la API no expone. Queda
documentada una ventana residual: una alta de atención para el paciente **origen** que confirma durante la fusión
termina con `patientId = null` por el `SET NULL` de la FK. Se cierra con `RESTRICT` en el schema (§3.4 c).

**b) Borrado de una atención cobrada.** La salvaguarda pasa a la propia sentencia (Prisma 5 acepta filtros extra en
`where` de `delete`):
```ts
return await this.prisma.workItem.delete({
  where: { id, NOT: { paymentStatus: PaymentStatus.PAID, paymentDate: { not: null } } },
});
```
Se mantiene la verificación previa, que da el mismo 403 que hoy en el caso normal. Si el `delete` falla con
`PrismaClientKnownRequestError` código `P2025` (la fila cambió en el medio), se vuelve a leer con
`{ id, ...inScope(scope) }`. Si no existe, `resourceNotFound()` (404). Si existe, la misma `ForbiddenException`
de hoy, con el mensaje "No se puede eliminar una actividad ya cobrada con fecha de pago." en una función local
reutilizada. Cualquier otro error se propaga. No hace falta una transacción: es una sola sentencia.

### 3.4 Ventanas que el 015 no cierra (BACKLOG)
Una transacción no las resuelve sin cambiar el aislamiento o el schema, y los dos quedan fuera de alcance:
- **a) Duplicados por "leer y después insertar":** el pagador por defecto "Particular" (`createActivity`), la fee rule
  por pagador y categoría, y el CUIT del profesional en la organización. Se resuelven con restricciones únicas
  (migración) y el manejo de P2002 (BACKLOG #59).
- **b) Borrar un tipo de actividad mientras se crea una atención que lo usa:** se cierra con
  `onDelete: Restrict` en `WorkItem.activityType`.
- **c) Fusión de pacientes mientras se crea una atención para el paciente origen:** se cierra con `onDelete: Restrict`
  en `WorkItem.patient`. Con eso la fusión fallaría entera en lugar de dejar la atención sin paciente.

## 4. Guardia del criterio 5

**Enfoque:** análisis estático con la API del compilador de TypeScript (`typescript` 5.9 ya está en
`devDependencies`). No suma dependencias. Una expresión regular no distingue el alcance (qué escritura está dentro de
qué callback, ramas, bucles) y daría falsos positivos en las ramas excluyentes de `DeleteStaff` y `CreateFeeRule`.
Descartada una regla custom de ESLint: suma configuración y un plugin local por una sola regla.

**Archivos:** analizador en `backend/test/helpers/prisma-writes.ts` (función pura `analyzeSource(fileName, text)`) y
spec nuevo `backend/src/transactions-invariants.spec.ts`. El spec es separado de `security-invariants.spec.ts`, que
modifica el 014, para no chocar. Recorre todo `src/**/*.ts` sin `*.spec.ts`, igual que los invariantes existentes.

**Definiciones:**
- **Unidad:** cada `MethodDeclaration`, `Constructor`, `FunctionDeclaration` o función asignada a una variable de primer
  nivel. Las funciones anidadas (callbacks de `map`, `Promise.all`, etc.) cuentan para la unidad que las contiene.
- **Escritura directa:** una llamada `C.<modelo>.<op>(...)` con `op` ∈ {create, createMany, update, updateMany, upsert,
  delete, deleteMany} y `C` ∈ {`this.prisma`, `prisma`, `this.db`, `db`}, o una llamada `C.$executeRaw` /
  `C.$executeRawUnsafe`. Así no coinciden `this.entries.delete` (un `Map`) ni `seen.delete` (un `Set`).
- **Escritura delegada:** una llamada `this.<x>Service.<m>(...)` con `m` que empieza con
  create|update|delete|upsert|remove|merge|save. Cubre `patientService.update`.
- **Dentro de transacción:** la llamada tiene como ancestro una función que es argumento de una llamada a `*.$transaction`.
- **Terminal:** la escritura, sin el `await`, es la expresión directa de un `return` o el cuerpo de una arrow function.
- **Multiplicidad:** una escritura dentro de `for`, `for…of`, `for…in`, `while`, `do` o del callback de
  `map`/`forEach`/`flatMap` cuenta como 2.

**Reglas (cada una con su `it`):**
- **A.** Una unidad es infractora si, contando solo las escrituras fuera de transacción, suma 2 o más **y** al menos
  una no es terminal. Así las ramas excluyentes con `return` (por ejemplo `DeleteStaff` sin usuario y el upsert de fee
  rules) no cuentan como dos escrituras seguidas.
- **B.** Dentro de un callback de `$transaction` no aparece `this.prisma.`, `prisma.` (como cliente) ni `this.db.`.
  Solo se usa el parámetro del callback.
- **C.** No existe la forma de arreglo `$transaction([`.

**Lista blanca:** `TX_ALLOWLIST: Record<string, string>` con clave `archivo::Clase.método` y justificación. Hoy queda
**vacía**: el análisis del código actual no da ninguna infracción. Igual que `WHERE_ID_ALLOWLIST`, el spec exige que cada
entrada exista y siga siendo infractora, así no se acumulan entradas obsoletas. Si en el futuro una entrada es legítima
(por ejemplo, un servicio con `db` que solo se llama dentro de una transacción), se agrega con su motivo.

**Pruebas del detector (contra falsos verdes):** el mismo spec corre `analyzeSource` sobre fragmentos en línea y espera:
- dos `await this.prisma.x.create` seguidos: infractor;
- `await create` + `return update`: infractor;
- una escritura en `for…of`: infractor;
- dos `await this.prisma.x.create` en `Promise.all([...])`: infractor;
- dos `return` en ramas excluyentes: no infractor;
- tres escrituras con `tx.` dentro de `$transaction(async (tx) => …)`: no infractor;
- `this.prisma.x.findFirst` dentro del callback: viola B;
- `$transaction([a, b])`: viola C;
- `this.entries.delete(k)` dos veces: no infractor.

**Limitaciones (documentadas en el spec):**
- Las escrituras a través de un helper que no siga los nombres de arriba no se ven.
- Dos escrituras en ramas excluyentes que no terminan en `return` dan falso positivo: se resuelve con `return` o con una
  entrada en la lista blanca.

## 5. Soporte en `fake-prisma` (`backend/test/helpers/fake-prisma.ts`)
1. **Rollback:** `$transaction(fn)` toma una instantánea de las tablas (copia superficial de cada fila: las escrituras
   usan `Object.assign` sobre la fila y no mutan objetos anidados) y la longitud de `writes`. Llama a `fn(txClient)`. Si
   lanza, restaura las tablas, trunca `writes` y relanza el mismo error. `writes` refleja entonces lo **persistido**.
   Además se agrega `transactions: { status: 'committed' | 'rolledBack'; writes: FakeWrite[] }[]` para poder afirmar
   que hubo una transacción que se deshizo.
2. **Marcar escrituras dentro de la transacción:** el callback recibe un proxy `txClient` que comparte las tablas.
   `FakeWrite` suma `inTx: boolean`. Una escritura con el cliente raíz mientras hay una transacción abierta queda con
   `inTx: false`, y el test lo detecta (criterio 3 en tiempo de ejecución). Si hay un `$transaction` anidado, se llama
   a `fn` sin otra instantánea.
3. **Inyección de fallos:** `failOn({ model, op, nth = 1, error? })`. La enésima llamada que coincide lanza **antes** de
   aplicar la escritura. El error por defecto es `new Prisma.PrismaClientKnownRequestError('fake-prisma: fallo
   inyectado', { code: 'P2034', clientVersion: 'fake' })`. `reset()` borra los fallos pendientes.
4. **Fidelidad de P2025:** `update` y `delete` sobre una fila inexistente lanzan `PrismaClientKnownRequestError` con
   `code: 'P2025'` en lugar de `Error`. El contrato de errores (013) los trata igual (500 genérico), así que
   `org-isolation.spec.ts` no cambia. Lo necesita §3.3 b.
5. El segundo argumento de `$transaction` (opciones) se acepta y se ignora. El array sigue con `Promise.all`.

Tests propios del helper en `backend/test/helpers/fake-prisma.spec.ts`: rollback restaura filas y `writes`, `inTx`,
`failOn` con `nth`, P2025, y que una transacción exitosa queda `committed`.

## 6. Archivos, plan y tests

### 6.1 Archivos
| Archivo | Cambio |
|---|---|
| `backend/test/helpers/fake-prisma.ts` | §5 |
| `backend/test/helpers/fake-prisma.spec.ts` (nuevo) | Tests del helper |
| `backend/test/helpers/prisma-writes.ts` (nuevo) | Analizador del §4 |
| `backend/src/transactions-invariants.spec.ts` (nuevo) | Reglas A, B y C, lista blanca y pruebas del detector |
| `backend/test/transactions.spec.ts` (nuevo) | Tests de atomicidad (§6.2) con `fake-prisma` y handlers instanciados directamente |
| `backend/src/application/features/patients/commands/merge-patient-command.ts` | §3.3 a |
| `backend/src/application/features/activity/commands/delete-activity-command.ts` | §3.3 b |
| `backend/src/application/features/patients/patients-handlers.spec.ts` | El mock de `tx` del merge suma `patient.updateMany` (`{ count: 2 }`) y un caso con `count: 1` (404 sin `workItem.updateMany` ni `delete`) |
| `backend/src/application/features/activity/activity-handlers.spec.ts` | Casos P2025 del borrado (§6.2) |

Sin cambios de schema, contratos de API ni frontend.

### 6.2 Tests (criterio 6)
En `test/transactions.spec.ts`, con `createFakePrisma(seed)`, `fake.failOn(...)` y una foto de las tablas antes y
después:
- **createActivity** (`new ActivityService(fake.client, feeEngineStub)`, con el stub devolviendo un split):
  1. CLINIC sin pagador por defecto: falla `workItemParticipant.createMany`. No quedan `payer`, `workItem` ni
     participantes nuevos, y el error se propaga.
  2. Falla `workItemSplit.createMany` (la última). Las tablas quedan iguales.
  3. SOLO_PRACTICE en modo pro sin `Professional`: falla `workItem.create`. No quedan el `Professional` ni el pagador
     automáticos.
  4. Caso feliz: todas las escrituras con `inTx: true` y una transacción `committed`.
- **DeleteStaff con usuario:**
  - falla `organizationMember.deleteMany`: el `Professional` sigue con `deletedAt = null`;
  - falla `user.update`: el `Professional` y la membresía quedan intactos y el `User` activo.
- **Merge:**
  - falla `patient.delete`: las atenciones siguen con el `patientId` de origen y los dos pacientes existen;
  - la re-verificación con `count` 1 (simulada borrando el paciente destino desde el `failOn` o con un seed preparado):
    404 y nada escrito.
- **DeleteActivity** (en `activity-handlers.spec.ts`, con mocks):
  - `delete` rechaza P2025 y la nueva lectura devuelve la fila: 403 con el mensaje de hoy;
  - la lectura devuelve `null`: 404 genérico;
  - otro error se propaga;
  - el `where` del `delete` incluye la condición `NOT`.

Se corren completos `npm test` (incluido `org-isolation.spec.ts`, que ahora hace rollback real), `npx tsc --noEmit` y
ESLint sobre los archivos tocados.

### 6.3 Plan en pasos chicos
0. Sobre el commit del 014: repetir el grep del §2 y comparar con la tabla. Si el 014 agregó escrituras, actualizar la
   tabla (y la guardia las va a detectar).
1. `fake-prisma` (§5) + `fake-prisma.spec.ts`. Correr la suite completa: no debe cambiar nada en verde.
2. `prisma-writes.ts` + `transactions-invariants.spec.ts` con las pruebas del detector. La lista blanca vacía tiene que
   pasar sobre el código actual.
3. `test/transactions.spec.ts`: atomicidad de createActivity, DeleteStaff y merge (sin tocar código de producción: deben
   pasar ya).
4. Merge con bloqueo y re-verificación + ajuste de `patients-handlers.spec.ts` + el caso de `count` 1.
5. Borrado condicional de atención + casos P2025.
6. `npx tsc --noEmit`, ESLint sin `--fix` en lo tocado y `npm test`. Tester: `-Smoke` y conteos de la base sin cambios.

## 7. Errores, rendimiento y compatibilidad
- **Errores:** un fallo dentro de una transacción se propaga sin capturar, Prisma hace rollback y el contrato del 013
  responde. Un fallo de Prisma da el 500 genérico; las excepciones de Nest mantienen su status. No se agregan
  reintentos (fuera de alcance). Un deadlock entre dos fusiones cruzadas lo resuelve Postgres abortando una (500), sin
  datos parciales.
- **Rendimiento:** la fusión suma un `UPDATE` de dos filas por PK. El borrado condicional cuesta lo mismo. La guardia
  parsea unos 60 archivos con `ts.createSourceFile`, menos de un segundo.
- **Compatibilidad:** sin cambios de schema, API ni front. Solo difieren de hoy los casos de carrera de §3.3, que ahora
  fallan enteros (criterio 4).

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Choque con el 014 en handlers y specs | Se implementa después de su commit. Los specs nuevos van en archivos nuevos. Paso 0 |
| El rollback de `fake-prisma` cambia algún resultado de `org-isolation.spec.ts` | Solo afecta transacciones que fallan, y ahora la base en memoria es más fiel. Se corre la suite completa en el paso 1 |
| Falsos positivos o negativos de la guardia | Pruebas del detector con fragmentos, limitaciones documentadas, lista blanca con control de obsoletas |
| Deadlock entre fusiones cruzadas | Postgres aborta una (500). Sin datos parciales; sin reintentos por alcance |

## 9. Aclaraciones para el PO
1. **Alcance real:** no queda ninguna operación con 2 o más escrituras fuera de una transacción. Lo pedido en el BACKLOG
   #16 ya está hecho en el 007. El 015 entrega la guardia, los tests de atomicidad y dos cierres de carrera.
2. **Comportamiento nuevo, solo en carreras** (criterio 4), por default incluidos:
   - Fusión de pacientes: si otra fusión simultánea ya borró uno de los dos, responde 404 en lugar de dejar atenciones
     sin paciente. El `updatedAt` del paciente destino se actualiza (la API no lo expone).
   - Borrar una atención: si otra sesión la cobró en el medio, responde el mismo 403 de hoy (o 404 si ya no existe) en
     lugar de borrarla.

   Si el PO prefiere no tocar producción, los dos pasos (4 y 5) se pueden diferir sin afectar al resto.
3. **No se cierran en el 015** (requieren cambios de schema o de aislamiento, fuera de alcance). Propuesta de BACKLOG:
   - restricciones únicas para el pagador por defecto por organización, la fee rule por organización, pagador y
     categoría, y el CUIT del profesional por organización;
   - `onDelete: Restrict` en `WorkItem.activityType` y `WorkItem.patient`.
4. **Hallazgo de comportamiento (BACKLOG, decisión del PO):** borrar un pagador que tiene fee rules deja esas reglas
   con `payerId = null`. El motor trata `payerId null` como regla **general**, así que pasan a aplicarse a todos los
   pagadores de la organización. Opciones: 409 si tiene reglas, o borrar sus reglas en la misma transacción. No se
   cambia en el 015 (criterio 4).
5. **Hallazgo de comportamiento (BACKLOG):** el borrado físico de staff solo mira `workItems` (profesional principal):
   - si el profesional es solo participante, el borrado falla con un 500 (FK);
   - si es solo beneficiario de splits, sus splits quedan con `beneficiaryId = null`.
6. **Hallazgo de infraestructura (BACKLOG, prioridad alta, fuera de alcance):** el schema y las migraciones no
   coinciden.
   - Las migraciones versionadas no crean `WorkItemParticipant` ni `WorkItem.activityTypeId`, ni `ActivityType.baseValue`,
     `cardValue` y `roles`.
   - Al revés, `WorkItem.coProfessionalId` está en las migraciones y no en el schema.
   - Un `prisma migrate deploy` sobre una base vacía no dejaría una base usable para `createActivity`.
   - Las acciones de FK de esas columnas citadas arriba son las que Prisma pone por defecto según el schema, porque
     ninguna migración las define.

   Conviene un feature propio con `prisma migrate diff`, sin `db push`.

VEREDICTO: APROBADO
