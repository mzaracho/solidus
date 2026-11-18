# 017 — Implementación: dinero exacto, motor de honorarios y bajas con historial

Desarrollador, 2026-11-18. Base: `main` en `07b43e0`. Sin commit ni push. Se siguió `03-diseno-tecnico.md` (plan de
12 pasos) más el criterio 16 (fecha de pago), el criterio 17 (pagador con atenciones) y las decisiones del PO de
`00-estado.md`.

## 1. Resultado

| Control | Resultado |
|---|---|
| Backend `npx tsc --noEmit` | 0 errores |
| Backend `npx jest` | **51 suites, 932 tests** en verde (antes 45 / 815) |
| Frontend `npx tsc --noEmit` | 0 errores |
| Frontend `npm test` | **112 tests** en verde (antes 87) |
| Frontend lint (archivos tocados) | Sin errores nuevos: cada archivo tocado queda igual o mejor que en `HEAD` (RetroactiveModal 1 -> 0; `WorkItemForm` 34 = 34; `PaymentRegistrationModal` 2 = 2). Los archivos nuevos: 0 errores |
| Backend lint (`npx eslint` por archivo) | Todos los archivos nuevos en 0 errores. En los archivos ya existentes que no estaban formateados con Prettier (`find-activity-by-id-query.ts`, `payer-commands.ts`, `staff-commands.ts`, `activity-handlers.spec.ts`, `org-isolation.spec.ts`, `calculate-settlements-query.ts`) las líneas agregadas suman 2 a 10 avisos `prettier/prettier` por archivo (la clase de error que domina el baseline de 768). No se reformateó ningún archivo ajeno. En `activity.service.ts`, `dashboard.service.ts`, `find-all-activities-query.ts`, `update-activity-command.ts` y `fee-resolution.service.ts` los errores bajaron |
| `npx prisma validate` / `generate` | OK |
| `.\dev.ps1 -CheckMigrations` | **0** ("Schema y migraciones coinciden") |
| Guardias | `security-invariants`, `org-isolation` (con casos nuevos), `request-dto-invariants`, `transactions-invariants` y la nueva `money-invariants` en verde |
| `scripts\dev-lib.tests.ps1` | No se corrió: no se tocó ningún script |
| Postgres real (copia descartable) | 19 de 19 casos en verde (sección 8). Copia y contenedor eliminados |

## 2. Cambios por archivo

### Backend: dinero exacto (#17) y motor (#40)
- `src/domain/seed-work/money.ts` (nuevo): helper único sobre `Prisma.Decimal`: `money`, `roundMoney` (HALF_UP a 2
  decimales), `sumMoney`, `percentOf`, `wholePercent`, `nonNegative`, `minMoney`, `sameMoney`,
  `distributeByPercentages` (mayor resto, desempate por orden) y `toJsonNumber` (única salida a `number`).
- `src/domain/features/fee-engine/split-definition.ts` (nuevo): `SplitType`, `SplitDefinition` (forma única del motor)
  y `normalizeSplitDefinitions` (lee también la forma vieja de la UI; JSON inválido: 500 controlado).
- `src/infrastructure/features/fee-engine/fee-resolution.service.ts`: todo en `Decimal`. `computeAmounts` reparte los
  porcentajes juntos por mayor resto y acota cada monto, en orden, a `bruto - ya asignado` (criterio 7). Retención,
  fallback CLINIC y particular calculan el complemento exacto. Usa `normalizeSplitDefinitions`.
  `WorkContext.grossAmount` acepta `MoneyInput` y `SplitResult.amount` es `Decimal`.
- `src/application/features/fee-engine/fee-rule-splits.ts`: al escribir solo acepta la forma del motor; `FIXED` con
  más de 2 decimales da 400 (comentario de "Fixed cents" corregido: es en pesos).
- `src/infrastructure/features/activity/activity.service.ts`: el alta pasa a `Decimal`. Se extraen
  `findDefaultPayer`, `createDefaultPayer`, `computeParticipantFees`, `computeDistribution`, `splitRows` y
  `roleConfigsOf`, que usan el alta y la edición. El reparto particular de `SOLO_PRACTICE` ahora redondea al centavo.
  Nuevo `updateActivity` (sección 3).
- `src/infrastructure/features/dashboard/dashboard.service.ts`, `application/.../calculate-settlements-query.ts`,
  `.../find-all-activities-query.ts`, `.../find-activity-by-id-query.ts`, `.../get-patient-summary-query.ts`,
  `infrastructure/features/patients/patients.service.ts`: aritmética con `Decimal`; salida `number` con `toJsonNumber`.
  El formato JSON no cambia. `GET /activity` y `GET /activity/:id` suman el booleano `isCollected`.
