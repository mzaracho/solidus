# Estado del feature 016 (traspaso entre sesiones)

Última actualización: 2026-11-04, por el PO.

## Etapas
| Etapa | Archivo | Estado |
|---|---|---|
| Spec | 01-spec.md | Lista |
| UX/UI | — | Omitida |
| Arquitecto | 03-diseno-tecnico.md | APROBADO. La base local del usuario ya coincide con el schema; hay 15 diferencias entre las migraciones y el schema; las pruebas se hicieron sobre copias |
| Desarrollador | 04-implementacion.md | Pendiente: arranca **después del commit del 015** |
| Revisor | 05-revision.md | Pendiente |
| Seguridad | 06-seguridad.md | Pendiente |
| Tester | 07-testing.md | Pendiente |
| Documentador | 08-documentacion.md | Pendiente |
| Cierre | 09-cierre.md | Pendiente |

## Decisiones del PO sobre las aclaraciones del arquitecto (03)
1. **Se aceptan los `DROP` de `WorkItem.coProfessionalId` y `eventRole`.** No existen en la base local del usuario, y
   en las bases armadas solo con las migraciones viejas la migración falla entera, sin perder datos. Los volúmenes
   huérfanos de composes viejos (`healthops_healthops_pgdata` e `infra_healthops_pg`) no se tocan.
2. **El alcance incluye `Payer.cuit` y la FK `Professional.userId`.**
3. **El Dockerfile corre `migrate deploy; start:prod` con `;`**, así que el backend arranca aunque la migración falle.
   Va al BACKLOG y al feature 020 (endurecimiento de Docker).
4. **Hay que registrar la migración nueva como aplicada en la base real del usuario** (`resolve --applied`). Requiere
   su confirmación, porque es el único paso que escribe en esa base. Se lo pregunta el PO.
   - Orden: primero el desarrollador crea la migración, después se hace el baseline en la base real (con
     confirmación) y recién después el tester corre `.\dev.ps1`.
   - Si alguien corre `.\dev.ps1` antes del baseline, el deploy falla con P3009 sin efectos en la base, y el mismo
     procedimiento lo recupera.
5. **La regla 6 de `CLAUDE.md`** la actualiza el documentador, como en los features anteriores. La documentación de
   `CLAUDE.md` es parte de la spec aprobada.

## Pendiente del usuario
- **Confirmar el baseline** (`resolve --applied`) en su base local, con el respaldo previo en `.dev/backups`.
- **Borrar un volumen anónimo de prueba** que dejó el arquitecto. El sistema de permisos bloqueó su eliminación. Tiene
  solo bases de prueba con datos ficticios:
  `docker volume rm d9e4e4f6a7e029d0a57e27311f9dee0c4dc3f13e9fad338c015d240915b888a9`.

## Decisiones vigentes del usuario
- Commit y push autorizados al aprobarse cada feature, sin force. Después se empieza el siguiente feature de
  `docs/features/PLAN-pendientes.md`.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
