# 008 — Implementación

Solo frontend. Sin cambios de backend, schema, `.env` ni `.claude/`. Sin commit ni push.

## Cambios por criterio
1. **Tabla con datos.** `work-items/page.tsx` ya no pasa el objeto `{ items, total }`: pasa `items` y `total` a
   `WorkloadTable`, que mapea cada ítem con `mapActivityToWorkItem`. `withServerSession` queda intacto.
2. **Columnas.** Mapeo desde la respuesta real de `GET /activity` (modo ORGANIZATION), ver tabla abajo.
3. **Estado y colores.** `WorkloadTable` usa `PAYMENT_STATUS.PAID` para el color de fila; el badge ya usaba
   `PAYMENT_STATUS`. Se eliminó el literal `'Rejected'` (fila roja): no existe ese estado en el backend
   (`PaymentStatus` = UNPAID, PARTIAL, PAID), así que era código muerto.
4. **Paginación.** Primera página (20) sin paginar en el servidor. La descripción muestra "Mostrando N de TOTAL
   atenciones" con el `total` de la API.
5. **"Nuevo Item".** Botón (y el import de `Plus`) eliminado.
6. **"Eliminar" por rol (#44).** Nueva `canDeleteActivity(orgRole, item, identity)` en
   `src/lib/activity-permissions.ts` (ADMIN todo; MEMBER solo `createdByUserId = sub`; con `createdByUserId` null,
   solo si `professionalId` coincide con el del token). `workload/columns.tsx` deshabilita el ítem con tooltip
   "Solo podés eliminar tus propias atenciones". `AdmisionesTable` pasó a usar la misma función (misma lógica que
   tenía inline). Se agregó `readSessionIdentity()` a `src/lib/session.ts` (usa `decodeJwtPayload`) y
   `AdmisionesTable` dejó su `readIdentity` local con `jwt-decode`. El backend sigue siendo la autoridad.
7. **Sin regresiones.** Editar, marcar pagado/pendiente y eliminar mantienen `isHandledApiError` y los mensajes del
   007. El borrado de una actividad cobrada con fecha de pago sigue deshabilitado como antes.
8. **Calidad.** Ver resultados.

## Mapeo API -> columna
| Columna | Campo de la API | Notas |
|---|---|---|
| Fecha | `date` (`YYYY-MM-DD`) | `new Date(date + 'T12:00:00')`, igual que AtencionesTable |
| Profesional | `professionalName` | "—" si falta |
| Paciente | `patientName` | "—" si falta |
| Práctica | `serviceType` | "—" si falta |
| Pagador | `payerName` | "Unknown" (valor de relleno del backend) se muestra "—" |
| Estado | `status` (PaymentStatus) | badge Pagado/Parcial/Pendiente |
| Monto total | `grossAmount` | "—" si no viene |
| Neto prof. | `netAmount` | En modo ORG el backend lo calcula como suma de splits PROFESSIONAL; "—" si no viene |

Todos los campos vienen en la API; ninguno hubo que derivar. Antes, `serviceType`/`professionalName`/`patientName`
coincidían por nombre, pero `status` leía bien y `grossAmount`/`netAmount` también: el fallo real era el objeto
en lugar del arreglo; se alineó además el tipo `WorkItem` (ya no tiene `amount`, `payer`, `service`,
`splitProfessional`, `splitPractice`).

`RetroactiveModal`: usa `grossAmount` y `payerName`; al confirmar devuelve `grossAmount` y `payerName`.

## Archivos tocados
- `frontend/src/app/(dashboard)/[orgSlug]/work-items/page.tsx`
- `frontend/src/components/domain/workload/{WorkloadTable,columns,RetroactiveModal}.tsx`
- `frontend/src/components/domain/workload/data-schema.ts` (tipo `WorkItem`, `ApiActivity`, `mapActivityToWorkItem`)
- `frontend/src/components/domain/org/admisiones/AdmisionesTable.tsx` (usa la función compartida)
- `frontend/src/lib/session.ts` (+ `readSessionIdentity`)
- `frontend/src/lib/activity-permissions.ts` (nuevo)
- `frontend/package.json` (script `test` suma los 2 tests nuevos)
- Tests nuevos: `frontend/src/lib/activity-permissions.test.mts`,
  `frontend/src/components/domain/workload/data-schema.test.mts`

## Resultados
- `npx tsc --noEmit`: sin errores.
- `npm test`: 17 pass, 0 fail (incluye 6 tests nuevos de permisos y mapeo).
- ESLint por archivo contra `HEAD`: sin errores nuevos (columns 1/1, RetroactiveModal 1/1, AdmisionesTable 21/21,
  session.ts 0/0; `WorkloadTable.tsx` y `data-schema.ts` 0 tras tipar `ApiActivity`; `activity-permissions.ts` 0).
- `npm run build` con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`: OK (corrido antes de tipar
  `ApiActivity`; el cambio posterior se verificó con tsc, eslint y tests).

## Desvíos y dudas
- **Limitación previa del backend, no corregida:** `PUT /activity/:id` solo persiste `date`, `paymentStatus`,
  `paymentMethod`, `paymentDate` y `attendance`. El modal de edición solo cambia monto y pagador, que el backend
  ignora (sin whitelist, no da error): la UI dice "Actualizado correctamente" pero no cambia nada. Ya pasaba antes
  (y el modal además usaba una lista fija de pagadores y un "70%" fijo). Se adaptó el modal para que siga
  "funcionando" como antes; hacerlo real exige backend (fuera de alcance). Decisión del PO si se abre un feature.
- Se mantuvo `readSessionIdentity` en `lib/session.ts`; `jwt-decode` queda sin uso en AdmisionesTable (la
  dependencia sigue en package.json por si otros archivos la usan).
- Se quitó la fila roja `'Rejected'` por no existir ese estado.

## Notas para revisor y tester
- Revisar que el ítem "Eliminar" deshabilitado sea un `DropdownMenuItem disabled` con `title` (patrón de
  `pro/atenciones/columns.tsx`).
- Tester: ADMIN y MEMBER deben ver 200 y filas; el MEMBER ve "Eliminar" deshabilitado en atenciones ajenas. La
  identidad sale de la cookie en el cliente, así que en el HTML del servidor el ítem aparece habilitado hasta
  la hidratación (igual que en Admisiones; solo presentación).
- No se llamó a la API real ni se levantó el stack.
