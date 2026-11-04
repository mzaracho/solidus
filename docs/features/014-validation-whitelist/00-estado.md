# Estado del feature 014 (traspaso entre sesiones)

Última actualización: 2026-11-04, por el PO.

## Etapas
| Etapa | Archivo | Estado |
|---|---|---|
| Spec | 01-spec.md | Lista (las decisiones de abajo prevalecen) |
| UX/UI | — | Omitida |
| Arquitecto | 03-diseno-tecnico.md | APROBADO. Lo escribió completo antes de que la sesión se cortara por límite de uso |
| Desarrollador | 04-implementacion.md | Pendiente: arranca **después del commit del 013** (el diseño marca lo que depende del 013 con **[013]**) |
| Revisor | 05-revision.md | Pendiente |
| Seguridad | 06-seguridad.md | Pendiente |
| Tester | 07-testing.md | Pendiente |
| Documentador | 08-documentacion.md | Pendiente |
| Cierre | 09-cierre.md | Pendiente |

Vueltas de corrección usadas: 0 de 3.

## Decisiones del PO sobre las aclaraciones del arquitecto (03, §12)
Se aceptan los 10 defaults del diseño. Ninguno cambia lo que hoy ve un usuario en la UI:
1. **`RetroactiveModal`:** el builder descarta `grossAmount` y `payerName` y el comportamiento queda igual. Está en el
   BACKLOG #45 (016).
2. **`PacientesTable`:** es un mock que ya recibe 400 y queda igual. Va al BACKLOG.
3. **Settings de la organización:** el DTO acepta las 2 claves de la UI y las 5 de `OrgSettings`, validadas; cualquier
   otra da 400. El reemplazo del JSON no cambia. Fusionar con lo guardado va al BACKLOG.
4. **Ids malformados en body o query:** responden 400 (los de path siguen con el 404 del 007).
5. **Fee rules:** el `POST` hace upsert, y su DTO cubre crear y editar.
6. **Clientes externos:** hoy el único cliente es el front. Una integración que mande campos de más recibiría 400.
7. **Sin enum** en `paymentMethod`, `serviceType`, `linkedType`, `code`, `role` y `professionalCategory`. Quedan con
   tipo y largo máximo. Convertir `paymentMethod` en enum va al BACKLOG.
8. **Topes:**
   - montos de 0 a 99.999.999,99;
   - porcentajes de 0 a 100;
   - páginas de hasta 100;
   - hasta 10 participantes por atención;
   - horas de 0 a 1000;
   - cantidad de 1 a 1000;
   - `alertsDays` de 0 a 3650.
9. **`POST activity` con `patientId: ''`:** da 400. El front nunca lo manda.
10. **Se quitan los `orgId` ignorados** de los bodies de creación y el `?orgId=` de `getOrgConfig`.

## Decisiones vigentes del usuario
- Commit y push autorizados al aprobarse cada feature, sin force. Después se empieza el siguiente feature de
  `docs/features/PLAN-pendientes.md`.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