- `test/helpers/money-ops.ts` + `src/money-invariants.spec.ts` (nuevos): guardia estática M1/M2 sobre 8 archivos
  (`MONEY_FILES`). Lista blanca de 3 entradas (paginación, no dinero).

### Backend: edición, fecha de pago, borrados
- `src/domain/features/activity/activity-collected.ts` (nuevo): `isCollected` y `NOT_COLLECTED_WHERE`, una sola
  definición. `delete-activity-command.ts` las usa (sin cambio de comportamiento).
- `src/application/features/activity/activity-errors.ts` (nuevo): `activityAlreadyCollected()` (409),
  `paymentDateRequired()` (400) y `amountBelowCardSurcharge()` (400).
- `src/infrastructure.bootstrap/filters/error-contract.ts`: códigos `activity-already-collected`,
  `payer-has-fee-rules`, `payer-has-activities` y `payment-date-required`.
- `src/application/features/activity/commands/update-activity-command.ts`: campos `grossAmount`
  (`IsOptionalNotNull` + `IsMoney`) y `payerId` (`IsNullableEntityId`). El handler delega en
  `ActivityService.updateActivity`. Se borró `Dtos/update-activity.dto.ts` (no se usaba).
- `src/infrastructure.bootstrap/config/core/validation/dto-validators.ts`: `IsNullableEntityId`.
- `src/application/features/config/commands/payer-commands.ts`: `DeletePayerCommandHandler` con 409 por reglas y por
  atenciones.
- `src/application/features/config/commands/staff-commands.ts`: regla 2 extendida (participantes y beneficiarios) y
  P2003 a baja lógica.
- `prisma/schema.prisma` y `prisma/migrations/20261118120000_fee_rule_payer_restrict/migration.sql`: `FeeRule.payer`
  con `onDelete: Restrict`.

### Backend: tests y fixtures
- Nuevos: `fee-resolution.service.spec.ts` (reescrito), `money.spec.ts`, `split-definition.spec.ts`,
  `money-exactness.spec.ts`, `money-invariants.spec.ts`, `activity-update.service.spec.ts`,
  `delete-with-links.spec.ts`.
- Ampliados: `activity.service.spec.ts`, `activity-handlers.spec.ts`, `config-handlers.spec.ts`,
  `fee-rule-splits.spec.ts`, `fee-rule-commands.spec.ts`, `dto-validators.spec.ts`, `error-contract.spec.ts`,
  `security-invariants.spec.ts` (`UpdateActivityCommand.payerId: 'verified'`) y `test/org-isolation.spec.ts`.
- `test/helpers/fake-prisma.ts`: relaciones `workItem.activityType`, `professional.participants`,
  `professional.splits`, `payer.feeRules` y `payer.workItems`.
- `test/fixtures/frontend-request-bodies.json`: casos de edición actualizados y casos nuevos; clave opcional
  `"setup": "collected"` que la sección (p) de `org-isolation.spec.ts` aplica antes del pedido.

### Frontend
- Puros y con tests: `src/lib/payment-date.ts`, `src/lib/activity-edit.ts`, `isActivityCollected` en
  `activity-permissions.ts`, builders de `request-bodies.ts`, textos y códigos en `constants.ts`, respaldo por `code`
  en `api-errors.ts`.
- `src/services/data.ts`: `deletePayer`.
- Nuevos: `components/domain/payment/PaymentDateField.tsx` y `MarkPaidDialog.tsx`.
- `workload/data-schema.ts`, `columns.tsx`, `RetroactiveModal.tsx` (reescrito), `form/WorkItemForm.tsx`.
- `pro/atenciones/AtencionesTable.tsx` y `columns.tsx`, `org/admisiones/AdmisionesTable.tsx`,
  `ActivityDetailDialog.tsx`, `pro/atenciones/ActivityDetailModal.tsx`, `pro/deudores/DeudoresTable.tsx`,
  `payment/PaymentRegistrationModal.tsx`, `pro/settings/PayerRulesManager.tsx`.
- `package.json`: el script `test` suma `payment-date.test.mts` y `activity-edit.test.mts`.

## 3. Cómo se cumple cada criterio

