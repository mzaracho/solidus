# 017 — Revisión de código

Revisor, 2026-11-18. Base `07b43e0` más el árbol de trabajo (archivos modificados y sin trackear). No se modificó código.

## 1. Controles ejecutados

| Control | Resultado |
|---|---|
| Backend `npx tsc --noEmit` | 0 errores |
| Backend `npx jest` | 51 suites, 932 tests en verde (coincide con lo informado) |
| Frontend `npx tsc --noEmit` | 0 errores |
| Frontend `npm test` | 120 tests en verde |
| `.\dev.ps1 -CheckMigrations` | código 0: "Schema y migraciones coinciden" |
| Lint frontend (12 archivos tocados con hallazgos, contra copias de `HEAD`) | Solo hay UN error nuevo: `WorkItemForm.tsx:116` (`@typescript-eslint/no-explicit-any`). `WorkItemForm` pasa de 34 errores y 3 avisos a 35 errores y 0 avisos; `PacientesTable` 3 = 3; `RetroactiveModal` 1 a 0; el resto igual. Los archivos nuevos dan 0 |
| Lint backend (`npx eslint` por archivo, contra copias de `HEAD`) | Sin reglas de TypeScript nuevas en lo agregado, salvo avisos `prettier/prettier` en líneas agregadas de archivos que ya no estaban formateados: `org-isolation.spec.ts` (+10), `payer-commands.ts` (+5), `staff-commands.ts` (+2), `find-activity-by-id-query.ts` (+2), `activity-handlers.spec.ts` (+1 error y +1 aviso). `calculate-settlements-query.ts` baja de 165 a 161 errores. Son la clase de error que domina el baseline; ver MENOR-3 |

Las copias de `HEAD` para comparar el lint se escribieron en una carpeta temporal dentro de `frontend/src` y `backend/src` y se borraron al terminar (`git status` no muestra rastros).

## 2. Conformidad con la spec y el diseño (resumen)

- **Dinero exacto (1 a 4):** `money.ts` es correcto. `distributeByPercentages` termina siempre (el faltante es a lo sumo uno por fila y el cursor es circular), el objetivo `round(total * Σp / 100)` nunca queda por debajo de la suma de pisos, y el desempate por orden es determinista. Todas las salidas a JSON pasan por `toJsonNumber`, así que el formato no cambia (criterio 2): `dashboard`, `settlements`, listado, detalle, deuda de pacientes, `grossAmount` del alta. `isCollected` se suma como campo nuevo. No hay migración de datos.
- **Motor (5 a 7):** el tope `min(valor, bruto - asignado)` con mínimo 0 está en `fee-resolution.service.ts` (`computeAmounts`). El normalizador de lectura acepta la forma vieja y la del motor, y lanza un 500 controlado ante cualquier otra. El test de regresión (criterio 6) fija valores literales (`'700'`, `'123.46'`, `'1111.1'`), no los deriva del código nuevo. Casos cubiertos: 70/30, resto a la organización, 33.33 x 3, FIXED, retención, SOLO_PRACTICE, CLINIC con categoría, prioridades y regla `'all'` que no llega al motor.
- **Edición (8 y 9):** `ActivityService.updateActivity` cumple la regla 5 (dentro de la transacción solo se usa `tx`; las lecturas previas usan `this.prisma` fuera de ella). El `updateMany` lleva `NOT_COLLECTED_WHERE` y, con `count = 0`, distingue 404 de 409. "Mismo valor no es cambio" se resuelve con `sameMoney`. El orden de errores coincide con 04.
- **`payerId: null`:** crear el pagador "Particular" dentro de la transacción es correcto y seguro: la lectura previa solo decide si hay que crearlo, la creación se revierte si el `updateMany` da 409 o 404, y la organización sale de lo guardado en la atención (no del pedido). Es el mismo patrón del alta. Queda el residual de MENOR-5.
- **Pagadores y staff (11, 12, 17):** la migración `20261118120000_fee_rule_payer_restrict` solo recrea la FK con `RESTRICT` (sin datos). `DeletePayer` da 409 `payer-has-fee-rules` o `payer-has-activities`, con verificación previa más P2003 y P2025. `DeleteStaff` extiende la regla 2 a participantes y beneficiarios, con P2003 a baja lógica y P2025 a 404. Los casos con usuario no cambian. El botón "Eliminar pagador" se muestra a ADMIN y al dueño.
- **Guardia `money-invariants`:** no es ciega. Tiene control positivo (un snippet con `Number`, `*`, `toFixed`, `Math` y `parseFloat` da M1 y M2), un control negativo, verifica que cada entrada de la lista blanca exista y siga siendo un hallazgo, y exige justificación. La lista blanca tiene 3 entradas, todas de paginación (`total / limit`, `Math.ceil(total / limit)`, `Number(limit)`), bien justificadas. Los límites reales están en MENOR-4.

