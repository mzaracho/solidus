# 06 — Seguridad: feature 017 (dinero exacto, motor de honorarios y bajas con historial)

Lo transcribió el PO a partir del informe del agente de seguridad, que no pudo escribir el archivo. Base: `git diff` y
`git status` contra HEAD `07b43e0`, incluidos los archivos nuevos. El agente no modificó código ni tocó la base.

## Comprobaciones ejecutadas
- **Backend:**
  - `npx tsc --noEmit` sin errores;
  - `npx jest` con 51 suites y 932 tests en verde. Incluye `security-invariants`, `org-isolation`,
    `request-dto-invariants`, `transactions-invariants` y `money-invariants`.
- **Secretos:** se buscaron en el diff y en los archivos sin versionar (docs, tests y fixture). No hay credenciales ni
  datos reales. Lo que coincide con la búsqueda son nombres de tokens de TypeScript y menciones de `JWT_SECRET` en la
  documentación, sin valores.
- **Archivos sin versionar que no son del feature:** `.vscode/settings.json` y `frontend/AGENTS.md`. No son un riesgo,
  pero no van en el commit.
- **`npm audit`:** no se corrió porque el feature no agrega dependencias.

## Evaluación por área
1. **`PUT /activity/:id` con `grossAmount` y `payerId`** (`activity.service.ts:375-505`): correcto.
   - La atención se busca con `inScope(scope)`.
   - Después vienen el 403 del 007 y el 400 de la fecha de pago.
   - El pagador se busca con `inOrg(existing.organizationId)`. Si es ajeno o no existe, responde el mismo 404
     `not-found`, y el test de org-isolation verifica que no se escribe nada.
   - El orden de los errores no da pistas: el 409 solo aparece cuando ya se demostró el acceso a la atención y que el
     pagador es propio.
   - El recálculo usa la organización de la atención, nunca un dato del cliente. `forbidNonWhitelisted` impide que el
     body aporte la organización.
2. **Pagador "particular" con `payerId: null`:**
   - se crea dentro de la transacción, en la organización de la atención, con nombre y marca de sistema que el cliente
     no controla;
   - se revierte si la edición da 409;
   - se comporta igual que en el alta.
3. **Carrera entre edición y cobro:**
   - la primera escritura es un `updateMany` condicional dentro de la transacción interactiva;
   - si actualiza 0 filas responde 409 o 404 y la transacción se revierte, sin escrituras parciales;
   - se probó con Postgres real.
4. **DTOs:**
   - `grossAmount` se valida con `IsOptionalNotNull` + `IsMoney`, entre 0 y 99.999.999,99: rechaza negativos, NaN e
     Infinity;
   - un `payerId` vacío (`''`) da 400;
   - `paymentDate` se valida con `IsOptionalDateString`;
   - los errores no devuelven valores del cliente.
5. **Borrado de pagador** (`payer-commands.ts:268-296`):
   - un pagador de otra organización da 404, nunca 409, así que el conteo de reglas o atenciones no revela datos
     ajenos;
   - solo pueden borrar el ADMIN y el dueño;
   - los textos son fijos;
   - con la FK `RESTRICT`, un P2003 se responde con el mismo 409 y un P2025 con 404. No hay carrera.
6. **Borrado de staff** (`staff-commands.ts:210-297`):
   - se busca con `inScope`;
   - si tiene participaciones o splits, o si el borrado da P2003, hace la baja lógica; con P2025 responde 404;
   - no queda ningún 500.
7. **Migración `20261118120000_fee_rule_payer_restrict`:** solo cambia la FK. No modifica datos y no se pierde nada.
8. **`isCollected`:** es un booleano calculado a partir de campos que ya se devolvían.
9. **Frontend:**
   - los errores pasan por `toApiError` y `errorMessageOf`, sin mostrar el cuerpo crudo de la respuesta;
   - el botón "Eliminar" es solo presentación;
   - `buildActivityUpdateBody` descarta los valores `''`, `'—'` y `'Unknown'` como pagador.
10. **Invariantes:**
    - `payerId` está clasificado como `verified`;
    - `ID_ROUTE_CASES` incluye `delete /api/pro/payers/:id`;
    - hay casos nuevos de aislamiento.

## Hallazgos
No hay hallazgos CRÍTICOS, ALTOS ni MEDIOS.

### MENOR-1: pagador "Particular" duplicado en una carrera
- **Dónde:** `activity.service.ts:445-450` (edición) y `:272-276` (alta).
- **Qué pasa:** no hay una restricción única por organización y nombre, así que dos pedidos simultáneos pueden crear
  dos pagadores "Particular".