| # | Cómo se cumple | Tests |
|---|---|---|
| 1 | Los 8 archivos de `MONEY_FILES` no usan `Number(`, `parseFloat`, `Math.*`, `.toFixed(` ni operadores aritméticos sobre nombres de dinero. Lo vigila `money-invariants.spec.ts` | `money-invariants.spec.ts` (5), `money.spec.ts` (16) |
| 2 | Todos los endpoints siguen devolviendo `number` (`toJsonNumber`); `PUT /activity/:id` sigue devolviendo la fila de Prisma (montos como string). `isCollected` es un campo agregado | `money-exactness.spec.ts` (11): `0.1 + 0.2 = 0.3` y `typeof number` en KPIs, gráfico, pagadores, liquidaciones, lista, detalle y deuda |
| 3 | `distributeByPercentages`: suma exacta al objetivo, mayor resto, desempate por orden | 100 en 3 (`33.34/33.33/33.33`), `0.05` al 50/50 (`0.03/0.02`), `1234.56`, 500 casos generados |
| 4 | Sin migración de datos ni recálculo. El SQL de la migración solo recrea una FK | Revisión del SQL (sección 5) |
| 5 | Forma única del motor. Al escribir se rechaza la vieja (400); al leer se normaliza. Base local: 0 reglas, sin migrar datos | `split-definition.spec.ts`, `fee-rule-splits.spec.ts`, regresión de la forma vieja en `fee-resolution.service.spec.ts`; front: `professionalPercentOf` y `buildPayerFeeRuleSplits` |
| 6 | Tabla de regresión escrita primero contra el código previo (14 casos pasaron sin cambios; los 9 que cambian son por criterios 3, 5 y 7) | `fee-resolution.service.spec.ts` |
| 7 | Cada monto se limita a `bruto - asignado` en orden; nunca se asigna más que el bruto | `FIXED 1500/1000`, `600+600/1000`, `FIXED 300 + 100%`, monto acotado a 0 y 300 casos generados |
| 8 | `PUT` con monto y pagador: transacción interactiva, escritura condicional, recálculo de participantes y splits con el mismo código del alta, 404 idéntico del pagador ajeno, permisos del 007, `payerId: null` = particular (se crea dentro de la transacción si falta) | `activity-update.service.spec.ts`, org-isolation (ataque `payerId` de B, `payerId` null y `''`) |
| 9 | "Cobrada" = `PAID` con `paymentDate` (una definición). Cambio sobre cobrada: 409 sin cambios; mismos valores no cuenta; otros campos siguen; condición en el `updateMany` | Carrera simulada (`count 0` con 409 y con 404), mismo pedido que cobra y cambia el monto, guardada cobrada + `UNPAID` + monto = 409; carrera real en Postgres |
| 10 | `RetroactiveModal` y `WorkItemForm` habilitan monto y pagador solo si `!isCollected`; texto de bloqueo; sin `—` como valor; errores por `api-errors.ts`; builders y fixture actualizados | `request-bodies.test.mts`, `activity-edit.test.mts`, `data-schema.test.mts`, `api-errors.test.mts`, contrato (p) |
| 11 | `DeletePayer`: 409 `payer-has-fee-rules` con verificación previa y FK `RESTRICT` (sin carrera); reglas intactas. La UI muestra el mensaje | `delete-with-links.spec.ts`, org-isolation (HTTP), Postgres real |
| 12 | Staff sin usuario con participación o split: baja lógica; P2003 en el borrado físico: baja lógica; P2025: 404 | `delete-with-links.spec.ts`, Postgres real (P2003 real) |
| 13 | Guardias en verde; campos validados con `IsMoney`/`IsNullableEntityId`; errores del 013 | `error-contract.spec.ts` |
| 14 | Secciones 1 y 5 | |
| 15 | Todo lo que escribe se probó en una copia descartable (sección 8) | |
| 16 | Backend: alta y edición exigen fecha para dejar `PAID` (400 `payment-date-required`, sin cambios; vale la del pedido o la guardada; las ediciones que no tocan `paymentStatus` no se bloquean). Front: sección 6 | `activity-update.service.spec.ts`, `activity.service.spec.ts`, `payment-date.test.mts`, contrato (p) |
| 17 | `DELETE` de un pagador con atenciones: 409 `payer-has-activities` (verificación previa y P2003 del `delete`). El botón "Eliminar pagador" lo ven ADMIN y el dueño (`professionalId` del pagador = `readSessionIdentity().professionalId`) | `delete-with-links.spec.ts`, org-isolation, Postgres real |

Detalle de `updateActivity` (orden de los errores): 404 de la atención, 403, 400 `payment-date-required`, 404 del
pagador, 409 (atajo si ya estaba cobrada), 400 por recargo, y dentro de la transacción el `updateMany` condicional.

## 4. Decisiones del PO sobre las preguntas del arquitecto

1. Reglas con `'all'`: no se tocó la coincidencia del motor (fijado por un test). Falta que el PO las registre en el
   BACKLOG con prioridad media (no edité `BACKLOG`).
2. `PAID` sin fecha: el usuario eligió la opción A más la fecha obligatoria (criterio 16).
3. Pagador con atenciones: 409 `payer-has-activities` (criterio 17).
4. `PUT /activity/:id` devuelve montos como string: sin cambio.
5. Deuda de pacientes dentro de la guardia: incluida.
6. Participantes en `WorkItemForm` en edición: se oculta todo el bloque y no se validan ni se envían.
7. "Eliminar pagador": ADMIN y dueño.

## 5. Migración (regla 6)