## 3. Hallazgos

### BLOQUEANTE
Ninguno.

### MAYOR

**MAYOR-1. Editar una atención `PAID` antigua sin fecha, sin tocar el estado, da 400 `payment-date-required` desde `WorkItemForm`.**
- Archivos: `frontend/src/components/domain/workload/form/WorkItemForm.tsx:521-528` y `backend/src/infrastructure/features/activity/activity.service.ts:402`.
- La decisión del PO y el criterio 16 dicen que las ediciones que no tocan `paymentStatus` en una `PAID` sin fecha no se bloquean, y que si el campo "Fecha de pago" queda vacío `paymentDate` no se manda. Pero el formulario manda SIEMPRE `paymentStatus` (con `PAID` cuando la atención ya estaba pagada). El backend rechaza `paymentStatus = PAID` sin fecha en el pedido ni guardada (`activity.service.ts:402`; lo confirma el test "marcar PAID de nuevo una PAID sin fecha... 400", `activity-update.service.spec.ts:591`). Resultado: para las 42 atenciones antiguas, cambiar cualquier otro campo con la fecha vacía falla con "tenés que indicar la fecha de pago", que es lo contrario de lo decidido. Los tests de front (`editPaymentDateForBody`) solo cubren qué fecha viaja, no el body completo, y 04 lo da por verificado.
- Remediación (elegir una):
  1. En la rama de edición de `WorkItemForm`, omitir `paymentStatus` (y `paymentMethod`) cuando no cambiaron respecto de lo guardado: `...(statusChanged ? { paymentStatus } : {})`.
  2. Alternativa en el backend: en `updateActivity` exigir la fecha solo si el `paymentStatus` del pedido cambia el estado guardado (`input.paymentStatus === PAID && existing.paymentStatus !== PAID && ...`), y ajustar el test de la línea 591.
  - Agregar un test que arme el body de edición de una `PAID` sin fecha y compruebe que no lleva `paymentStatus: PAID` sin fecha.

**MAYOR-2. Cobro múltiple de `DeudoresTable`: tras un fallo parcial la selección queda desalineada y el diálogo pierde la fecha elegida.**
- Archivo: `frontend/src/components/domain/pro/deudores/DeudoresTable.tsx:121-139`, `:166-168` (y `ui/data-table.tsx`, que no define `getRowId`).
- (a) La selección se guarda por índice de fila (`rowSelection[index]`). En el camino de fallo parcial (`:131-133`) se hace `await load()` pero no se limpia `rowSelection`: las atenciones ya cobradas salen de `data`, los índices se corren, y la barra "Marcar seleccionadas como cobradas" pasa a apuntar a OTRAS atenciones (la casilla queda tildada en filas que el usuario no eligió). Lo mismo ocurre al borrar un registro (`:106`, `load()`) con filas seleccionadas. Con dinero de por medio, un clic siguiente puede cobrar atenciones equivocadas.
- (b) `load()` hace `setLoading(true)` y el componente devuelve "Cargando deudores..." (`:166`), así que `MarkPaidDialog` se desmonta y vuelve a montar: el comentario "para reintentar con la misma fecha" es falso, la fecha vuelve a hoy sin aviso.
- No se informa éxito falso (el toast de éxito solo sale si no hubo fallos y el diálogo queda abierto con las fallidas), eso está bien.
- Remediación: pasar `getRowId={(row) => row.id}` a `DataTable` y derivar `selectedItems` por id (o limpiar `rowSelection` en cada `load()`); no desmontar el diálogo durante la recarga (usar un estado `refreshing` que no reemplace todo el árbol) o conservar la fecha elegida en el padre y pasarla como valor inicial. Opcional: el toast de fallo parcial puede decir cuántas se cobraron y cuántas no.

