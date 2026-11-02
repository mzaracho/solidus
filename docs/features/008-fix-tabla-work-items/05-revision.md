# 008 — Revisión

Revisor: código frontend del feature 008 (sin cambios de backend). No se modificó código.

## Resultados de comandos (frontend)
- `npx tsc --noEmit`: sin errores.
- `npm test`: 17 pass, 0 fail.
- `npm run build` (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`), corrido DESPUÉS del último cambio de
  tipos: OK. `/[orgSlug]/work-items` figura como ruta dinámica.
- ESLint, actual vs `git show HEAD:<archivo>` (copiado a un archivo temporal, ya borrado):
  - `columns.tsx`: 1 error + 1 warning, igual que HEAD.
  - `RetroactiveModal.tsx`: 1 error (`react-hooks/set-state-in-effect`, línea 31), igual que HEAD (mismo error, el
    efecto no cambió de estructura).
  - `AdmisionesTable.tsx`: 21 errores + 2 warnings, igual que HEAD (23 problemas en ambos).
  - `session.ts`: 1 warning (`Unused eslint-disable`, línea 11), preexistente en HEAD.
  - `WorkloadTable.tsx`, `data-schema.ts`, `activity-permissions.ts`, `work-items/page.tsx`: 0 problemas.
  - Sin errores nuevos.

## Correctitud frente a los criterios
1. Tabla con datos: OK. `page.tsx` pasa `items` y `total` (`result?.items ?? []`); `withServerSession` intacto.
2. Mapeo: OK contra `backend/src/application/features/activity/queries/find-all-activities-query.ts`
   (líneas 185-214): `date` (YYYY-MM-DD), `serviceType`, `patientName`, `professionalId/Name`, `payerName`
   (relleno "Unknown"), `status`, `paymentDate`, `createdByUserId`, `grossAmount` (Number) y `netAmount`
   (modo ORG: suma de splits PROFESSIONAL). Fecha con `T12:00:00` como `AtencionesTable`. Nulos a "—".
3. PAYMENT_STATUS: OK en `WorkloadTable.tsx` y `columns.tsx`. Retirar `'Rejected'` es correcto (no existe en el enum).
4. Total: OK, "Mostrando N de TOTAL" con el `total` de la API.
5. "Nuevo Item" y el import de `Plus` eliminados: OK.
6. `canDeleteActivity` (`frontend/src/lib/activity-permissions.ts`): coincide con la decisión 1b y con
   `canModifyActivity(..., 'delete')` del backend (ADMIN todo; con `createdByUserId` no nulo, solo si es el `sub`;
   con nulo, dueño del Professional). `AdmisionesTable` usa la misma función con lógica idéntica a la inline anterior:
   sin regresión. `readSessionIdentity()` (`session.ts` 91-99) solo lee `sub` y `professionalId` con chequeo de
   tipo, vía `decodeJwtPayload` (sin verificar firma), y se usa solo para habilitar/deshabilitar un botón;
   el backend decide. Aceptable. El rol viene del store, no del token.
7. Sin regresiones: editar, pagar/pendiente y eliminar conservan `isHandledApiError` y `router.refresh()`.
   `withServerSession` no se tocó.

## Hallazgos

### BLOQUEANTE
Ninguno.

### MAYOR
Ninguno.

### MENOR
- **M1. Edición con éxito falso (preexistente, documentado).** `columns.tsx` ~156-159 y `RetroactiveModal.tsx`:
  `PUT /activity/:id` ignora `grossAmount` y `payerName`, pero la UI dice "Actualizado correctamente". No es
  regresión ni está en el alcance del 008. Sugerencia: abrir un feature (PO) para persistir monto/pagador o
  quitar el modal.
- **M2. Pagador "—" en el modal.** `data-schema.ts` mapea el pagador faltante a `'—'` y `RetroactiveModal.tsx`
  línea 32 lo carga con `setPayer(item.payerName)`; si el usuario guarda, se enviaría `'—'` como `payerName`
  (hoy el backend lo ignora). Sugerencia: pasar `''` al modal cuando el valor es `'—'`, o no enviar `payerName`
  si no cambió.
- **M3. Tooltip del ítem deshabilitado.** `columns.tsx` ~128-136: el `DropdownMenuItem` shadcn tiene
  `data-[disabled]:pointer-events-none`, por lo que el `title` ("Solo podés eliminar tus propias atenciones")
  probablemente no aparece al pasar el mouse (mismo patrón que `pro/atenciones/columns.tsx`, y ya pasaba con el
  tooltip anterior). Sugerencia: envolver el contenido en un `<span title=...>` o usar `Tooltip`.
- **M4. Rol aún no cargado.** `columns.tsx` línea 62 y 79: si `orgRole` del store es `null` (antes de hidratar),
  `canDeleteActivity` devuelve `true` y "Eliminar" aparece habilitado un instante (igual que en Admisiones; el
  backend responde 403). Solo presentación; sugerencia opcional: tratar `null` como no habilitado.

### SUGERENCIAS
- `columns.tsx` ~153: `onConfirm` recibe `updated` de tipo `WorkItem` completo pero solo se usan dos campos;
  se podría tipar el callback con `Pick<WorkItem,'grossAmount'|'payerName'>`.
- Tests: faltan casos de `mapActivityToWorkItem` con `grossAmount` como string numérico (Decimal serializado) y
  `date` con hora; y de `readSessionIdentity` (depende de `document.cookie`, difícil en `node --test`; se
  podría extraer una función pura que reciba el token). Cobertura actual razonable (6 tests nuevos).
- `jwt-decode` quedó sin uso en `AdmisionesTable`; verificar si otro archivo lo usa y, si no, retirar la
  dependencia en un feature aparte.
- El texto de la descripción dice "Mostrando N de TOTAL" sin paginación: el usuario no puede ver el resto
  (aceptado por la spec, criterio 4).

VEREDICTO: APROBADO