Nombre: `20261118120000_fee_rule_payer_restrict`. Generada sin `migrate dev`: `prisma migrate diff
--from-migrations ... --to-schema-datamodel ... --shadow-database-url` contra un Postgres descartable propio
(`postgres:16.11-alpine`, `127.0.0.1`, puerto efímero, `--tmpfs`, contraseña aleatoria), eliminado al terminar. UTF-8
sin BOM y LF; no se editó a mano.

```sql
-- DropForeignKey
ALTER TABLE "FeeRule" DROP CONSTRAINT "FeeRule_payerId_fkey";

-- AddForeignKey
ALTER TABLE "FeeRule" ADD CONSTRAINT "FeeRule_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

No se aplicó a la base del usuario. Se aplicó con `migrate deploy` a la copia descartable (sin errores, `migrate diff
--exit-code` en 0 después). La base del usuario la recibe con `migrate deploy` al correr `.\dev.ps1`.

## 6. Criterio 16: acciones que marcan una atención como pagada

Backend (los únicos dos puntos que cambian `paymentStatus`): `ActivityService.createActivity` (`POST /activity`) y
`ActivityService.updateActivity` (`PUT /activity/:id`). No existe ningún endpoint de cobro masivo ni de deudores: el
cobro de varias atenciones es el front mandando un `PUT` por atención con la misma fecha. `WorkItem.markAsPaid` (entidad
de dominio) no se usa en ninguna parte.

Frontend (relevado con `PAID`, `PAYMENT_STATUS` y los llamadores de `updateWorkItem` y `createWorkItem`):

| # | Acción | Antes | Ahora |
|---|---|---|---|
| 1 | `workload/columns.tsx`, "Marcar Pagado" | Mandaba `PAID` sin fecha | `MarkPaidDialog`: "Fecha de pago" |
| 2 | `DeudoresTable`, "Marcar como Cobrado" | Sin fecha | `MarkPaidDialog` |
| 3 | `DeudoresTable`, cobro de varias | No existía | "Marcar seleccionadas como cobradas": una fecha para todas |
| 4 | `AtencionesTable`, "Marcar Cobrado" y cobro múltiple | `PaymentRegistrationModal` con un selector de fecha que usaba `toISOString` (UTC: de noche corría un día) | `PaymentDateField` local, obligatorio |
| 5 | `AdmisionesTable`, "Marcar Cobrado" | Ídem | Ídem |
| 6 | `WorkItemForm` alta, Estado = Pagado | "Fecha Cobro" con `toISOString` | `PaymentDateField`; no se envía sin fecha válida |
| 7 | `WorkItemForm` edición, Estado = Pagado | Ídem | Ídem; si no hay fecha guardada se precarga hoy |
| 8 | `PacientesTable`, `PaymentRegistrationModal` | Placeholder (`console.log`), no marca nada | Solo cambia el campo de fecha del modal compartido. No se conectó (pregunta 4) |

`PaymentDateField` es un `<input type="date">` con etiqueta "Fecha de pago", obligatorio, precargado con
`todayLocalISO()` (componentes locales, sin `toISOString`). Se valida con `isValidPaymentDate` (calendario real) y el
botón de confirmar queda deshabilitado sin fecha válida. La fecha viaja como `yyyy-MM-dd` y se muestra con
`formatPaymentDate`, que toma el día tal cual viene de la API (el backend guarda medianoche UTC) sin pasar por
`Date`. "Sin fecha de pago" (`PAYMENT_DATE_TEXTS.missingInTable`) aparece para `PAID` sin fecha en la tabla de
`workload` (bajo el estado), en la columna "Cobrado" de Atenciones, en "Fecha de Cobro" de Admisiones y en los dos
detalles.

## 7. Cambios de comportamiento visibles

- `DELETE /pro/payers/:id`: con reglas, 409 (antes dejaba las reglas globales); con atenciones, 409 (antes 500).
- `POST /fee-rules`: ya no acepta la forma vieja de `splits` (400). `PayerRulesManager` cambia en el mismo cambio.
- `POST /activity` y `PUT /activity/:id`: `PAID` sin `paymentDate` da 400.
- Centavos: repartos y honorarios se calculan exactos; difieren en centavos de los anteriores (aceptado).
- El borrado de staff sin usuario con participaciones o splits ya no da 500: baja lógica.
- Atenciones y Admisiones: "Editar" ahora está habilitado también en atenciones pagadas (antes deshabilitado), para
  poder abrir el formulario con monto y pagador bloqueados y completar la fecha de pago de las 42 antiguas.

## 8. Cómo probarlo

1. Backend: `cd backend && npx tsc --noEmit && npx jest`. Guardias: `npx jest src/money-invariants
   src/transactions-invariants src/security-invariants test/org-isolation test/request-dto-invariants`.
2. Frontend: `cd frontend && npx tsc --noEmit && npm test`.
3. Migraciones: `.\dev.ps1 -CheckMigrations` (0).
4. Postgres real: se copió el volumen del usuario (montado `:ro`, contenedor sin red) a `solidus017-copy`; con el
   contenedor del usuario detenido; se levantó `postgres:16.11-alpine` sobre la copia en `127.0.0.1` con puerto
   efímero, se cambió la contraseña dentro de la copia, `prisma migrate deploy` y un script `ts-node` con la
   `ActivityService`, los handlers y `DashboardService` reales. **19 de 19**: `PUT` con monto y pagador (bruto
   777.77, los splits suman 777.77, participantes recalculados), `updateMany` con `NOT` compuesto en Prisma 5.22,
   cobrada + cambio = 409, cobrada + mismos valores = 200, `PAID` sin fecha = 400, **carrera real** (otra sesión
   mantiene el cobro sin confirmar: la edición espera y responde 409 sin cambios), FK `RESTRICT` real (P2003 al
   borrar un pagador con regla), pagador con reglas 409 con la regla intacta, con atenciones 409, sin vínculos se
   borra, staff participante con baja lógica, **P2003 real** (participación sin confirmar) con baja lógica, staff
   sin vínculos con borrado físico, KPIs en `number`. Al terminar: contenedor y volumen de la copia eliminados;
   `healthops-gem-db-1` y su volumen no se tocaron (detenido antes y después).
5. UI (a mano): editar una atención no cobrada en Prestaciones (monto y pagador habilitados, aviso de recálculo,
   "Guardar y recalcular", toast después de la respuesta); editar una cobrada (campos de solo lectura con el texto);
   "Marcar Pagado" en Prestaciones, Deudores (también varias), Atenciones y Admisiones: pide "Fecha de pago";
   Configuración, pagadores: "Eliminar pagador".

## 9. Desvíos respecto de 03

1. **Guardia M2 más estricta:** el operando "menciona dinero" en cualquier nivel (no solo si es un identificador o una
   propiedad directa). Es la única forma de cumplir el control del propio diseño (`sum + Number(x.amount)`).
2. **Helpers extra** en `money.ts`: `minMoney` y `wholePercent` (el `percent` entero de liquidaciones).
3. **`NOT_COLLECTED_WHERE`** se tipa con `satisfies` en lugar de `: Prisma.WorkItemWhereInput`: con el tipo ancho no
   servía en el `where` único de `delete` (error de TypeScript).
4. **Pagador con atenciones:** el diseño dejaba el 500 por defecto; se implementa el 409 por el criterio 17 (la
   verificación previa y el P2003 vuelven a contar reglas y atenciones).
5. **`RetroactiveModal`** (y los diálogos de fecha): componentes de cuerpo montados solo al abrir, en lugar de efectos
   que copian props al estado (la regla `react-hooks/set-state-in-effect` del repo los marca). El toast de éxito vive
   dentro del modal, después de que `onSave` resuelve. Se pierde la animación de cierre.
6. **`WorkItemForm`:** `onSubmit` puede ser asíncrono y el formulario cierra y avisa solo cuando resuelve; prop nueva
   opcional `onConflict`. La inicialización depende de `initialData?.id`. El bloque de participantes se oculta
   completo en edición (incluidos "Pack de Sesiones" y las horas de AT, que no aplican al `PUT`).
7. **Edición en Atenciones/Admisiones:** se habilita "Editar" en pagadas (ver sección 7). El diseño no lo preveía,
   pero sin eso el formulario con los campos bloqueados no se podía abrir.
8. **Estado del formulario:** `WorkItemForm` lee `status` además de `paymentStatus` del dato guardado (el listado usa
   `status`; antes una `PARTIAL` aparecía como Pendiente al editar).
9. **Alta con `PAID` sin fecha:** el 400 se valida antes que las lecturas y los permisos (no necesita ningún dato).
   En la edición va después del 404 y del 403.
10. **Fixture:** clave nueva opcional `setup: "collected"`; el contrato (p) la aplica. El front la ignora.
11. **Pruebas de carrera:** además de la carrera simulada con el fake, se probó la real en Postgres (el diseño lo
    pedía en §11).

## 10. Preguntas al PO

1. **Un pagador creado desde `PayerRulesManager` nunca se puede borrar.** `handleCreatePayer` crea una regla de
   honorarios al crear el pagador y hoy no hay forma de quitar reglas; con la restricción (decisión #75) la UI siempre
   explica que "tiene reglas asociadas". Opciones: (a) no crear la regla en el alta del pagador, (b) agregar una acción
   para quitar reglas, (c) dejarlo así. Se dejó (c) (la opción más conservadora; el botón sirve para pagadores sin
   reglas creados por otras vías, y el backend es la autoridad).
2. **Fecha precargada al editar una `PAID` antigua sin fecha.** El formulario precarga hoy (el campo es visible,
   obligatorio y modificable). Al guardar, esa atención queda con la fecha elegida. Alternativa: dejarlo vacío y
   obligar a elegirla. Se eligió precargar por lo que dice el criterio 16.
3. **"Editar" habilitado en atenciones pagadas** en Atenciones y Admisiones (sección 7). Confirmar que es lo que se
   quiere; el backend sigue rechazando monto y pagador en las cobradas (409).
4. **`PacientesTable`** tiene un modal de cobro que es un placeholder (`console.log`) y no marca nada. No se conectó.
   ¿Entra en otro feature o se retira?
5. **Texto del 409 `activity-already-collected`.** Dice "se cobró mientras la editabas", pero también se usa cuando
   un cliente de la API manda un cambio sobre una atención ya cobrada al leerla (decisión del diseño: un único
   texto). Si el PO prefiere dos mensajes, hay que sumar un segundo `code`.
6. **Registrar en el BACKLOG** (no lo hice): reglas `'all'` que el motor no aplica (prioridad media, decisión 1 del PO);
   las 42 atenciones `PAID` sin fecha; condición de edición con `settlementId`/`lockedAt` cuando se guarden las
   liquidaciones; `eventRole` fijo en `TITULAR` al recalcular (residuales del diseño §4.8).
7. **Documentación para el documentador:** los conteos de `CLAUDE.md` (Jest 45 suites / 815 tests y 87 tests del
   front) pasan a 51 / 932 y 112; falta documentar `money-invariants`, la migración, `payer-has-activities` y
   `payment-date-required`, y el hash del 016 en `PLAN-pendientes.md`.

## 11. Residuales conocidos

- La lista de pagadores del `RetroactiveModal` carga hasta 100 (`getPayers(…, 1, 100)`): con más, el pagador guardado
  aparece como opción deshabilitada.
- Una `SOLO_PRACTICE` cargada en modo organización con "Particular" se recalcula con el reparto particular (diseño §4.8).
- El front sigue calculando el precio del preset en coma flotante (es una propuesta que el backend valida y redondea).
- `activity.date` en `WorkItemForm` sigue usando `toISOString` para la fecha de la atención (fuera de alcance: el
  criterio 16 es solo la fecha de pago).
- Los avisos `prettier/prettier` que suman las líneas agregadas en archivos del backend que ya no estaban formateados.

## Ajustes por decisiones del PO (2026-11-18)

### 1. Pregunta 2: atención PAID antigua sin fecha (no se inventa la fecha)
- `frontend/src/lib/payment-date.ts`: `initialEditPaymentDate(savedPaid, savedDate)` (vacío si ya estaba pagada sin
  fecha; hoy local si no estaba pagada) y `editPaymentDateForBody(savedPaid, willBePaid, value)` (qué viaja en el PUT).
- `PaymentDateField.tsx`: prop `optional`; vacío es válido, sin asterisco ni `required`, y muestra "Sin fecha de pago"
  como ayuda.
- `WorkItemForm.tsx` (edición): una atención ya PAID sin fecha arranca con el campo vacío y opcional; si se deja vacío
  `paymentDate` NO viaja y se pueden guardar otros cambios; si se completa, viaja. La precarga con hoy sigue solo
  cuando la acción cambia el estado a pagado (alta con Pagado, de no pagado a Pagado en la edición). Al volver a
  Pagado desde Pendiente en una atención que ya estaba PAID sin fecha el campo sigue vacío (no se precarga).
- Verificado el resto: `RetroactiveModal` no maneja `paymentDate` (no lo manda nunca); "Marcar Pagado"
  (`workload/columns.tsx`), `MarkPaidDialog`, deudores, cobro múltiple y `PaymentRegistrationModal` solo actúan sobre
  atenciones que pasan de no pagadas a pagadas (precarga de hoy y fecha obligatoria; no son un modo de edición). El
  único formulario que edita una PAID existente es `WorkItemForm`.
- Tests (`payment-date.test.mts`, 8 nuevos): PAID sin fecha arranca vacía; PAID con fecha conserva la guardada; no
  pagada precarga hoy local (a las 22:30); PAID sin fecha sin tocar el campo = body sin `paymentDate`; completándola =
  body con esa fecha; cambio a Pagado = hoy precargado y obligatoria; estado final no pagado = nunca viaja; valor
  inválido rechazado.

### 2. Pregunta 4: PacientesTable
Conectar el cobro requiere más que reusar el flujo de AtencionesTable: `PacientesTable` carga con
`getWorkItems(orgSlug, 'ORGANIZATION')`, que devuelve `{ items, total }`, y hace `items.map(...)` sobre el objeto (falla),
y además mapea campos que la API no devuelve (`i.patient`, `i.gross`, `i.paid`) y fija `professionalSplit` en 0.70; sus
ids y datos no son confiables para un PUT por atención. Por la instrucción del PO NO se inventó nada: se ocultó la
acción "Registrar Cobro" y se quitó el modal placeholder (`console.log`) del archivo
(`org/pacientes/PacientesTable.tsx`). **Pendiente para el BACKLOG:** arreglar la carga de datos de esa pantalla (paginación
y campos reales del listado) y recién después conectar el cobro con el flujo de `AtencionesTable`.

### 3. Pregunta 5: texto del 409 `activity-already-collected`
Un solo `code`, texto único: "Esta atención ya está cobrada: el monto y el pagador no se pueden modificar. No se guardó
ningún cambio." Actualizado en `activity-errors.ts` (backend), `API_ERROR_MESSAGES.activityAlreadyCollected`
(`constants.ts`), `api-errors.test.mts` y `activity-update.service.spec.ts`. Sin cambios de UX (alert inline,
refresco, bloqueo).

### 4 y 5. Preguntas 3 y 1
Sin cambios (Editar habilitado en pagadas confirmado; pregunta 1 al BACKLOG).

### Conteos finales
| Control | Resultado |
|---|---|
| Backend `npx tsc --noEmit` | 0 errores |
| Backend `npx jest` | 51 suites, 932 tests en verde |
| Frontend `npx tsc --noEmit` | 0 errores |
| Frontend `npm test` | 120 tests en verde (antes 112) |
| Frontend lint (archivos tocados) | Sin errores nuevos: `WorkItemForm` + `PacientesTable` 38 errores (en `HEAD` 37 errores + 3 avisos); `payment-date.ts`, su test y `PaymentDateField.tsx` en 0 |

Para el documentador: el conteo de tests del front en `CLAUDE.md` pasa a 120.

## Corrección vuelta 1 (2026-11-18)

Revisor RECHAZADO (MAYOR-1, MAYOR-2); seguridad APROBÓ con menores (INFO-1 incluido acá).

### 1. MAYOR-1: edición de una PAID antigua sin fecha
- **Front (a):** `frontend/src/lib/activity-edit.ts` suma `isSavedPaid` (tipado, quita el `any` de `WorkItemForm.tsx:116`),
  `savedPaymentStatusOf` y `buildEditActivityBody`. `WorkItemForm.tsx` arma el PUT de edición con ese builder:
  `paymentStatus` solo viaja si cambió respecto de lo guardado; `paymentMethod` solo si cambió el estado o el método
  (comparado con lo guardado o el default del formulario, Efectivo); `paymentDate` solo si hay una. El único formulario
  que edita una PAID existente es `WorkItemForm`; `RetroactiveModal` no manda campos de cobro.
- **Backend (b):** `activity.service.ts`, `updateActivity`: la fecha se exige solo si el pedido hace que la atención
  PASE a PAID (guardada no PAID y resultado PAID) sin fecha en el pedido ni guardada, o si manda `paymentDate` `null` o
  `''` (intento de borrarla) y el resultado es PAID (400 `payment-date-required`, nada cambia). Mandar `PAID` igual a lo
  guardado no es cambio. Alta con PAID: sin cambios (sigue obligatoria). `UpdateActivityInput.paymentDate` pasa a
  `string | null`. Decisión documentada: hasta ahora `null` y `''` pasaban el DTO como "ausente" y se ignoraban; ahora
  sobre una PAID son 400 (sobre una no PAID siguen ignorados).
- **Tests backend** (`activity-update.service.spec.ts`; el de la línea ~591 se reemplazó): PAID sin fecha + otro campo +
  mismo status = 200 sin fecha; UNPAID a PAID sin fecha = 400; PAID con fecha + `null` / `''` = 400 y la fecha intacta;
  se conserva "PAID sin fecha completada con fecha".
- **Tests front (c)** (`activity-edit.test.mts`, 5 nuevos): body COMPLETO de edición de una PAID sin fecha (solo `date` y
  `attendance`, sin `paymentStatus`, `paymentMethod` ni `paymentDate`), con método guardado, con lo que sí cambió,
  PAID a Pendiente, y `isSavedPaid`/`savedPaymentStatusOf`.

### 2. MAYOR-2: `DeudoresTable`
- `ui/data-table.tsx`: prop opcional `getRowId` (sin ella, igual que antes: no rompe otros usos). `DeudoresTable` pasa
  `getRowId={(row) => row.id}`: la selección es por id de atención.
- `frontend/src/lib/bulk-payment.ts` (nuevo, puro): `selectedById`, `pruneSelection`, `removeFromSelection`, `payEach`.
  `load()` ya no pone `loading` en true tras la primera carga, así que ni la tabla ni `MarkPaidDialog` se desmontan al
  recargar: la fecha elegida se conserva. `load()` poda la selección a los ids presentes (cubre el borrado de un
  registro). Tras un fallo parcial: las cobradas salen de la selección y no se reenvían, el diálogo queda con las
  fallidas y la misma fecha.
- Tests (`bulk-payment.test.mts`, 4 nuevos, agregado al script `test`): selección por id aunque las filas se corran,
  poda tras borrado, `removeFromSelection`, y fallo parcial con reintento (cada atención se manda una sola vez).

### 3. Lint
`WorkItemForm.tsx` vuelve a 34 errores (HEAD: 34 errores + 3 avisos). `DeudoresTable` 4 = 4 errores,
`data-table.tsx` 1 = 1, `PacientesTable` 3 = 3; `activity-edit.ts`, `bulk-payment.ts`, `columns.tsx` de pacientes: 0.
Backend `activity.service.ts`: 48 errores (HEAD 59); el spec nuevo 0 errores.

### 4. INFO-1 de seguridad
`grossChanged` compara `sameMoney(roundMoney(input.grossAmount), existing.grossAmount)`. Nota: `sameMoney` ya redondeaba
ambos lados, así que el falso 409 no se reproducía; el redondeo explícito deja la intención a la vista. Test nuevo:
`100.001` sobre `100.00` en una cobrada = 200 (no es cambio, sin 409).

### 5. PacientesTable
Se quitó `rowSelection` de `PacientesTable.tsx` y la columna de casillas (y el import de `Checkbox`) de
`org/pacientes/columns.tsx`.

### 6. Menores NO corregidos (al BACKLOG por el documentador)
Avisos prettier en archivos viejos (MENOR-3), cobro múltiple heredado en Atenciones/Admisiones (MENOR-2), límites de la
guardia de dinero (`.toNumber()`, `+` unario; MENOR-4), "Particular" duplicado por carrera (MENOR-5), `eventRole` fijo
en `TITULAR` (MENOR-8), MENOR-2 de seguridad, archivos sin trackear ajenos (MENOR-7). No se tocó nada de eso.

### Conteos finales
| Control | Resultado |
|---|---|
| Backend `npx tsc --noEmit` | 0 errores |
| Backend `npx jest` | 51 suites, **935** tests en verde (antes 932) |
| Frontend `npx tsc --noEmit` | 0 errores |
| Frontend `npm test` | **129** tests en verde (antes 120) |

Para el documentador: `CLAUDE.md` pasa a 51 / 935 (backend) y 129 (front).

## Corrección vuelta 2 (2026-11-18)

**Causa (BUG-1).** `fee-resolution.service.ts` re-exportaba con alias (`export { SplitType } from '@src/...'` y `export type { SplitDefinition } from '@src/...'`). El hook de alias de Nest CLI (`tsconfig-paths.hook`) falla con `Cannot read properties of undefined (reading 'checkJsDirective')`, por lo que `nest build` / `nest start` / `.\dev.ps1` / Dockerfile no compilaban. `tsc --noEmit` y Jest no lo detectan.

**Cambios.**
- `backend/src/infrastructure/features/fee-engine/fee-resolution.service.ts`: se quitaron los dos re-exports. Ningún otro archivo de `src/` ni `test/` los consumía desde ahí (el servicio ya importa `SplitType`/`SplitDefinition` directo de `@src/domain/features/fee-engine/split-definition`, única fuente). También se aplicó `eslint --fix` a ese archivo (14 errores de prettier de la vuelta 1, solo formato).
- Búsqueda de otros `export ... from '@src/...'` en `backend/src` y `backend/test`: ninguno (ni del 017 ni anteriores).

**Guardia.** `backend/test/nest-build-compat.spec.ts` (del tester) se conserva: es estática (lee `src/`, no ejecuta `nest build`, no escribe nada, determinista, milisegundos) y falla si un archivo de producción tiene `export {..}|* from '@src/'`. Decisión: no correr `nest build` real en Jest por lento y por escribir en `dist/`. Ahora pasa.

**Verificación.**
- `npx nest build`: sin errores (~7 s), genera `dist/src/api/main.js` (ruta de `start:prod`). `dist/` está ignorado por git; se deja el regenerado.
- Backend `npx tsc --noEmit`: 0 errores. `npm test`: 52 suites, 936 tests, todo verde. eslint sobre los archivos tocados: sin errores.
- Frontend `npx tsc --noEmit` 0 errores; `npm test` 129/129.
- `.\dev.ps1 -CheckMigrations`: 0 ("Schema y migraciones coinciden").
- `.\dev.ps1`: backend responde en 8080 (liveness 200) y frontend en el puerto 3002 (3000 estaba ocupado por un proceso ajeno, no tocado). `.\dev.ps1 -Smoke`: Backend OK, Frontend OK, Login OK (a la segunda corrida: la primera se hizo en otra invocación de shell que cerró las ventanas). `.\dev.ps1 -Stop` al final. Sin escrituras manuales en la base.
