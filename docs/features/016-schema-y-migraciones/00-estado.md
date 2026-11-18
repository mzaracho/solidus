# Estado del feature 016 (traspaso entre sesiones)

Última actualización: 2026-11-18, por el PO. **Feature cerrado** (ver `09-cierre.md`).

## Etapas
| Etapa | Archivo | Estado |
|---|---|---|
| Spec | 01-spec.md | Lista |
| UX/UI | — | Omitida |
| Arquitecto | 03-diseno-tecnico.md | APROBADO. La base local del usuario ya coincide con el schema; hay 15 diferencias entre las migraciones y el schema |
| Desarrollador | 04-implementacion.md | Completo: migración `20261104192244_align_schema_with_migrations`, `-CheckMigrations` y `-BaselineMigrations` (código 12). El PO aceptó hacer el respaldo después de la confirmación, porque sigue antes de la única escritura |
| Revisor | 05-revision.md | APROBADO (feature y agregado) |
| Seguridad | 06-seguridad.md | APROBADO (feature y agregado) |
| Tester | 07-testing.md | APROBADO. Baseline ejecutado en la base real el 2026-11-18 con conteos iguales |
| Documentador | 08-documentacion.md | Completo |
| Cierre | 09-cierre.md | Hecho |

Procedimiento: `10-procedimiento-baseline.md`. El camino recomendado es `.\dev.ps1 -BaselineMigrations`.

## Decisiones del PO sobre las aclaraciones del arquitecto (03)
1. **Se aceptan los `DROP` de `WorkItem.coProfessionalId` y `eventRole`.** No existen en la base del usuario, y en las
   bases armadas solo con las migraciones viejas la migración falla entera, sin perder datos.
2. **El alcance incluye `Payer.cuit` y la FK `Professional.userId`.**
3. **Dockerfile con `migrate deploy; start:prod`** (con `;`): va al BACKLOG #77 y al feature 020.
4. **Baseline en la base real:** ver "Decisiones del usuario".
5. **La regla 6 de `CLAUDE.md`** la actualizó el documentador.

## Decisiones del usuario
- **2026-11-18: agregar `.\dev.ps1 -BaselineMigrations`.** Es un comando genérico que sirve para cualquier base armada
  por fuera de las migraciones: hace el respaldo, verifica que la base coincide con el schema, pide confirmación y
  controla los conteos.
- **2026-11-18: el usuario autoriza que el tester ejecute el baseline en su base local real.** Usa
  `.\dev.ps1 -BaselineMigrations -Yes`, o el procedimiento de `10-procedimiento-baseline.md` si el comando no estuviera
  aprobado. La autorización alcanza **solo** el registro de la migración como aplicada (`prisma migrate resolve
  --applied`), con el respaldo previo y la precondición de diff 0. Si el diff no da 0 o los conteos cambian, el tester
  se detiene y avisa. **No autoriza** `migrate dev`, `reset`, `db push`, `TRUNCATE`, `DROP` ni la restauración del
  respaldo. **Se ejecutó con código 0.**
- **2026-11-18: limpieza de Docker.** Se borró el volumen de prueba `d9e4e4f6…`. Quedan los de otros proyectos, los
  de composes viejos y dos anónimos que no son de prueba (`23a9e9ef…`, de Node, y `70aa28d1…`, de Redis).

## Decisiones vigentes del usuario
- Commit y push autorizados al aprobarse cada feature, sin force. Después se empieza el siguiente feature de
  `docs/features/PLAN-pendientes.md`.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
