# Estado del feature 017 (traspaso entre sesiones)

Última actualización: 2026-11-18, por el PO. **Feature cerrado** (ver `09-cierre.md`).

## Etapas
| Etapa | Archivo | Estado |
|---|---|---|
| Spec | 01-spec.md | Lista. El 2026-11-18 se agregaron los criterios 16 (fecha de pago obligatoria) y 17 (pagador con atenciones) |
| UX/UI | 02-ux.md | APROBADO |
| Arquitecto | 03-diseno-tecnico.md | APROBADO |
| Desarrollador | 04-implementacion.md | Completo, más los ajustes del PO y las vueltas 1 y 2 |
| Revisor | 05-revision.md | APROBADO en la vuelta 2 |
| Seguridad | 06-seguridad.md | APROBADO en la vuelta 2 |
| Tester | 07-testing.md | APROBADO en la vuelta 2 |
| Documentador | 08-documentacion.md | Completo |
| Cierre | 09-cierre.md | Hecho |

Vueltas de corrección: 2 de 3.

**Cambio de schema (regla 6):** `FeeRule.payer` pasa a `onDelete: Restrict`, con la migración
`20261118120000_fee_rule_payer_restrict`. Ya está aplicada en la base del usuario con `migrate deploy` y los conteos
no cambiaron.

## Decisiones del usuario
- **2026-11-18, #75:** borrar un pagador con fee rules responde 409 con un mensaje. No se borran las reglas.
- **2026-11-18, #45, opción A:** el monto y el pagador se pueden editar mientras la atención no esté cobrada. El
  backend recalcula los participantes y los splits y reemplaza los ajustes manuales. Si la atención está cobrada, la
  UI los deshabilita y el backend responde 409.
- **2026-11-18, "cobrada", opción A:** cobrada es `PAID` con `paymentDate`.
- **2026-11-18, fecha de pago:** al marcar como pagada siempre hay que especificar la fecha de pago, porque "tenemos
  que poder tener toda la información". Es el criterio 16.

## Decisiones del PO
- **#76:** un staff sin usuario que es participante o beneficiario se da de baja lógica.
- **#17:** no se recalculan registros existentes. Las diferencias de centavos se aceptan.
- **Fecha de pago:** se precarga con el día y se puede cambiar, pero solo cuando la acción **cambia** el estado a
  pagado. Al editar una atención antigua `PAID` sin fecha, el campo arranca vacío y no es obligatorio.
- **Regla de 30 días del `RetroactiveModal`:** se elimina, porque ninguna protección del backend depende de ella.
- **Borrar un pagador con atenciones:** responde 409 `payer-has-activities`.
- **Botón "Eliminar pagador":** lo ven ADMIN y el dueño.
- **Participantes en la edición:** se ocultan.
- **Reglas `'all'` y pagadores que no se pueden borrar:** van al BACKLOG (#88 y #89).
- **Cobro desde `PacientesTable`:** se oculta porque la pantalla está rota (#93).
- **409 `activity-already-collected`:** un solo texto para los dos casos.
- **400 por `paymentDate` nula o vacía** en una atención que queda `PAID`: se acepta (vuelta 1).

## Decisiones vigentes del usuario
- Commit y push autorizados al aprobarse cada feature, sin force. Después se empieza el siguiente de
  `docs/features/PLAN-pendientes.md`.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
- Las escrituras de prueba van en una copia descartable de la base, nunca en la base del usuario.