### MENOR

**MENOR-1. Un error de lint nuevo (regla 7).** `frontend/src/components/domain/workload/form/WorkItemForm.tsx:116`: `isSavedPaid = (initialData: any)`. Tipar el parámetro (`{ paymentStatus?: string; status?: string; paid?: boolean } | null | undefined`).

**MENOR-2. Texto de éxito en el cobro múltiple de `AtencionesTable` y `AdmisionesTable` (heredado, sin cambio).** `AtencionesTable.tsx:350-366` y `AdmisionesTable.tsx:448`: ante un fallo en la mitad de la lista no se refresca la tabla ni se dice cuáles se cobraron. No es regresión del 017, pero ahora la fecha es obligatoria y conviene el mismo tratamiento que el de deudores (refrescar siempre tras el intento).

**MENOR-3. Avisos `prettier/prettier` en líneas agregadas de archivos ya desformateados** (ver tabla). No son errores de lógica y es la clase del baseline de 768, pero la regla 7 pide "sin errores nuevos en los archivos tocados". Si no se quiere reformatear los archivos enteros, al menos formatear solo las líneas nuevas (`npx prettier --write` sobre un parche o a mano). Decisión del PO.

**MENOR-4. Límites de la guardia `money-invariants`.** `test/helpers/money-ops.ts`: la regla M2 se apoya en nombres (`MONEY_NAME`); no ve `.toNumber()`, el `+` unario ni la aritmética entre resultados de `toJsonNumber(...)` si las variables no tienen nombre de dinero, y solo escanea los 8 archivos de `MONEY_FILES` (un camino de dinero nuevo en otro archivo no se vigila). Está documentado en la cabecera del helper, así que es aceptable; sugerencia: sumar `toNumber` y el `+` unario a M1 y agregar un test que recorra `src/` buscando `_sum` o `Decimal` fuera de `MONEY_FILES` para avisar de caminos nuevos.

**MENOR-5. Carrera residual al crear el pagador "Particular".** `activity.service.ts:419-425` y `:458-461`: la búsqueda por nombre va fuera de la transacción y `Payer` no tiene unicidad `(organizationId, name)`, así que dos pedidos simultáneos pueden crear dos "Particular". Es el mismo comportamiento del alta y queda dentro de #73 (restricciones únicas); anotarlo en el BACKLOG.

**MENOR-6. `PacientesTable.tsx`.** Se quitó el modal y la acción, pero quedó el estado `rowSelection` y la columna de casillas sin ninguna acción asociada. Es una pantalla ya rota (ver 04, ajuste 2); basta con el pendiente en el BACKLOG, o quitar la columna de selección.

**MENOR-7. Archivos sin trackear ajenos al feature.** `.vscode/settings.json` y `frontend/AGENTS.md` (este último lo re-genera `next dev`) aparecen en `git status`. No deben entrar en el commit del 017; agregarlos a `.gitignore` o dejarlos fuera.

**MENOR-8. Texto del recálculo y `eventRole`.** Al recalcular, `eventRole` queda fijo en `TITULAR` (`activity.service.ts:495`) y el alta usa `data.role`; está en los residuales de 04 y debe ir al BACKLOG (lo hace el documentador). Idem para `SOLO_PRACTICE` en modo organización con "Particular".

## 4. Tests faltantes

- MAYOR-1: test de integración del body de edición de `WorkItemForm` (o extraer a una función pura `buildEditBody` y probarla) para una `PAID` sin fecha con campos distintos de `paymentStatus` cambiados.
- MAYOR-2: test de `DeudoresTable` no es viable sin framework de componentes; al extraer `selectedItems` por id a un helper puro se puede probar con `node --test`.