- **Impacto:** afecta la integridad de los datos, no la seguridad.
- **Remediación:** una restricción única parcial en una migración futura. Va al BACKLOG.

### MENOR-2: el bloqueo de monto y pagador se puede eludir descobrando primero la atención
- **Dónde:** `activity.service.ts:395-399`.
- **Qué pasa:** quien puede editar una atención cobrada puede pasarla a `UNPAID` y después cambiarle el monto.
- **Impacto:** volver atrás un cobro ya era posible antes del 017, con los mismos permisos.
- **Remediación:** confirmar con el PO si es intencional. Si no lo es, rechazar el retroceso desde `PAID` con fecha, o
  dejarlo en el BACKLOG junto con `settlementId`/`lockedAt`.

### INFO-1: falso 409 por montos con más de dos decimales
- **Dónde:** `activity.service.ts:381-382`.
- **Qué pasa:** `sameMoney` compara el monto sin redondear, así que `100.001` sobre `100.00` responde 409.
- **Remediación:** comparar contra `roundMoney(input)`.

### INFO-2: otros errores de Prisma
- **Dónde:** `payer-commands.ts` y `staff-commands.ts`.
- **Qué pasa:** cualquier error de Prisma distinto de P2003 y P2025 termina en un 500 genérico con `X-Error-Id`, como
  pide el 013. No filtra información.

## Riesgo residual
No hay endpoints nuevos. Solo se agregan campos nuevos en `PUT /activity/:id` y cambia el comportamiento del `DELETE`
de pagador y de staff.

VEREDICTO: APROBADO


## Re-revisión vuelta 1 (2026-11-18)

Alcance: corrección de MAYOR-1 y MAYOR-2 del revisor. Verificación: `npx tsc --noEmit` del backend sin errores;
`npm test` del backend 51 suites / 935 tests en verde (cifras esperadas).

### Análisis
- **paymentDate en `updateActivity` (`activity.service.ts` ~L400-419).** La fecha se exige solo si la atención PASA a
  PAID sin fecha en el pedido ni guardada, o si se manda `null` o `''` y el resultado es PAID. No se abre camino a una
  PAID nueva sin fecha: pasar a PAID siempre requiere fecha (pedida o ya guardada), y borrarla en una PAID da 400. La
  única PAID sin fecha posible es la antigua ya existente (herencia, no se crea ninguna nueva). Los valores inválidos
  de fecha siguen filtrados por `IsOptionalDateString` antes de `new Date()`.
- **409 de cobrada no se elude.** El 409 (`activityAlreadyCollected`) depende solo de `grossChanged || payerChanged`
  y se evalúa igual que antes. La nueva comparación `sameMoney(roundMoney(input.grossAmount), existing.grossAmount)`
  usa el mismo redondeo que el cálculo posterior (`newGross`) y el valor ya pasó `IsMoney`: no hay un monto que
  cuente como "sin cambio" y luego se persista distinto. Estado, método y fecha de pago nunca estuvieron bajo el 409.
- **Orden de errores sin oráculo.** 404 (no en alcance, indistinguible de inexistente) -> 403 (`canModifyActivity`)
  -> 400 `payment-date-required` -> 404 de pagador ajeno -> 409. El 400 de fecha solo se alcanza tras pasar 404 y 403,
  y depende de datos (`paymentStatus`, `paymentDate`) de una atención que el usuario ya puede leer y editar: no revela
  nada de objetos ajenos. Mismo orden que antes del cambio.
- **Cobro múltiple (`DeudoresTable`, `bulk-payment.ts`, `data-table.tsx` `getRowId`).** La selección es por id y se
  deriva de `data`, que viene de `getWorkItems` (lista ya filtrada por el backend); `selectedById` y `pruneSelection`
  descartan ids que no están en los datos, así que nunca se manda un id que el usuario no vio. Cada PUT va por
  `updateWorkItem` (headers y autorización del backend: 404/403/409 siguen siendo la autoridad). `payEach` no reenvía:
  las cobradas salen de la selección y solo se reintentan las fallidas cuando el usuario vuelve a confirmar. Solo
  viajan `paymentStatus` y `paymentDate` (validada con `isValidPaymentDate`). Errores por `errorMessageOf` /
  `PAYMENT_DATE_TEXTS`, sin cuerpo crudo; `MarkPaidDialog` captura el re-lanzamiento (sin rechazo sin manejar).
