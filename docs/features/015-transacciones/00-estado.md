# Estado del feature 015 (traspaso entre sesiones)

Última actualización: 2026-11-04, por el PO.

## Etapas
| Etapa | Archivo | Estado |
|---|---|---|
| Spec | 01-spec.md | Lista |
| UX/UI | — | Omitida |
| Arquitecto | 03-diseno-tecnico.md | APROBADO. No queda ninguna operación con varias escrituras fuera de `$transaction` (ya resuelto en el 007) |
| Desarrollador | 04-implementacion.md | Pendiente: arranca **después del commit del 014** |
| Revisor | 05-revision.md | Pendiente |
| Seguridad | 06-seguridad.md | Pendiente |
| Tester | 07-testing.md | Pendiente |
| Documentador | 08-documentacion.md | Pendiente |
| Cierre | 09-cierre.md | Pendiente |

## Decisiones del PO sobre las aclaraciones del arquitecto (03)
1. **El BACKLOG #16 ya está resuelto desde el 007.** El 015 se reduce a la guardia estática, los tests de atomicidad
   y el cierre de dos carreras.
2. **Se incluyen los dos cambios que solo se notan si dos sesiones chocan al mismo tiempo:**
   - **fusión de pacientes:** un `updateMany` bloquea los dos pacientes y vuelve a verificarlos; si no quedan los dos,
     responde 404;
   - **borrado de una atención:** la salvaguarda de "cobrada con fecha de pago" pasa al `where` del `delete`. Si otra
     sesión la cobró en el medio, responde el mismo 403, o 404 si ya no existe.
3. **Van al BACKLOG**, porque necesitan schema o cambios de aislamiento:
   - unicidad del pagador por defecto, de la fee rule por pagador y categoría, y del CUIT del profesional;
   - `onDelete: Restrict` en `WorkItem.activityType` y `WorkItem.patient`.
4. **Borrar un pagador con fee rules:** sus reglas quedan con `payerId = null` y el motor las aplica a **todos** los
   pagadores. Es un bug con impacto en montos. Va al BACKLOG y se resuelve en el **016** (dinero y motor de honorarios).
   Decisión provisional del PO: responder **409** si el pagador tiene reglas (sin pérdida de datos). La confirma el
   usuario.
5. **Borrado físico de staff:**
   - si el profesional es solo participante de una atención, el borrado responde 500;
   - si es solo beneficiario de splits, esos splits quedan sin beneficiario.

   Va al BACKLOG y se resuelve junto con el 016.
6. **El schema de Prisma y las migraciones no coinciden (prioridad alta).**
   - Las migraciones no crean `WorkItemParticipant`, `WorkItem.activityTypeId` ni las columnas `baseValue`,
     `cardValue` y `roles` de `ActivityType`.
   - `WorkItem.coProfessionalId` está en las migraciones y no en el schema.
   - Un `migrate deploy` sobre una base vacía no permitiría crear atenciones.

   Se adelanta en el plan el **024-migracion-user-cuit**, que pasa a ser **016-schema-y-migraciones** e incluye
   `User.cuit`. Va inmediatamente después del 015; el resto del plan se corre un lugar.

## Decisiones vigentes del usuario
- Commit y push autorizados al aprobarse cada feature, sin force. Después se empieza el siguiente feature de
  `docs/features/PLAN-pendientes.md`.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