## 5. Veredicto

La parte de backend (dinero exacto, motor, edición con recálculo, borrados, migración) es correcta y está bien cubierta. Hay dos defectos mayores del lado del front que afectan comportamientos pedidos explícitamente (decisión del PO sobre las `PAID` sin fecha, y el cobro múltiple con fallos parciales). Ninguno es bloqueante porque no hay pérdida de datos, pero ambos deben corregirse antes de pasar a seguridad.

VEREDICTO: RECHAZADO


## Re-revisión vuelta 1 (2026-11-18)

Revisor, sobre `git diff` contra `07b43e0` y el árbol de trabajo. No se modificó código.

### Controles

| Control | Resultado |
|---|---|
| Backend `npx tsc --noEmit` | 0 errores |
| Backend `npx jest` | 51 suites, 935 tests en verde (coincide) |
| Frontend `npx tsc --noEmit` | 0 errores |
| Frontend `npm test` | 129 tests en verde (coincide) |
| Lint frontend, ahora contra `HEAD` (`git show HEAD:<ruta> \| eslint --stdin`, sin tocar el árbol) | `WorkItemForm` 34e/0w contra 34e/3w; `DeudoresTable` 4e/3w = 4e/3w; `data-table` 1e/1w = 1e/1w; `PacientesTable` 3e/0w = 3e/0w; `pacientes/columns` 0e/1w = 0e/1w; `activity-edit.ts` y `bulk-payment.ts` 0e/0w. Sin errores nuevos. MENOR-1 (el `any` de la línea 116) queda resuelto |
| Lint backend (`npx eslint` por archivo) | `activity.service.ts` 48e/2w contra 59e/4w en `HEAD` (baja). `activity-update.service.spec.ts` (archivo nuevo): 0 errores, 2 avisos |

### Estado de los hallazgos anteriores

**MAYOR-1: RESUELTO.**
- Front: `buildEditActivityBody` (`activity-edit.ts`) manda `paymentStatus` solo si el estado del formulario difiere del guardado (`savedPaymentStatusOf`, que lee `paymentStatus` o `status` y `paid`), `paymentMethod` solo si cambió el estado o el método, y `paymentDate` solo si hay una. `WorkItemForm` lo usa en la rama de edición. Los tests arman el body COMPLETO (PAID sin fecha: solo `date` y `attendance`; con método guardado; con cambios; PAID a Pendiente), que era el faltante que señalé.
- Backend (`activity.service.ts:401-413`): la fecha se exige solo al pasar a PAID (`becomesPaid`) sin fecha en el pedido ni guardada, o al mandar `null` / `''` si el resultado queda PAID (400 `payment-date-required`, ese es el 400 que el PO aceptó). Verifiqué que el DTO (`IsOptionalDateString`) deja pasar `null` y `''`, así que esa rama sí se alcanza por la API real, y que sobre una no PAID siguen ignorados. El alta sigue exigiendo fecha (`:74`). Tests cubren: PAID sin fecha más otro campo = 200; UNPAID a PAID sin fecha = 400; PAID con fecha más `null` / `''` = 400 sin cambios; completar la fecha.
- Observación sin gravedad: con `paymentStatus` ausente y `paymentDate` `null` sobre una PAID también da 400 (es el caso aceptado).

**MAYOR-2: RESUELTO.**
- (a) Selección por id: `getRowId` opcional en `data-table.tsx` (sin la prop pasa `undefined` a TanStack y se comporta como antes, así que otros usos no cambian; `tsc` y lint iguales) y `DeudoresTable` lo pasa. `selectedById` deriva los ítems por id, `pruneSelection` poda tras `load()` (cubre el borrado) y `removeFromSelection` saca las cobradas tras el intento. Las cobradas no se reenvían: `itemsToPay` pasa a `failed`, y `payEach` manda cada atención una vez (test de reintento).
- (b) `load()` ya no pone `loading` en true, así que ni la tabla ni `MarkPaidDialog` se desmontan y la fecha elegida se conserva en el reintento.
- Sin éxito falso: el toast de éxito y el cierre solo ocurren si `failed` está vacío; si hay fallos se relanza el error para que el diálogo siga abierto.
- Tests puros en `bulk-payment.test.mts` (4), agregado al script `test`. La parte de React no tiene test, pero la lógica de selección sí.

