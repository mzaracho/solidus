# 017 — Diseño técnico: dinero exacto, motor de honorarios y bajas con historial

Arquitecto, 2026-11-18. Base: `main` en `07b43e0` (016). Ítems: #17, #40, #45, #75 y #76.
Insumos: `01-spec.md` (criterios 1 a 15), `02-ux.md` y las decisiones de `00-estado.md`.

## 0. Resumen de decisiones

| Tema | Decisión |
|---|---|
| Dinero (#17) | Helper único `src/domain/seed-work/money.ts` sobre `Prisma.Decimal`. Toda la aritmética de los caminos de dinero pasa por él; la única salida a `number` es `toJsonNumber()`, solo donde la respuesta ya devolvía `number`. Guardia estática nueva `src/money-invariants.spec.ts`. |
| Reparto de centavos | Método del mayor resto, con desempate por el orden de la definición. Los `FIXED` y los porcentajes se acotan en orden a lo que queda del bruto. El resto va a una fila ORG `Remainder`, como hoy. |
| Formato JSON | Sin cambios: los endpoints que devolvían `number` siguen con `number`, y `PUT /activity/:id` sigue devolviendo la fila de Prisma. Solo se agrega el booleano `isCollected` a `GET /activity` y `GET /activity/:id`. |
| `splits` (#40) | Forma única: la del motor, `{ beneficiary: 'ORG'\|'PROFESSIONAL', type: 'PERCENTAGE'\|'FIXED', value, roleLabel? }`. Al escribir solo se acepta esta forma. Al leer se normaliza también la forma vieja de la UI. En la base local hay 0 reglas, así que no hace falta migrar datos. |
| "Cobrada" | `paymentStatus = PAID` **y** `paymentDate` no nulo (la misma condición que la salvaguarda del borrado). Se define una sola vez en `src/domain/features/activity/activity-collected.ts`. El front la recibe ya calculada en `isCollected`. |
| PUT con monto o pagador (#45) | Transacción interactiva. Primero, `workItem.updateMany` con la condición "no cobrada" en el `where`: si `count = 0`, 404 o 409 `activity-already-collected`. Después recalcula los honorarios de los participantes y reemplaza los splits con el mismo código del alta. |
| Borrado de pagador (#75) | La FK `FeeRule.payerId` pasa de `SET NULL` a `RESTRICT` (migración) y se verifica antes. Responde 409 `payer-has-fee-rules`, sin carrera porque la restricción la hace cumplir la base. |
| Staff (#76) | La regla 2 se extiende a participantes y beneficiarios de splits. Si el borrado físico choca con un vínculo nuevo (P2003), se hace la baja lógica. Nunca 500 ni 409. |
| Schema | Un cambio: `onDelete: Restrict` en `FeeRule.payer`. Es una migración que solo cambia la restricción, sin tocar datos (regla 6). |

## 1. Relevamiento

### 1.1 Base local (solo lectura)
Se consultó el contenedor `healthops-gem-db-1` con `BEGIN READ ONLY … ROLLBACK`, pidiendo solo conteos y formas de
JSON. No se imprimieron datos personales ni credenciales. El contenedor estaba detenido: lo levanté para leer y lo dejé
detenido de nuevo al terminar.

| Dato | Valor |
|---|---|
| Organizaciones | 2 `SOLO_PRACTICE`, 1 `CLINIC` |
| `FeeRule` | **0** (ninguna en la forma vieja ni en la del motor; ninguna con `professionalCategory = 'all'`) |
| Categorías llamadas `all` | 0 |
| `WorkItem` | 324, todas `PAID`: 282 con `paymentDate` y **42 `PAID` sin `paymentDate`**. Ninguna `PARTIAL` ni `UNPAID` |
| `WorkItem.settlementId` / `lockedAt` no nulos; filas en `Settlement` | 0 / 0 / 0 |
| `grossAmount ≠ amountBase + amountCard` / con `amountCard > 0` | 0 / 0 |
| `WorkItemSplit` | 676, y en las 324 atenciones la suma de los splits es igual al bruto (0 de más, 0 de menos) |
| `WorkItemParticipant` | 352 (en las 324 atenciones) |
| `Payer` | 5 (3 de sistema, 2 de un profesional, 2 con retención). Hay 3 que se llaman "Particular*" y 1 pagador con atenciones |
| `Professional` | 12 (9 sin usuario, 0 dados de baja). De los 9 sin usuario y activos: 4 tienen atenciones propias, 0 son solo participantes y 0 son beneficiarios sin atenciones propias |

### 1.2 Hallazgos que condicionan el diseño
1. **`WorkItem.payerId` es `NOT NULL`, con FK `RESTRICT`** (`schema.prisma:189`, migración init:209). Una atención
   "sin pagador" no puede existir en la base. "Particular" es un `Payer` real: el pagador por defecto de la
   organización, con el nombre `settings.privatePayerName` (por defecto "Particular") y `isManagedBySystem = true`.
   Lo crea `createActivity` si falta (`activity.service.ts:184-238`). El `'Unknown'` del listado
   (`find-all-activities-query.ts:203`) solo aparece si el nombre está vacío. El `'—'` lo agrega el front
   (`data-schema.ts:455`). Ver §4.6.
2. **Las reglas que crea `PayerRulesManager` nunca coinciden con el motor.** El front las guarda con
   `professionalCategory: 'all'` (`PayerRulesManager.tsx:97,146`). El motor solo acepta `professionalCategory` nulo o
   igual al nombre de la categoría del profesional (`fee-resolution.service.ts:74-77`). Solo `FindFeeRulesQuery`
   trata `'all'` como comodín, y lo hace para listar (`fee-rule-commands.ts:58`). Por eso esas reglas no participan
   en el cálculo: el motor cae en la retención del pagador o en el porcentaje de la categoría. Si alguna coincidiera
   (por ejemplo, con una categoría llamada `all`), la forma de la UI daría `NaN` y `beneficiaryType` indefinido, y
   el alta fallaría con un 500. Ver la pregunta 1 al PO.
3. **No existe ningún endpoint que edite los splits ni los honorarios de los participantes.** Las únicas escrituras
   son los `createMany` del alta (`activity.service.ts:318,358`). Los "ajustes manuales" que se reemplazan solo
   pueden venir de seeds o de SQL directo. No hace falta exponer un indicador de "tiene ajustes manuales".
4. **El modo (org/pro) y el `role` del alta no se guardan.** El modo solo decide el reparto particular en
   `SOLO_PRACTICE` (`activity.service.ts:331-343`), y `eventRole` vale `data.role ?? 'TITULAR'`. El front nunca
   manda `role`. Ver §4.8.
5. **Las liquidaciones no se guardan.** `Settlement` tiene 0 filas, `settlementId` y `lockedAt` no se escriben en
   ningún lado y `settlements/calculate` y el dashboard calculan en el momento. **Ninguna protección del backend
   depende de la regla de 30 días del `RetroactiveModal`**, que solo existe en el front
   (`RetroactiveModal.tsx:34-37`). Se elimina, como pidió el PO. Efecto que hay que conocer: corregir una atención
   vieja no cobrada cambia la liquidación y los KPIs de su mes. Es lo que decidió el usuario. Cuando las
   liquidaciones se guarden (fuera de alcance), la condición de edición tendrá que sumar `settlementId`/`lockedAt`
   (BACKLOG).
6. **Hoy no existe el 409 "provisional" del pagador.** `DeletePayerCommandHandler` (`payer-commands.ts:255-259`)
   hace `payer.delete` sin más: con fee rules, las deja globales (`SET NULL`); con atenciones, falla con P2003 y da
   500. Ver §5.
7. Varias acciones marcan una atención como `PAID` **sin** fecha de pago: "Marcar Pagado" de `workload/columns.tsx:68`
   y `DeudoresTable.tsx:113`. Con la definición de "cobrada" que decidió el PO, esas atenciones siguen siendo
   editables (en la base local son 42). Ver la pregunta 2.

## 2. Dinero exacto (#17)

### 2.1 Caminos de dinero con `number` (criterio 1)

| Archivo | Líneas | Qué hace hoy |
|---|---|---|
| `infrastructure/features/fee-engine/fee-resolution.service.ts` | 17, 23, 30 | `WorkContext.grossAmount`, `SplitDefinition.value` y `SplitResult.amount` son `number` |
| idem | 97-98 | Retención: `Number((gross * pct/100).toFixed(2))`, y para el profesional `gross − retention` en float |
| idem | 140-141, 151, 156 | Fallback CLINIC: porcentaje de la categoría con `toFixed`; ORG = resto; `100 - categoryPct` en la etiqueta |
| idem | 230-262 (`computeAmounts`) | `FIXED` sin tope (235); porcentaje con `Number(toFixed)` (238); `totalAllocated += amount` (251); resto en float (255-259) |
| `infrastructure/features/activity/activity.service.ts` | 216 | `Number(amountBase) === 0` |
| idem | 305, 312 | `calculateParticipantFee(…, Number(amountBase))` y `new Decimal(feeAmount)` |
| idem | 341 | Reparto particular: `Number(grossAmount) * proPct`, **sin redondear** |
| idem | 352, 363 | `grossAmount: Number(grossAmount)` hacia el motor; `new Decimal(s.amount)` |
| idem | 374-376 | Respuesta del alta: `Number(...)` (salida a JSON) |
| idem | 389-411 (`calculateParticipantFee`) | `Number(((base * pct)/100).toFixed(2))` (398, 407) |
| `infrastructure/features/dashboard/dashboard.service.ts` | 74, 79-98, 111-121, 126, 130-148 | KPIs: `reduce` con `Number(...)`, `Math.max(0, gross − othersTook)` |
| idem | 226-246 | Gráfico: `Number(...)` y `+=` por grupo |
| idem | 313 | Distribución por pagador: `Number(_sum.grossAmount)` (salida) |
| `application/features/settlements/queries/calculate-settlements-query.ts` | 89-90, 101, 110, 113-114, 121, 127-131 | `grossBase`/`payout` con `+=` en float; `payoutAmount` de la rama vieja **sin redondear**; `percent` con `Math.round` |
| `application/features/activity/queries/find-all-activities-query.ts` | 209-222 | `commission`, `netAmount`, `grossAmount` y `paidAmount` con `reduce`/`Number` |
| `application/features/activity/queries/find-activity-by-id-query.ts` | 339, 343, 346 | `Number(...)` (salida) |
| `application/features/patients/queries/get-patient-summary-query.ts` | 65, 71 | Deuda: `reduce` con `Number` (**extensión**: la spec no la nombra, pero es el mismo patrón; ver §2.5) |
| `infrastructure/features/patients/patients.service.ts` | 202 | `calcDebt`: `reduce` con `Number` (**extensión**) |

Fuera de alcance: el front calcula el precio del preset en float (`WorkItemForm.tsx:256-279`). Es una propuesta que
el backend valida con `IsMoney` y redondea al guardar. El "neto estimado 70%" del modal se elimina (§7).

### 2.2 Helper común: `backend/src/domain/seed-work/money.ts` (nuevo)
Es un módulo puro, sin Nest ni Prisma Client en ejecución: solo importa `Prisma` de `@prisma/client` para usar el tipo
y la clase `Decimal`. No suma ninguna dependencia nueva, porque `Prisma.Decimal` ya está en uso
(`activity.service.ts:195`).

```ts
export type Money = Prisma.Decimal;
export type MoneyInput = Prisma.Decimal | number | string | null | undefined;

export const ZERO: Money;
/** null/undefined -> 0. Un number tiene que ser finito (si no, InternalServerErrorException genérica). */
export function money(value: MoneyInput): Money;
/** 2 decimales, ROUND_HALF_UP (igual que Postgres al guardar numeric(10,2) con montos >= 0). */
export function roundMoney(value: MoneyInput): Money;
export function sumMoney(values: Iterable<MoneyInput>): Money;
/** round(base * pct / 100). */
export function percentOf(base: MoneyInput, pct: number | Money): Money;
/** max(0, value). */
export function nonNegative(value: Money): Money;
/** Igualdad al centavo (12500 == 12500.00 == 12500.001). */
export function sameMoney(a: MoneyInput, b: MoneyInput): boolean;
/** Reparto por porcentajes al centavo (§2.3). */
export function distributeByPercentages(total: MoneyInput, percentages: readonly number[]): Money[];
/** ÚNICA salida a number, solo para respuestas que ya devolvían number (criterio 2). */
export function toJsonNumber(value: MoneyInput): number;
```

- Los porcentajes (`Float` en `ProfessionalCategory.percentage` y `Payer.retentionPercentage`, `number` en el JSON) se
  convierten con `new Prisma.Decimal(pct)`. `decimal.js` toma la representación decimal más corta del `number`, así
  que `33.33` queda exactamente como 33.33.
- Redondeo: `ROUND_HALF_UP` a 2 decimales en todo el código. Hoy `toFixed` sobre binario a veces redondea hacia abajo
  (`1.005.toFixed(2) === '1.00'`); el cambio de centavos está aceptado (#17, decisión del PO).

### 2.3 Regla determinista de reparto (criterio 3) y tope (criterio 7)
Se aplica en `computeAmounts`, con el bruto `G` ya redondeado a 2 decimales y las definiciones en su orden guardado:

1. **Porcentajes (todos juntos).** `T = roundMoney(G × Σp / 100)`, el objetivo del grupo: si `Σp = 100`, `T = G`
   exacto. Para cada uno, el valor exacto es `eᵢ = G × pᵢ / 100` en `Decimal`, y el piso es
   `fᵢ = floor(eᵢ, 2 decimales)`. Los centavos que faltan, `k = (T − Σfᵢ) / 0.01`, van de a uno a los `k` de mayor
   resto `eᵢ − fᵢ`. **Desempate:** el que aparece antes en la definición. Resultado: `Σ = T` exacto, cada monto queda
   a menos de un centavo de su valor exacto y el cálculo es reproducible.
2. **Tope en orden.** Se recorren todas las definiciones en su orden guardado, con `asignado = 0`:
   - un `FIXED` vale `min(roundMoney(value), G − asignado)`, con mínimo 0;
   - un porcentaje vale `min(montoᵢ, G − asignado)`, con mínimo 0. Solo se activa si hay `FIXED` antes o si `Σp`
     pasa de 100 por la tolerancia de 0.01 del validador; nunca se asigna más que `G`.
3. **Resto.** Si `asignado < G`, se agrega `{ ORG, null, G − asignado, 'Remainder' }`, como hoy.
4. Si un monto acotado da 0, la fila se mantiene con 0, como hoy pasa con un porcentaje 0.

Ejemplos (son tests, §10):
- 100 en 3 partes iguales con `distributeByPercentages(100, [100/3…])`: 33.34 / 33.33 / 33.33.
- Regla 33.33 % × 3 sobre 100: 33.33 × 3 y `Remainder` 0.01. Es lo mismo que hoy después de guardar.
- 0.05 al 50/50: 0.03 / 0.02. Hoy da 0.03 + 0.03 = 0.06, más que el bruto.
- `FIXED` 0.1 + `FIXED` 0.2 sobre 0.30: suma 0.30 exacto, sin resto.
- `FIXED` 1500 sobre 1000: 1000. `FIXED` 600 + `FIXED` 600 sobre 1000: 600 + 400.
- `FIXED` 300 y después 100 % sobre 1000: 300 + 700. Hoy da 300 + 1000.

Los demás caminos del motor no son repartos de un total entre varios porcentajes, así que el complemento se calcula
exacto:
- **Retención:** `ret = percentOf(G, r)`, `pro = G − ret`.
- **Fallback CLINIC:** `pro = percentOf(G, c)`, `org = G − pro` (se agrega si es > 0).
- **Particular `SOLO_PRACTICE`:** `percentOf(G, proModePrivatePatientPct)`. Una sola fila, como hoy (no se agrega
  resto ORG, para no cambiar el resultado).
- **Sin regla:** `G` a ORG.

Los honorarios de los participantes son independientes entre sí: `percentOf(amountBase, pct)`.

### 2.4 Formato JSON (criterio 2): no cambia

| Endpoint | Montos hoy | Después |
|---|---|---|
| `GET dashboard/kpis`, `dashboard/chart`, `dashboard/payers` | `number` | `number` vía `toJsonNumber` |
| `GET settlements/calculate` | `number` (`grossBase`, `payout`, `calculationBase`, `payoutAmount`, `percent`) | `number` |
| `GET activity` (lista) | `number` (`grossAmount`, `paidAmount`, `commission`, `netAmount`) | `number`, más el booleano nuevo `isCollected` |
| `GET activity/:id` | `number` (`grossAmount`, `admissionValue`, `distributions[].amount`) | `number`, más `isCollected` |
| `POST activity` | `number` (entidad `WorkItem`) | `number` |
| `PUT activity/:id` | fila de Prisma: `Decimal` serializado como **string** | igual (se relee la fila con `findUnique`) |
| `GET v1/patients/:id/summary`, `…/debt` | `number` | `number` |
| `GET fee-rules` | `splits` crudo, tal como se guardó | igual (sin normalizar, ver §3.3) |

La diferencia visible queda dentro del formato: sumas que hoy dan `0.30000000000000004` pasan a `0.3`. La rama vieja
de liquidaciones, que hoy puede dar más de 2 decimales, queda redondeada al centavo.
**Pregunta 4 al PO (informativa):** `PUT /activity/:id` devuelve los montos como string y el resto de la API como
`number`. No se cambia en el 017.

### 2.5 Guardia del criterio 1: `backend/src/money-invariants.spec.ts` (nuevo)
Es un análisis estático con la API del compilador de TypeScript (`typescript` 5.9, el mismo enfoque de
`test/helpers/prisma-writes.ts` del 015). El analizador va en `test/helpers/money-ops.ts`.

- **`MONEY_FILES`:** los archivos de la tabla §2.1, más el módulo nuevo de recálculo si se separa. Se incluyen los dos
  de deuda de pacientes; si el PO prefiere limitarse a la lista de la spec, se sacan de la lista (pregunta 5).
- **Regla M1:** en esos archivos no hay llamadas a `Number(`, `parseFloat(`, `parseInt(`, `Math.*(` ni `.toFixed(`.
- **Regla M2:** no hay aritmética binaria (`+ - * /` ni `+= -= *= /=`) en la que un operando sea un identificador o
  una propiedad cuyo nombre coincida con
  `/amount|gross|net|fee|payout|total|commission|pending|cash|share|retention|base|pct|percent|allocated|took|debt|value/i`.
- **Lista blanca** `file::texto exacto -> justificación`, con la misma mecánica que `TX_ALLOWLIST` (cada entrada tiene
  que seguir existiendo y justificarse). Entradas previstas:
  - la paginación `Math.ceil(total / limit)` de `find-all-activities-query.ts`;
  - `Number(limit)` de `patients.service.ts:137`.

  El `100 - categoryPct` de la etiqueta se reescribe con `Decimal` y no entra en la lista.
- **Control contra un detector ciego:** un snippet sintético con `sum + Number(x.amount)` tiene que dar hallazgos M1 y
  M2. El archivo real `fee-resolution.service.ts` tiene que analizarse sin error y con al menos una llamada al helper.

Límites conocidos: no usa el type checker, así que una variable de dinero con un nombre fuera del patrón no se ve. Se
compensa con los tests de §10 (montos exactos y tipos de la respuesta).

## 3. Forma única de `splits` (#40)

### 3.1 Dónde se guardan hoy
Se guardan en la columna JSON `FeeRule.splits` (`schema.prisma:171`). Se aceptan dos formas por elemento
(`application/features/fee-engine/fee-rule-splits.ts`):
- **UI:** `{ role, percentage, beneficiaryType: 'PROFESSIONAL'|'ORGANIZATION'|'ORG' }`. La escribe
  `PayerRulesManager` (`:99-100`, `:148-149`).
- **Motor:** `{ beneficiary: 'ORG'|'PROFESSIONAL', type: 'PERCENTAGE'|'FIXED', value, roleLabel? }`. La lee
  `FeeResolutionService` con un cast (`:220`), sin normalizar.

Relevamiento en la base local: **0 reglas** (§1.1). Ninguna en la forma vieja, así que no hace falta migrar datos.
Otras instalaciones podrían tener reglas guardadas desde `PayerRulesManager`; las cubre la compatibilidad de lectura.

### 3.2 Forma elegida: la del motor
`{ beneficiary: 'ORG' | 'PROFESSIONAL', type: 'PERCENTAGE' | 'FIXED', value: number, roleLabel?: string }`.

- **Por qué:** es la única que expresa `FIXED` y es la que ya usa el motor. La de la UI es un subconjunto (solo
  porcentajes).
- **Semántica de `value`:** en `PERCENTAGE`, de 0 a 100 sobre el bruto. En `FIXED`, el monto **en pesos** con hasta
  2 decimales. El comentario actual dice "Fixed cents" y está mal: el validador acota a `MAX_MONEY_AMOUNT` en pesos y el
  motor lo usa como monto. Se corrige el comentario.
- **Descartada:** usar la forma de la UI como única. Perdería `FIXED`, que pide el criterio 7.
- **Descartada:** migrar los datos. Hay 0 reglas viejas en la base local y la normalización al leer cubre a las
  demás instalaciones sin tocar datos (criterio 4).

### 3.3 Implementación
- **Nuevo `backend/src/domain/features/fee-engine/split-definition.ts`.** Saca de `fee-resolution.service.ts` el enum
  `SplitType` y el tipo `SplitDefinition` (este último con `value: number`), y define:
  - `normalizeSplitDefinitions(json: unknown): SplitDefinition[]`. Pasa un elemento en la forma vieja a la nueva con
    `beneficiary = beneficiaryType === 'PROFESSIONAL' ? 'PROFESSIONAL' : 'ORG'`, `type = 'PERCENTAGE'`,
    `value = percentage` y `roleLabel = role`. Deja igual un elemento que ya está en la forma del motor. Ante un JSON
    que no es ninguna de las dos formas, lanza `InternalServerErrorException` genérica, igual que hoy pasa con una
    organización inexistente en el motor (500 controlado, sin datos en el mensaje). Hoy ese caso produce `NaN` y
    termina en un 500 de Prisma.
  - `fee-rule-splits.ts` y `fee-resolution.service.ts` lo importan desde ahí.
- **Escritura (`validateFeeRuleSplits`).** Acepta **solo** la forma del motor y rechaza la de la UI con el mismo 400
  `bad-request` de hoy. Agrega que un `FIXED` tenga como máximo 2 decimales (ningún cliente manda `FIXED` hoy). Los
  demás topes no cambian: 20 elementos, etiqueta de 100 caracteres, `Σ PERCENTAGE ≤ 100 + 0.01`.
- **Motor.** `calculateSplits` usa `normalizeSplitDefinitions(bestRule.splits)` en lugar del cast. `computeAmounts`
  sigue §2.3.
- **`GET /fee-rules` no cambia**: devuelve el JSON tal como está guardado. El front lee las dos formas con un helper
  (§7) y, cuando el usuario guarda, la regla queda en la forma nueva. No se cambia ningún contrato de respuesta.
- **No se toca** la coincidencia de `professionalCategory: 'all'` (§1.2.2). Se mantiene "mismo resultado"
  (criterio 6). Ver la pregunta 1.

### 3.4 Tests de regresión (criterio 6)
El primer paso del plan es escribir `fee-resolution.service.spec.ts` como una tabla de casos **contra el código
actual**, para fijar lo que da hoy. Después se refactoriza. Las filas cuyo resultado cambia llevan la marca
"cambia por criterio 3", "cambia por criterio 7" o "hoy da NaN". Casos:
- regla 70/30 (forma del motor);
- regla 70 % con resto;
- 33.33 × 3;
- `FIXED` dentro del bruto;
- retención 10 % sobre 1234.56;
- `SOLO_PRACTICE` sin retención (100 % al profesional);
- CLINIC con categoría 60 %;
- sin regla ni categoría (100 % ORG);
- prioridad por pesos (ADMISION / CLINIC / SOLO) y desempate por `validFrom`;
- regla en la forma vieja 70/30, que tiene que dar lo mismo que la nueva 70/30 (hoy da `NaN`).

El alta también se cubre en `activity.service.spec.ts`: el reparto particular con 100 % y con 70 %, y los honorarios
de participantes con estrategia `FIXED` y `CATEGORY`.

## 4. Edición de monto y pagador (#45)

### 4.1 "Cobrada": una sola definición
**Nuevo `backend/src/domain/features/activity/activity-collected.ts`:**
```ts
export const isCollected = (w: { paymentStatus: PaymentStatus; paymentDate: Date | null }) =>
  w.paymentStatus === PaymentStatus.PAID && w.paymentDate !== null;
/** Fragmento de where: la atención NO está cobrada (lo que acepta una escritura condicional). */
export const NOT_COLLECTED_WHERE: Prisma.WorkItemWhereInput = {
  NOT: { paymentStatus: PaymentStatus.PAID, paymentDate: { not: null } },
};
```
- `delete-activity-command.ts` pasa a usar las dos (es un refactor sin cambio de comportamiento: mismo 403 y mismo
  mensaje).
- **Cómo llega al front:** un campo calculado `isCollected: boolean` en cada ítem de `GET /activity`
  (`find-all-activities-query.ts`) y en `GET /activity/:id`. Se descarta repetir la regla en el front: serían dos
  definiciones. El front tiene un único lector, `isActivityCollected(item)` en `src/lib/activity-permissions.ts`, que
  devuelve `item.isCollected === true`. Lo usan los dos formularios de edición y la salvaguarda de borrado de
  `columns.tsx`, que deja de calcular `PAID && paymentDate` por su cuenta. El `status === PAID` de los botones
  "Marcar Pagado / Pendiente" sigue igual: muestra el estado de pago, no el bloqueo.
- `PARTIAL` cuenta como no cobrada y `PAID` sin fecha también (pregunta 2).

### 4.2 Contrato de `PUT /activity/:id`
Al `UpdateActivityCommand` (`update-activity-command.ts`) se le suman dos campos:
```ts
@ApiPropertyOptional() @IsOptionalNotNull() @IsMoney()
grossAmount?: number;           // ausente = sin cambio; null = 400

@ApiPropertyOptional({ nullable: true }) @IsNullableEntityId()
payerId?: string | null;        // ausente = sin cambio; null = pagador particular de la organización; '' = 400
```
- **Validador nuevo `IsNullableEntityId()`** en `dto-validators.ts`: `ValidateIf(v => v !== undefined && v !== null)`
  más `IsUUID('loose')`. Es necesario porque `IsOptionalEntityId` toma `''` como ausente: en el alta eso significa
  "pagador por defecto", pero en la edición un `''` (el valor falso de M2) tiene que ser un 400, no un cambio de
  pagador. Lleva su test en `dto-validators.spec.ts`.
- `null` como "Particular" repite la semántica del alta (sin pagador = pagador por defecto de la organización) y evita
  que el front tenga que adivinar qué `Payer` es el "Particular". Ver §4.6.
- `UpdateActivityDto` (`Dtos/update-activity.dto.ts`) no se usa en ningún lado: se borra.
- `security-invariants.spec.ts` → `ID_FIELDS['UpdateActivityCommand.payerId'] = 'verified'`.

### 4.3 Flujo
La lógica pasa a `ActivityService.updateActivity(input, scope)`. El handler queda fino, como el del alta: le pasa
`requireOrgScope(ctx)` y los campos del comando. Pasos:

1. `id = requireId(...)`. Se lee la atención con `findFirst({ id, ...inScope(scope) })` y se seleccionan
   `organizationId`, `createdByUserId`, `professional.userId`, `paymentStatus`, `paymentDate`, `grossAmount`,
   `amountCard`, `payerId`, `professionalId`, `activityTypeId`, `serviceType` y `organization { type, settings }`.
   Si no está: **404 genérico**.
2. `canModifyActivity(existing, scope, 'edit')`, igual que hoy (permisos del 007: ADMIN, MEMBER y el profesional
   sobre lo suyo). Si no corresponde: **403**.
3. **Cambios financieros**, calculados antes de escribir:
   - `newGross = roundMoney(command.grossAmount)` si vino. `grossChanged = !sameMoney(newGross, existing.grossAmount)`.
   - Pagador:
     - si viene un UUID: `foundOr404(payer.findFirst({ id, ...inOrg(existing.organizationId) }))`. Un pagador ajeno
       y uno inexistente dan el **mismo 404 genérico**. El pagador tiene que ser de la organización **de la
       atención**, no solo del scope;
     - si viene `null`: se busca el pagador por defecto de esa organización (`name = privatePayerName`), con el mismo
       criterio que el alta. Si no existe, se marca para crearlo dentro de la transacción.
     - `payerChanged = targetPayerId !== existing.payerId`. Mandar los mismos valores **no es un cambio** (criterio 9).
   - Orden de los errores: 404 de la atención → 403 → 404 del pagador → 409. Un id ajeno nunca se distingue por el
     código.
4. Campos simples (`date`, `paymentMethod`, `paymentDate`, `attendance`, `paymentStatus`): el mismo `data` de hoy.
5. **Sin cambio financiero:** se ejecuta lo de hoy, `return this.prisma.workItem.update({ where: { id }, data })`. Una
   sola escritura, el mismo comportamiento y el mismo formato. Las acciones rápidas (cobro, asistencia, "Marcar
   Pagado") no cambian, ni siquiera sobre una atención cobrada.
6. **Con cambio financiero:**
   - Atajo: si `isCollected(existing)`, **409** sin abrir la transacción.
   - Si no, `return this.prisma.$transaction(async (tx) => { … })`:
     1. Si hace falta, `tx.payer.create` del pagador por defecto, con el mismo helper que el alta (§4.7).
     2. **Escritura condicional:** `const { count } = await tx.workItem.updateMany({ where: { id, ...NOT_COLLECTED_WHERE }, data: { ...data, grossAmount: newGross, amountBase, payerId } })`.
        Si `count === 0`, se relee `tx.workItem.findFirst({ where: { id, ...inScope(scope) }, select: { id: true } })`:
        si no existe, `resourceNotFound()`; si existe, `activityAlreadyCollected()`. El `throw` hace el rollback, así
        que se deshace también el pagador creado.
     3. Honorarios de los participantes: `tx.workItemParticipant.findMany({ where: { workItemId: id } })`. Para cada
        uno, con los `roles` del `ActivityType` de la atención (si tiene), se calcula el honorario con el mismo
        `calculateParticipantFee(…, tx)` del alta y se escribe `tx.workItemParticipant.update({ where: { id: p.id }, data: { feeAmount } })`.
        Los participantes no cambian (ni quiénes son ni su rol), así que se conservan sus ids y `createdAt`. Una
        atención vieja sin participantes no recibe ninguno nuevo.
     4. Splits: `tx.workItemSplit.deleteMany({ where: { workItemId: id } })` y después `createMany` con el resultado de
        `computeDistribution(tx, …)` (§4.7).
     5. `return tx.workItem.findUnique({ where: { id } })`: la misma forma que devuelve hoy `workItem.update`.
7. Prisma 5.22 acepta `NOT` compuesto en el `where` de `updateMany`. El 015 lo verificó en Postgres real con `delete`;
   el tester lo vuelve a probar con `updateMany` (§11).

### 4.4 Carrera con el cobro (criterio 9)
La condición está en la propia sentencia `UPDATE`, que bloquea la fila hasta el commit:
- **Si el cobro confirmó antes:** el `UPDATE` de la edición vuelve a evaluar el `where` sobre la versión confirmada
  (READ COMMITTED). Da `count = 0` y la respuesta es 409, sin cambios.
- **Si la edición tomó la fila antes:** el cobro (`workItem.update`) espera al commit y se aplica después. El estado
  final queda coherente: se corrigió el monto y después se cobró la atención.
- Los recálculos (lecturas de reglas, del pagador y de la categoría, y las escrituras de participantes y splits)
  ocurren **después** del bloqueo y dentro de la misma transacción.
- **Dos ediciones simultáneas del monto:** la segunda espera y su recálculo reemplaza por completo al de la primera.
  Gana la última y no quedan mezclas.
- **Borrado concurrente:** `count = 0`, se relee, no existe y la respuesta es 404.

### 4.5 El mismo pedido cobra la atención y cambia el monto
Se evalúa **contra lo guardado**:
- Si la atención guardada **no** está cobrada, el pedido se aplica entero: monto y pagador nuevos, recálculo y
  `PAID` + `paymentDate` en la misma sentencia. Es "corregir y cobrar en un paso", lo que hace `WorkItemForm` en
  edición.
- Si la atención guardada **está** cobrada y el pedido la pasa a pendiente y además cambia el monto: 409. Primero se
  marca como pendiente y después se corrige.

### 4.6 "Particular" frente a "sin pagador"
- **En la base, "sin pagador" no existe** (`payerId NOT NULL`, §1.2.1). "Particular" es un `Payer` real, con id, y se
  muestra con su nombre.
- **En la API:** el listado devuelve siempre `payerId`. `payerName` es el nombre, o `'Unknown'` solo si el nombre está
  vacío; esto no cambia.
- **En el front:** `data-schema.ts` deja de producir `'—'`. Conserva `payerName: null` si viene vacío o `'Unknown'`,
  y la presentación muestra el texto `Sin pagador`. Es un caso defensivo que con datos válidos no aparece.
- **En el `PUT`:** `payerId: null` = "pasar al pagador particular de la organización". Lo usa la casilla "Paciente
  Particular" de `WorkItemForm` en modo profesional. El `RetroactiveModal` no lo necesita: el "Particular" aparece en
  `getPayers` con su id.
- **Límite conocido:** para marcar la casilla al abrir la edición, el front compara el nombre del pagador con
  `PAYER_PARTICULAR`. Si una organización cambió `privatePayerName`, la casilla puede quedar desmarcada y el select
  muestra ese pagador por su nombre. No es un error: se ve el dato real.

### 4.7 Reutilizar el cálculo del alta
Se extraen de `createActivity` métodos privados de `ActivityService` y los usan el alta y la edición:
- `findDefaultPayer(db, orgId, settings)` y `createDefaultPayer(tx, orgId, settings)`: las líneas 184-238 de hoy.
- `computeParticipantFees(tx, participants, roleConfigs, amountBase): Promise<Money[]>`, sobre
  `calculateParticipantFee`, que pasa a `Money`.
- `computeDistribution(tx, { orgId, orgType, settings, payer, mainProfessionalId, serviceType, eventRole, grossAmount, privatePractice })`:
  la rama del reparto particular (líneas 327-343) o `feeEngine.calculateSplits(context, tx)`.

El alta pasa `privatePractice = mode === 'pro' && isPrivate`, como hoy. La edición pasa `privatePractice = isPrivate`
(`SOLO_PRACTICE` y el pagador particular), ver §4.8. El resultado del alta no cambia, salvo centavos; lo cubre el test
de regresión de §3.4.

**`amountBase` / `amountCard` al editar el bruto:**
- se conserva `amountCard` y `amountBase = newGross − amountCard`;
- si queda negativo, **400** `bad-request` "El monto no puede ser menor que el recargo por tarjeta de la atención.";
- en la base local todas las atenciones tienen `amountCard = 0`, así que `amountBase = newGross`.

Así se respeta la regla del alta (`gross = base + card`) y los honorarios de los participantes siguen calculándose
sobre la base. Se descarta pasar `amountCard` a 0, porque perdería el recargo configurado en el tipo de actividad.

### 4.8 `eventRole` y modo en el recálculo
- **`eventRole`:** el alta usa `data.role ?? 'TITULAR'` y el front nunca manda `role`. El recálculo usa `'TITULAR'`
  (constante compartida con el alta). Residual: una atención creada por API con un `role` explícito, en una
  organización con reglas condicionadas por rol, se recalcula como `TITULAR`. En la base local hay 0 reglas.
- **Modo:** `PUT /activity/:id` no lleva `@UsesViewMode()` y no se le agrega. Agregarlo cambiaría el contrato de las
  acciones rápidas, que pasarían a depender de `x-mode`, con 400/403 posibles. El modo solo cambia el resultado en una
  `SOLO_PRACTICE` con el pagador particular. Ahí la edición usa siempre el reparto particular, que es lo que hace el
  alta en modo pro, el único que usa el front en una práctica individual. Residual documentado: una atención de
  `SOLO_PRACTICE` cargada en modo org con "Particular" se recalcula con el reparto particular. Con los valores por
  defecto (100 %, sin reglas, sin retención) el monto es el mismo y solo cambia la etiqueta del split.

### 4.9 Regla de 30 días
Confirmado: el backend no la necesita (§1.2.5). Se elimina del `RetroactiveModal`. El único bloqueo pasa a ser
"cobrada".

### 4.10 Errores nuevos
- `API_ERROR_CODE` (`error-contract.ts`) suma `ACTIVITY_ALREADY_COLLECTED: 'activity-already-collected'`, que cumple
  `CODE_PATTERN`.
- El 409 sale de un helper local `activityAlreadyCollected()`, que devuelve `new ConflictException({ code, message })`.
- `message`: `Esta atención se cobró mientras la editabas. El monto y el pagador ya no se pueden modificar y no se guardó ningún cambio.`
  Es el texto exacto de UX §4. Se usa también en el atajo, cuando la atención ya estaba cobrada al leerla.

## 5. Borrado de pagador (#75)

### 5.1 Qué pasa hoy
- **Con fee rules:** `payer.delete` funciona y la FK `FeeRule_payerId_fkey ON DELETE SET NULL` deja las reglas
  **globales**. Pasan a aplicarse a todos los pagadores.
- **Con atenciones:** la FK `WorkItem_payerId_fkey ON DELETE RESTRICT` hace fallar el borrado con P2003. Hoy eso es un
  **500 `unhandled-exception`** y no se borra nada. En la base local hay 1 pagador en esta situación.
- **Sin vínculos:** se borra.

### 5.2 Diseño: restricción de la base más verificación previa
- **Schema:** `payer Payer? @relation(fields: [payerId], references: [id], onDelete: Restrict)` en `FeeRule`. Con
  esto la base rechaza el borrado si existe **cualquier** regla, incluso una creada en paralelo después de la
  verificación. La carrera queda cerrada sin SQL crudo ni transacción.
- **Por qué no una transacción o un `deleteMany` condicional:** en READ COMMITTED, una regla que se confirma justo
  antes del `DELETE` no la ve la subconsulta, y el `SET NULL` la deja global en silencio. Es justo el daño que #75
  quiere evitar. Tomar un bloqueo con `SELECT … FOR UPDATE` requiere `$queryRaw`, el patrón que el 015 descartó.
- **Handler** (`DeletePayerCommandHandler`), una sola escritura:
  1. `loadPayerForWrite`, como hoy: 404 si no existe o es ajeno; si no es ADMIN ni el dueño, 403.
  2. Si `feeRule.count({ where: { payerId: id } }) > 0`: **409** `payer-has-fee-rules`, con el mensaje
     `No se puede eliminar el pagador porque tiene reglas de honorarios asociadas.`
  3. `try { return await this.prisma.payer.delete({ where: { id } }); }`
     `catch`:
     - P2025: 404;
     - P2003: se vuelve a contar. Con reglas, 409 `payer-has-fee-rules`. Con atenciones, se sigue la respuesta a la
       pregunta 3. Si no hay ninguno de los dos, se relanza;
     - cualquier otro error, se relanza.
- **No se borran ni se modifican las reglas.** Un pagador sin reglas ni atenciones se borra igual que hoy.
- `API_ERROR_CODE` suma `PAYER_HAS_FEE_RULES: 'payer-has-fee-rules'`. Si el PO lo aprueba (pregunta 3), suma también
  `PAYER_HAS_ACTIVITIES: 'payer-has-activities'`.

### 5.3 Pagador con atenciones (lo informa el arquitecto)
Hoy responde 500 y no borra nada. El 017 puede dejarlo así o convertirlo en un 409 con su `code` y el mensaje
`No se puede eliminar el pagador porque tiene atenciones asociadas.` Es un cambio visible (500 → 409), así que se
consulta: **pregunta 3**, recomendación 409. Mientras no haya respuesta, la implementación deja el 500 como está:
relanza el P2003 de atenciones.

## 6. Staff (#76)

### 6.1 Regla 2 extendida
En `DeleteStaffCommandHandler` (`staff-commands.ts:209-269`) la lectura inicial pasa a incluir
`workItems: { select: { id: true }, take: 1 }`, `participants: { select: { id: true }, take: 1 }` y
`splits: { select: { id: true }, take: 1 }`, y se define
`hasLinks = workItems.length + participants.length + splits.length > 0`.
- **Con usuario (regla 3):** sin cambios.
- **Sin usuario y con vínculos:** baja lógica, `return this.prisma.professional.update({ where: { id }, data: { deletedAt: new Date() } })`.
- **Sin usuario y sin vínculos (regla 1):** borrado físico, dentro de un `try`.

### 6.2 Carrera
- Si entre la verificación y el `delete` se confirma una atención o una participación nueva, la FK `RESTRICT`
  (`WorkItem.professionalId` y `WorkItemParticipant.professionalId`) hace fallar el `delete` con **P2003**. El `catch`
  hace la **baja lógica**: `return await this.prisma.professional.update(…)`. Si esa actualización da P2025 (otro
  pedido lo borró en el medio), la respuesta es 404. Cualquier otro error se relanza.
- **No hace falta el 409 `staff-changed-retry`:** el resultado es el mismo que si el vínculo hubiera existido antes.
  Para el usuario no cambia nada (UX §6).
- **Splits:** la FK de `WorkItemSplit.beneficiaryId` es `SET NULL`, así que no da error. Pero cada split nuevo con
  beneficiario X se crea en la misma transacción que una atención con `professionalId = X` (el motor siempre usa al
  profesional principal) o sobre una atención que ya lo tiene. Esa atención activa la FK `RESTRICT`, y el borrado
  físico no puede dejar un split huérfano nuevo.
- **Regla A del 015:** las escrituras quedan en ramas excluyentes y todas son terminales (`return` o
  `return await`), así que no hay infracción.
- **Fuera de alcance:** un `Payer.professionalId` con `SET NULL`. Un staff sin usuario no puede ser dueño de un
  pagador, porque `CreatePayer` usa el `Professional` del usuario.

### 6.3 Nombre en el historial
Las consultas que muestran participantes o beneficiarios ya incluyen al profesional **sin** filtrar por `deletedAt`:
- `find-all-activities-query.ts:178` (`professional: true`);
- `find-activity-by-id-query.ts:279`;
- `calculate-settlements-query.ts:52-61` (`participants.professional`).

No cambian. Las listas para cargar o elegir (staff, selects de alta) siguen filtrando `deletedAt: null`. Un test lo
cubre: un staff dado de baja sigue apareciendo por nombre en el listado de atenciones y en las liquidaciones.

## 7. Frontend, archivo por archivo

| Archivo | Cambios |
|---|---|
| `src/lib/request-bodies.ts` | `ACTIVITY_UPDATE_FIELDS` suma `grossAmount` y `payerId`. `buildUpdateActivityBody` deja `grossAmount` solo si es un número finito (`withFiniteNumbers`) y quita `payerId` si es `undefined` o `''`. `null` se conserva y significa "Particular". Builder nuevo `buildPayerFeeRuleSplits(percent)`, que arma `[{ beneficiary: 'PROFESSIONAL', type: 'PERCENTAGE', value: p, roleLabel }, { beneficiary: 'ORG', type: 'PERCENTAGE', value: 100 − p, roleLabel }]` con etiquetas de `constants.ts`. |
| `src/lib/activity-edit.ts` (nuevo, puro) | `financialChanges(original, edited)`: devuelve `{ grossAmount?, payerId? }` solo con lo que cambió. El monto se compara al centavo (`Math.round(x*100)`, solo presentación) y el pagador por id. `validateAmountInput(text)`: los tres mensajes de UX §2.1. `professionalPercentOf(splits)`: lee la forma nueva (`beneficiary PROFESSIONAL` + `PERCENTAGE`) y la vieja (`role/percentage`). Todo con tests `node --test`. |
| `src/lib/activity-permissions.ts` | `isActivityCollected(item)`, que devuelve `item.isCollected === true`. |
| `src/lib/constants.ts` | `API_ERROR_CODE` suma `ACTIVITY_ALREADY_COLLECTED`, `PAYER_HAS_FEE_RULES` (y `PAYER_HAS_ACTIVITIES` si se aprueba). `API_ERROR_MESSAGES` suma `activityAlreadyCollected` y `payerHasFeeRules`, con el mismo texto que el backend. Textos de UI centralizados (UX §7): recálculo, bloqueo, botones, `Sin pagador`, validación, pagador. Etiquetas de los splits de `PayerRulesManager`. |
| `src/lib/api-errors.ts` | `messageFromErrorBody`: si el 4xx no trae `errors[0].message` pero trae un `code` conocido, usa el texto de respaldo de ese `code` antes del genérico por status. Test en `api-errors.test.mts`. |
| `src/services/data.ts` | `deletePayer(slug, id, ctx)`, que llama a `DELETE /pro/payers/:id` con el patrón de `deleteStaff` (lanza `toApiError`). Se suma a la lista "las escrituras no tragan el error" de `api-routes.test.mts`. `updateWorkItem` no cambia: ya pasa por el builder. |
| `components/domain/workload/data-schema.ts` | `WorkItem` suma `payerId: string \| null` e `isCollected: boolean`. `payerName: string \| null`: `null` si viene vacío o `'Unknown'`, nunca `'—'`. `ApiActivity` suma `payerId` e `isCollected`. Se actualiza `data-schema.test.mts`. |
| `components/domain/workload/columns.tsx` | La celda del pagador muestra `payerName ?? 'Sin pagador'` (texto real, `text-muted-foreground`). `isRestrictedForDelete = isActivityCollected(payment)`. El `onConfirm` del modal pasa a `onSave(changes)`: llama a `updateWorkItem(orgSlug, id, changes)` y **lanza** el error al modal, sin toast de éxito propio. Al terminar con éxito, `router.refresh()`. Se quita el comentario "el backend no persiste". |
| `components/domain/workload/RetroactiveModal.tsx` | Se reescribe según UX §2-§4. Carga los pagadores reales con `getPayers(orgSlug, 1, 100)`: `value` = id, etiqueta = nombre. Si el pagador guardado no está en la lista, aparece como opción deshabilitada con su nombre. Sin opciones fijas, sin `differenceInDays` ni el bloqueo de 30 días, sin `BadgeLock` ni el 70 %. El bloqueo es `isActivityCollected(item)` o un 409 recibido; en ese caso, `Input readOnly` para los dos campos, con `aria-readonly` y `aria-describedby`. Aviso de recálculo y botón `Guardar`/`Guardar y recalcular`. Estado "Guardando…": el diálogo no se cierra con Esc ni con clic afuera. Llama a `onSave(financialChanges(...))` y **solo después** cierra y muestra el toast de éxito. Ante el error `ACTIVITY_ALREADY_COLLECTED`: alert con foco, bloqueo local inmediato, vuelve a los valores guardados y hace `router.refresh()`. Otros errores: alert inline con `errorMessageOf`. Un 403 lo maneja `isHandledApiError`. Labels con `htmlFor`. |
| `components/domain/workload/form/WorkItemForm.tsx` | Solo en edición (`initialData`):<br>(a) **No reescribe el monto al abrir.** El efecto de precio del preset (líneas 253-279) corre solo si el usuario cambia actividad, tipo, medio de pago u horas (bandera `pricingTouched` que ponen esos handlers).<br>(b) **No reinicia los participantes:** se quita `participantsByRole: {}` del efecto de carga. En edición, la sección de roles no se valida ni se envía, porque el `PUT` no acepta participantes y el recálculo conserva los que hay. Hoy esa validación bloquea la edición de tipos con roles obligatorios: `missingRequired` siempre da algo porque el mapa llega vacío. Se oculta en edición, ver la pregunta 6.<br>(c) **`isPrivate` sale del dato guardado:** si `payerId` es una opción de `payersList`, la casilla queda desmarcada con ese id; si `payerName === PAYER_PARTICULAR`, marcada; en cualquier otro caso, desmarcada y el select muestra el pagador guardado como opción deshabilitada.<br>(d) **Monto y pagador** editables solo si `!isActivityCollected(initialData)`. En edición se ignora el bloqueo por reglas de preset (`enforceOrgRules && (presetId \|\| baseValue)`): la decisión del usuario es "editable mientras no esté cobrada". Si está cobrada: solo lectura con el texto de UX §2.2.<br>(e) **Envío en edición:** `onSubmit([{ date, paymentStatus, paymentMethod, paymentDate, attendance, ...financialChanges(original, edited) }])`, sin el `baseItem` del alta. Con la casilla "Particular" marcada y un pagador anterior distinto, va `payerId: null`.<br>(f) Aviso de recálculo, botón y estados (UX §2.1, §2.3). Ante el 409, alert con foco y bloqueo sin perder los demás campos: la inicialización depende de `initialData?.id` y no de la identidad del objeto. En modo org el formulario no tiene selector de pagador y no se agrega (solo cambia el monto). |
| `components/domain/pro/atenciones/AtencionesTable.tsx`, `org/admisiones/AdmisionesTable.tsx` | El mapeo de la fila suma `payerId`, `payerName` e `isCollected` (hoy faltan, así que `initialData.payerId` llega indefinido). Ante un 409 se recargan los datos, como ya hacen. |
| `components/domain/pro/settings/PayerRulesManager.tsx` | Lee el porcentaje con `professionalPercentOf(rule.splits)`, que acepta las dos formas, y escribe con `buildPayerFeeRuleSplits`. El usuario ve y guarda el mismo porcentaje (UX §11.6). Cada tarjeta de pagador propio tiene un botón `Trash2` con `aria-label="Eliminar pagador {nombre}"`, visible según la pregunta 7. Usa `ConfirmDialog`: en modo destructivo si el pagador no tiene reglas en `fetchedRules`, o en modo informativo ("Entendido") si las tiene. Llama a `deletePayer`. Con éxito: toast `Pagador eliminado` y `fetchData()`. Con 409 u otro error: `toast.error(errorMessageOf(e, …))` y `fetchData()`. |
| `backend/test/fixtures/frontend-request-bodies.json` | Cambios:<br>- "formulario completo": `input` = el payload de edición nuevo, sin `payerId` ni `grossAmount` si no cambiaron;<br>- el caso "RetroactiveModal … (body vacío)" pasa a enviar `{ grossAmount, payerId }` con ids de la organización y espera 200 sobre una atención no cobrada;<br>- casos nuevos: "monto igual al guardado sobre una atención cobrada → 200 sin cambios", "cambio de monto sobre una atención cobrada → 409", "`payerId: null` (Particular)";<br>- `createFeeRule` en la forma nueva. |

No cambia: `org/profesionales/page.tsx` mantiene el diálogo y el toast del borrado de staff (UX §6).

## 8. Schema y migración (regla 6)
- **Cambio único:** `FeeRule.payer` pasa a `onDelete: Restrict`.
- **Migración nueva** `prisma/migrations/<AAAAMMDDHHMMSS>_fee_rule_payer_restrict/migration.sql`. Se genera **sin
  `migrate dev`**, con `prisma migrate diff --from-migrations … --to-schema-datamodel … --shadow-database-url <descartable>`
  contra un Postgres **descartable** (procedimiento de `COMANDOS.md` §2, "Generar una migración sin migrate dev"). El
  SQL esperado es un `DROP CONSTRAINT "FeeRule_payerId_fkey"` seguido de `ADD CONSTRAINT … ON DELETE RESTRICT ON UPDATE CASCADE`.
  No se edita a mano, va en UTF-8 sin BOM y con LF. Después: `npx prisma generate` y `.\dev.ps1 -CheckMigrations` en 0.
- **Impacto en datos:** ninguno. No se reescribe ninguna fila: Postgres valida las filas existentes al recrear la FK,
  y una FK sobre datos que ya la cumplían no falla. En la base local hay 0 reglas.
- **Aplicación en la base del usuario:** la hace `migrate deploy` del arranque normal (`.\dev.ps1`). Nunca
  `migrate dev`, `reset` ni `db push`. Antes, el tester la aplica en la copia descartable (§11).
- La spec decía "en principio no": esta es la mención que pide la regla 6. El PO debe registrarla en `00-estado.md`.

## 9. Manejo de errores (contrato del 013)

| Caso | Status | `code` | Mensaje |
|---|---|---|---|
| Atención inexistente o ajena | 404 | `not-found` | genérico |
| Sin permiso sobre la atención (007) | 403 | `forbidden` | genérico |
| `payerId` inexistente o de otra organización | 404 | `not-found` | genérico e idéntico |
| `grossAmount` inválido, `payerId: ''` o no UUID, clave de más | 400 | `validation-failed` | sin valores del cliente |
| `grossAmount < amountCard` | 400 | `bad-request` | "El monto no puede ser menor que el recargo por tarjeta de la atención." |
| Monto o pagador sobre una atención cobrada, o cobrada en el medio | 409 | `activity-already-collected` | texto de UX §4 |
| Pagador con fee rules | 409 | `payer-has-fee-rules` | "No se puede eliminar el pagador porque tiene reglas de honorarios asociadas." |
| Pagador con atenciones | 500 hoy; 409 `payer-has-activities` si se aprueba (pregunta 3) | | |
| Staff con vínculo nuevo durante el borrado | 200 (baja lógica) | | |
| `splits` guardados en una forma inválida | 500 | `unhandled-exception` | genérico, con `X-Error-Id` |
| `splits` en la forma vieja en `POST fee-rules` | 400 | `bad-request` | "La distribución de honorarios no es válida." (el de hoy) |

Todas las excepciones nuevas son de Nest, con `{ code, message }` en español. No hay `throw new Error`.

## 10. Invariantes y plan de tests por criterio

**Invariantes**
- `test/org-isolation.spec.ts`:
  - en el caso `'put /api/activity/:id'` de `ID_ROUTE_CASES`, un ataque nuevo `{ path: /activity/<wiMember>, body: { payerId: I.payerB }, foreign: [I.payerB] }`. Compara el 404 con el de un UUID al azar;
  - tests de ids referenciados para el `PUT`: `payerId` de B → 404 sin escrituras; de A → 200;
  - `'delete /api/pro/payers/:id'` sigue igual, más un test de 409 con reglas sobre el pagador propio.
- `src/security-invariants.spec.ts`: `UpdateActivityCommand.payerId: 'verified'`.
- `test/request-dto-invariants.spec.ts`: sin entradas nuevas. Los campos llevan decoradores de class-validator y
  `IsNullableEntityId` registra metadatos.
- `src/transactions-invariants.spec.ts`: `ActivityService.updateActivity` sin infracciones A/B/C. La lista blanca
  sigue vacía.
- `src/money-invariants.spec.ts` (nuevo, §2.5).
- `test/helpers/fake-prisma.ts`:
  - relaciones nuevas: `professional.participants` (`workItemParticipant.professionalId`), `professional.splits`
    (`workItemSplit.beneficiaryId`) y `payer.feeRules`;
  - `updateMany` tiene que devolver `{ count }` y respetar `NOT`;
  - el P2003 se inyecta con `failOn`.

**Tests por criterio** (backend con Jest y `fake-prisma`; frontend con `node --test`)

| Criterio | Tests |
|---|---|
| 1 | `money-invariants.spec.ts`. `money.spec.ts`: `money`, `roundMoney` (HALF_UP, 1.005 → 1.01), `sumMoney` (0.1 + 0.2 = 0.3), `percentOf`, `toJsonNumber` y `number` no finito → error |
| 2 | Specs de dashboard, liquidaciones, `find-all`/`find-by-id` y deuda: `typeof === 'number'` en cada monto y valores exactos (`0.3`, no `0.30000000000000004`). El `PUT` sin cambio financiero devuelve la misma forma (fila de Prisma) |
| 3 | `distributeByPercentages`: 100 en 3, 0.05 al 50/50, 2 decimales (1234.56 al 33.33/33.33/33.34), suma exacta y desempate por orden. Test con valores generados (500 casos con un generador fijo): `Σ = T`, cada monto a menos de 0.01 del exacto y ninguno negativo |
| 4 | No hay migración de datos. El SQL de la migración solo toca la restricción (lo revisa el revisor). Ningún test escribe en la base real |
| 5 | `split-definition.spec.ts`: normaliza la forma vieja; deja igual la nueva; JSON inválido → 500 controlado. `fee-rule-splits.spec.ts`: la forma vieja → 400; `FIXED` con 3 decimales → 400. Front: `professionalPercentOf` con las dos formas y `buildPayerFeeRuleSplits` |
| 6 | La tabla de regresión de §3.4, escrita primero contra el código actual |
| 7 | `FIXED` > bruto; dos `FIXED` que juntos lo superan; `FIXED` + 100 %; nunca `Σ > G` (también en el test con valores generados) |
| 8 | `activity-handlers.spec`/`activity.service.spec`:<br>- el `PUT` con monto y pagador recalcula honorarios y splits;<br>- todo ocurre dentro de la transacción (`inTx: true` en `writes`);<br>- se usa la misma función que el alta (mismo resultado que el alta con el mismo bruto);<br>- 404 del pagador ajeno o inexistente, idéntico y sin escrituras;<br>- permisos ADMIN, MEMBER y profesional (propio 200, ajeno 403);<br>- `payerId: null` → pagador particular, que se crea en la transacción si falta;<br>- `transactions.spec.ts`: falla inyectada en `workItemSplit.createMany` → no queda nada (rollback del monto y del pagador creado) |
| 9 | - Cobrada + cambio → 409 `activity-already-collected` sin escrituras;<br>- cobrada + mismos valores (incluido `100` frente a `100.00`) → 200;<br>- cobrada + otros campos → 200;<br>- **carrera:** el fake simula `updateMany` con `count 0` (se cobró entre la lectura y la escritura) → 409, y `count 0` con la fila borrada → 404;<br>- mismo pedido `PAID` + monto sobre una no cobrada → 200 recalculado;<br>- guardada cobrada + `UNPAID` + monto → 409 |
| 10 | Front: `request-bodies.test.mts` (el builder no manda `''` ni `'—'`, `grossAmount` finito, `null` se conserva); `activity-edit.test.mts` (`financialChanges`: igual al centavo → sin cambio); `data-schema.test.mts` (sin `'—'`, `payerId`, `isCollected`); `api-errors.test.mts` (respaldo por `code`); fixture de contrato (los cuerpos reales del front contra el pipe y los handlers) |
| 11 | `config-handlers.spec`: con reglas → 409 `payer-has-fee-rules` sin escrituras y las reglas intactas; P2003 inyectado tras la verificación → 409; sin reglas → se borra; ajeno → 404 antes que el 409 |
| 12 | Staff sin usuario: solo participante → baja lógica; solo beneficiario → baja lógica; sin vínculos → borrado físico; P2003 inyectado en el `delete` → baja lógica con 200; P2025 en la baja → 404; con usuario → sin cambios. El nombre se sigue mostrando en `find-all` y en liquidaciones |
| 13 | Las cuatro guardias en verde, más `error-contract.spec` con los códigos nuevos |
| 14 | `npx tsc --noEmit` y lint de los archivos tocados en backend y frontend. Suites completas: Jest (hoy 45 suites, 815 tests) y `node --test` (87 tests) |

## 11. Pruebas en Postgres real (criterio 15)
Solo sobre una **copia descartable**, con el procedimiento del 015 (`015-transacciones/07-testing.md` §3):
1. Con la base del usuario **detenida**, se copia su volumen montado `:ro` a un volumen nuevo, desde un contenedor
   efímero sin red.
2. Se levanta un `postgres:16.11-alpine` sobre la copia en `127.0.0.1:<puerto efímero>`, con contraseña aleatoria
   **dentro de la copia**.
3. `prisma migrate deploy` contra la copia (aplica la migración del §8). `migrate diff --exit-code` en 0.
4. Backend auxiliar en otro puerto (no 3000 ni 3001), con `DATABASE_URL` y `JWT_SECRET` solo en el entorno del
   proceso, sin escribir `.env`.
5. Casos:
   - preparación: poner en la copia una atención en `UNPAID`, porque en la base todas están `PAID`;
   - `PUT` con monto y pagador: splits que suman el bruto al centavo y participantes recalculados;
   - `updateMany` con `NOT` compuesto aceptado por Prisma 5.22;
   - carrera real con dos sesiones `psql`: `BEGIN; UPDATE … SET "paymentStatus"='PAID', "paymentDate"=now()` sin
     confirmar, mientras el `PUT` espera; al confirmar, el `PUT` responde 409 y no cambia nada;
   - borrado de un pagador con regla: 409, y la regla sigue con su `payerId`;
   - borrado de un pagador con atenciones: el resultado que decida el PO;
   - staff sin usuario que es participante: baja lógica;
   - P2003 real: dejar sin confirmar un `INSERT` de participante en otra sesión antes del `DELETE`;
   - dashboard y liquidaciones: `number`.
6. Limpieza: contenedor y volumen de la copia borrados. En la base del usuario solo se permiten lecturas, `.\dev.ps1`
   y `-Smoke`, con los conteos sin cambios antes y después.

## 12. Rendimiento y compatibilidad
- **Rendimiento:**
  - `Decimal` cuesta un poco más que `number` en los `reduce` del dashboard y las liquidaciones. Recorren las mismas
    filas que hoy (O(n)), así que el impacto es despreciable con los volúmenes actuales (324 atenciones);
  - el `PUT` con cambio financiero hace 1 + P (máximo `MAX_ACTIVITY_PARTICIPANTS` = 10) + 3 escrituras, más las
    lecturas del motor, dentro de una transacción corta;
  - el `PUT` sin cambio financiero queda igual.
- **Compatibilidad de la API:**
  - los formatos de los montos no cambian; `isCollected` es un campo adicional;
  - `PUT /activity/:id` acepta dos campos opcionales nuevos. Los clientes que no los mandan ven el mismo
    comportamiento;
  - `POST /fee-rules` deja de aceptar la forma vieja de `splits`. El único cliente (`PayerRulesManager`) cambia en el
    mismo commit. `test-suite/page.tsx` ya mandaba un objeto inválido (regla 9: no se usa);
  - `DELETE /pro/payers/:id` con reglas pasa de "200 y reglas globales" a 409. Esa es la decisión del usuario.
- **Datos:** no se recalcula nada guardado (criterio 4). Las atenciones viejas conservan sus montos hasta que alguien
  las edite.

## 13. Plan de implementación (pasos chicos, cada uno en verde)
1. **Tests de caracterización:** la tabla de regresión del motor (§3.4) y los montos de dashboard y liquidaciones
   contra el código **actual**. Se marcan las filas que van a cambiar.
2. `money.ts` y sus tests. `money-invariants.spec.ts` con `MONEY_FILES` vacío y el control contra el detector ciego.
3. `split-definition.ts` (tipo y normalizador) y el validador de escritura solo con la forma nueva. Tests.
4. Motor: `computeAmounts` con `Decimal`, el reparto y el tope. `calculateSplits` usa el normalizador. Se actualiza
   la tabla del paso 1. Se agrega `fee-resolution.service.ts` a `MONEY_FILES`.
5. `ActivityService`: se extraen `findDefaultPayer`, `computeParticipantFees` y `computeDistribution`, y el alta se
   pasa a `Decimal`. Los tests del alta y de `transactions.spec` siguen en verde. Se agrega a `MONEY_FILES`.
6. Dashboard, liquidaciones, `find-all`, `find-by-id` y deuda de pacientes, pasados a `Decimal` con `toJsonNumber`.
   Se agregan a `MONEY_FILES` y se cierra la lista blanca.
7. `activity-collected.ts`. Refactor del borrado (sin cambio de comportamiento). `isCollected` en las dos respuestas.
8. `IsNullableEntityId`, los campos nuevos del `PUT`, `ActivityService.updateActivity` (§4.3) y los códigos de error.
   Tests de los criterios 8 y 9, y casos de org-isolation y security-invariants.
9. Migración `FeeRule.payer` `Restrict` (§8): `prisma generate` y `-CheckMigrations`. `DeletePayer` con 409. Tests.
10. `DeleteStaff` con la regla 2 extendida y el P2003. Tests y relaciones del fake.
11. Front:
    - libs puras (`activity-edit.ts`, builders, `constants`, `api-errors`, `data-schema`, `isActivityCollected`) con
      sus tests;
    - después `data.ts` (`deletePayer`), `columns.tsx` y `RetroactiveModal`, `WorkItemForm` y las dos tablas, y
      `PayerRulesManager`;
    - fixture de contrato.
12. `tsc` y lint en los dos repos, suites completas y `-CheckMigrations`.

## 14. Riesgos
| Riesgo | Mitigación |
|---|---|
| Diferencias de centavos frente a lo anterior | Aceptadas (#17). Las filas que cambian quedan marcadas en la tabla de regresión. Los datos guardados no se tocan |
| Romper reglas guardadas en la forma vieja | Normalización al leer y test de equivalencia entre las dos formas. En la base local hay 0 |
| Activar sin querer las reglas `'all'` de `PayerRulesManager` | No se toca la coincidencia (pregunta 1). El test de regresión fija que un pagador con regla `'all'` siga usando la retención o la categoría |
| El refactor del alta cambia resultados | El paso 1 (caracterización) va antes del refactor. El mismo código sirve al alta y a la edición |
| Carrera edición–cobro | Condición en el `UPDATE` y recálculo después del bloqueo. Se prueba con un fake y en Postgres real |
| El recálculo pisa ajustes manuales | Es la decisión del usuario. No hay endpoint de ajuste, así que solo puede pasar con SQL o seeds. La UI avisa siempre |
| `PAID` sin fecha queda editable (42 en la base local) | Pregunta 2. Es la definición que decidió el PO |
| Recálculo de una `SOLO_PRACTICE` cargada en modo org, o con un `role` explícito | §4.8: residual documentado y sin casos en la base local |
| La migración de la FK en una base con datos | Solo cambia la restricción. Se prueba primero en la copia. Se aplica con `migrate deploy`, nunca con `dev`/`reset` |
| `WorkItemForm` es grande y tiene efectos acoplados | Cambios limitados al modo edición, con lógica pura extraída a `activity-edit.ts` y probada. El tester recorre los 18 criterios de UX §10 |
| La lista de pagadores del modal está paginada (`limit` 100) | Con más de 100 pagadores, el guardado aparece como opción deshabilitada. Se documenta |

## 15. Preguntas al PO
Ninguna bloquea el diseño: cada una tiene una opción por defecto que el desarrollador puede aplicar si no hay
respuesta. La 3 y la 7 cambian comportamiento visible.

1. **Reglas `professionalCategory: 'all'` de `PayerRulesManager` (§1.2.2).** Hoy el motor no las aplica nunca: el
   deslizador de esa pantalla no cambia los honorarios, que salen de la retención del pagador. **Recomendación:** no
   cambiarlo en el 017, porque el criterio 6 pide "mismo resultado". Registrar en el BACKLOG que `'all'` sea un
   comodín en el motor (o que el front guarde `null`), con su propia decisión sobre el cambio de montos.
2. **"Cobrada" = `PAID` con `paymentDate`.** "Marcar Pagado" (workload) y "Marcar como Cobrado" (deudores) no ponen
   fecha, así que esas atenciones siguen editables y borrables (42 en la base local). **Recomendación:** mantener la
   definición decidida y registrar en el BACKLOG que esas acciones manden `paymentDate` (hoy), o que el backend la
   complete cuando llega `PAID` sin fecha. Si el PO prefiere "cobrada = `PAID`", cambia también la salvaguarda del
   borrado: es otra decisión.
3. **Pagador con atenciones.** Hoy el borrado da 500 genérico y no borra nada. **Recomendación:** 409
   `payer-has-activities`, "No se puede eliminar el pagador porque tiene atenciones asociadas.", con su texto de
   respaldo en el front. Por defecto, mientras no haya respuesta, sigue el 500.
4. **Formato de `PUT /activity/:id` (informativa).** Devuelve los montos como string, porque es la fila de Prisma. No
   se cambia en el 017. ¿Se unifica en otro feature?
5. **Deuda de pacientes (`summary`/`debt`).** No figura en la lista del criterio 1, pero tiene el mismo patrón.
   **Recomendación:** incluirla, porque es el mismo helper y no cambia el contrato. Si el PO prefiere limitarse a la
   lista, se saca de `MONEY_FILES`.
6. **Participantes en `WorkItemForm` en edición.** El `PUT` no los acepta y hoy la validación bloquea la edición de
   tipos con roles obligatorios. **Recomendación:** ocultar la sección de roles en edición, porque los participantes
   no se editan en el 017. Si UX prefiere mostrarlos en solo lectura, hace falta devolver los nombres en el listado,
   que hoy no se exponen.
7. **Quién ve "Eliminar pagador".** El PO indicó "solo ADMIN", pero el backend autoriza **ADMIN o el dueño del
   pagador** (`loadPayerForWrite`), y las tarjetas de esa pantalla son los pagadores propios del profesional. En una
   `CLINIC`, un MEMBER que creó sus pagadores no tendría el botón. **Por defecto:** el botón se muestra solo a ADMIN,
   como pidió el PO, sin cambiar la autorización del backend. **Recomendación:** mostrarlo también al dueño.

VEREDICTO: APROBADO