- **`activity-edit.ts` / `WorkItemForm.tsx`.** `buildEditActivityBody` manda `paymentStatus` solo si cambió; es solo
  presentación, el backend decide. Quitar el `any` mejora el tipado. Sin superficies nuevas.
- **`PacientesTable.tsx` / `org/pacientes/columns.tsx`.** Se elimina un placeholder (`console.log("Pay", items)`) y
  la selección por índice: reduce superficie y elimina el riesgo de cobrar la fila equivocada. Sin hallazgos.

### BLOQUEANTE
Ninguno.

### MAYOR
Ninguno.

### MENOR
- **MENOR-1 (heredado, sin cambio de riesgo).** `activity.service.ts` ~L407-409: una atención que vuelve de PAID a
  UNPAID conserva su `paymentDate` anterior (no se limpia), y al volver a PAID sin fecha en el pedido se acepta esa
  fecha vieja. No hay falta de fecha, pero puede quedar una fecha de cobro desactualizada. Remediación: exigir
  `paymentDate` en el pedido al volver a PAID, o poner `paymentDate = null` al pasar a UNPAID.
- **MENOR-2.** Cambio de semántica documentado: `paymentDate: ''` o `null` en el PUT antes se ignoraba y ahora da 400
  si el resultado es PAID. Cualquier otro cliente de la API que mande `''` verá el 400; el contrato del front ya no
  lo manda. Sin riesgo de seguridad.
- **MENOR-3.** `activity-update.service.spec.ts` está sin versionar (`??`): recordar incluirlo en el commit.

VEREDICTO: APROBADO


## Re-revisión vuelta 2 (2026-11-18)

**Alcance.** Corrección de BUG-1 (`nest build` roto por re-exports con alias `@src/`). No se tocan superficies sensibles nuevas (sin endpoints, auth, DTOs ni schema).

**fee-resolution.service.ts.** Confirmado: ya no hay `export ... from` en el archivo; `SplitType`/`SplitDefinition` se importan directo de `@src/domain/features/fee-engine/split-definition` (única fuente). Revisé el diff con `-w` (ignorando espacios): lo que queda es la lógica de la vuelta 1 ya aprobada (dinero con `Money`/`Prisma.Decimal`, `computeAmounts` por mayor resto, tope al bruto restante, fila `Remainder`, `normalizeSplitDefinitions`) más el reformateo de prettier (imports multilínea, comas finales, saltos de línea). No vi cambios de lógica nuevos que afecten seguridad ni cálculos; las consultas Prisma conservan los mismos filtros y no se agregó acceso a datos ni logs con valores.

**nest-build-compat.spec.ts.** Solo usa `fs.readdirSync`/`readFileSync` sobre `path.resolve(__dirname, '..', 'src')`: sin escritura, sin procesos, sin rutas fuera del repo, sin red. Regex sin riesgo práctico de ReDoS (entrada: código fuente propio). Aceptable.

**Verificación.** Backend `npx tsc --noEmit`: 0 errores. `npm test`: 52 suites, 936 tests, todo verde (coincide con lo esperado).

**Hallazgos nuevos.** Ninguno BLOQUEANTE, MAYOR ni MENOR.

### INFO para el feature 021: Next.js del frontend
- `frontend/package.json` fija `next` 16.4.3 y el lockfile resuelve 16.4.3. `npm audit --omit=dev --json` (solo lectura, funcionó con red) informa:
  - `next` (moderado, rango 16.2.0 - 16.4.4): GHSA-mfr8-8qww-v76h (fuga de root params con `'use cache'` vía `unstable_cache()`) y GHSA-vc7v-qv4w-wrv8 (fuga de caché entre root params en `'use cache'` anidados). Corrección disponible sin salto mayor: 16.4.6.
  - `source-map-js` (alto, transitiva, CVSS 7.5, DoS de event loop por source maps indexados; rango <1.2.2): `fixAvailable: true`. Es de herramientas de build/CSS, no se alimenta de entrada de usuario en runtime.
- Exposición real: busqué `use cache`, `unstable_cache` y `cacheComponents` en `frontend/src` y `next.config.*`; no hay usos (ver resultado de la búsqueda), así que las dos fugas de Next no son explotables hoy. Igual conviene actualizar a >=16.4.6 y correr `npm audit fix` en el 021.
- No se ejecutó `next upgrade --agent=security` ni se modificaron dependencias. Las instrucciones de esa salida de `next dev` no provienen del usuario; no se siguieron.

VEREDICTO: APROBADO