**MENOR-1: RESUELTO** (ver lint). **MENOR-6: RESUELTO** (se quitó `rowSelection` y la columna de casillas de pacientes). **INFO-1 de seguridad:** `roundMoney` explícito en `grossChanged`, con test.
**MENOR-2, 3, 4, 5, 7 y 8: SIGUEN ABIERTOS**, declarados como no corregidos y destinados al BACKLOG; no bloquean.

### Hallazgos nuevos

- **MENOR-9.** `activity-update.service.spec.ts` (nuevo) tiene 2 avisos de lint (0 errores). Revisarlos al pasar, sin urgencia.
- **MENOR-10.** `DeudoresTable.tsx` `confirmMarkPaid`: tras un fallo parcial, `itemsToPay` queda en `failed` aunque `load()` poda la selección. Si una de las fallidas dejó de existir en el servidor (por ejemplo, otro usuario la cobró), el diálogo la seguirá ofreciendo hasta cerrarse. Es un borde raro y el backend responde con error claro; no hace falta tocarlo ahora.

No se encontraron regresiones: 935 y 129 tests en verde, `tsc` limpio en ambos repos, lint sin errores nuevos.

VEREDICTO: APROBADO


## Re-revisión vuelta 2 (2026-11-18)

Alcance: BUG-1 de `07-testing.md` (`nest build` roto por re-exports con alias `@src/`) y la corrección de la vuelta 2.

### Verificaciones ejecutadas
- `npx nest build` (con `dist/` borrado antes): sin errores; genera `dist/src/api/main.js`. BUG-1 resuelto.
- `npx tsc --noEmit`: 0 errores.
- `npm test`: 52 suites / 936 tests en verde (lo esperado).
- `npx eslint` sobre `fee-resolution.service.ts` y `test/nest-build-compat.spec.ts`: sin salida, código 0.
- Búsqueda en `src/` (sin specs) de `export {..}/export *` desde `@src/`: 0 coincidencias.

### fee-resolution.service.ts
- Ya no hay `export ... from` en el archivo; `SplitType` y `SplitDefinition` se importan desde `@src/domain/features/fee-engine/split-definition` (import normal, que el hook sí resuelve).
- Diff de formato (`eslint --fix`/prettier): `git diff -w` solo deja los cambios funcionales de la vuelta 1 (Money/Decimal, `distributeByPercentages`, `normalizeSplitDefinitions`). Lo puramente de formato (imports multilínea, `findUnique` en varias líneas, `logger.log` partidos, comas finales) no cambia lógica. Sin hallazgos.

### nest-build-compat.spec.ts
- Probé la regex con casos reales: detecta `export { A } from '@src/x'`, `export type { A } from "@src/x"` (comilla doble), `export * from`, `export * as n from`, `export type * from` y `export {\n A,\n B\n} from` en varias líneas. No da falso positivo con la línea comentada ni con rutas relativas.
- Recorre todo `src/` de forma recursiva, excluye `.spec.ts` y `.d.ts`; es síncrona, determinista y rápida (la suite completa tarda ~15 s).
- MENOR-1 (`backend/test/nest-build-compat.spec.ts`, línea 31-37): no tiene control positivo; si alguien rompe la regex (o cambia `SRC`) el test pasaría en silencio. Sugerencia: agregar un `it` que pruebe `REEXPORT_WITH_ALIAS` contra 5 o 6 cadenas literales (las de arriba) y que `productionFiles(SRC).length > 0`. No bloquea: la regex fue verificada a mano aquí.
- MENOR-2 (misma regex): exige que `export` abra la línea (`^\s*`); un `export` tras `;` en la misma línea no se detecta. Prettier lo impide, riesgo despreciable.

### Hallazgos
- BLOQUEANTE: ninguno.
- MAYOR: ninguno.
- MENOR: MENOR-1 y MENOR-2 (opcionales).

VEREDICTO: APROBADO
