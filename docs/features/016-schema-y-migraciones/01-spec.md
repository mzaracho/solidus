# 016 — Schema de Prisma y migraciones alineados (incluye `User.cuit`)

## Contexto
- **Hallazgo del arquitecto del 015 (prioridad alta):** `backend/prisma/schema.prisma` y las migraciones versionadas
  (`backend/prisma/migrations/`, 8 migraciones, la última `20260422122851_add_professional_status`) no coinciden.
  - Las migraciones no crean `WorkItemParticipant`, `WorkItem.activityTypeId` ni las columnas `ActivityType.baseValue`,
    `cardValue` y `roles`.
  - `WorkItem.coProfessionalId` existe en las migraciones (`20260218175414` y `...457`) pero no en el schema.
  - Un `prisma migrate deploy` sobre una base vacía no permite crear atenciones.
  - La base local del usuario funciona porque se armó por otro camino: probablemente `db push` o los seeds, cosa que la
    regla de CLAUDE.md prohíbe.
- **Pendiente desde el 004:** `User.cuit` está en el schema sin migración.
- **Riesgo operativo:** `prisma migrate dev` detecta la deriva y propone **resetear la base** (borra todos los datos).
  Esto no se puede hacer contra la base local del usuario.

## Historia de usuario
Como responsable de la plataforma, quiero que las migraciones versionadas reproduzcan exactamente el schema, para que
cualquier instalación nueva (`migrate deploy`) quede funcional y para que los cambios de schema futuros sigan la regla 6
sin sorpresas.

## Criterios de aceptación
1. **Relevamiento exacto de la deriva:**
   - el diseño compara, con `prisma migrate diff`, tres cosas: (a) las migraciones aplicadas desde cero, (b) el
     `schema.prisma` y (c) la base local del usuario, solo por introspección de lectura;
   - lista cada diferencia: tablas, columnas, tipos, índices, restricciones, FKs y enums;
   - decide para cada una si el schema es la verdad o la base es la verdad.
2. **Fuente de verdad:**
   - por defecto es el `schema.prisma`, porque el código lo usa;
   - las diferencias en las que la base local tiene algo que el schema no tiene (por ejemplo, `coProfessionalId` con
     datos) se informan al PO antes de borrarlas;
   - **no se pierde ningún dato existente.**
3. **Migración nueva:**
   - una o más migraciones nuevas, generadas con `prisma migrate diff --from-migrations ... --to-schema-datamodel ...
     --script`, que llevan las migraciones al estado del schema;
   - incluye `User.cuit`;
   - no se editan las migraciones ya existentes;
   - la migración tiene que ser aplicable sin error sobre una base que ya tenga esas columnas, como la del usuario. La
     forma de hacerlo la define el arquitecto: `migrate resolve --applied` como baseline en la base local, SQL
     idempotente u otra técnica.
4. **Verificación desde cero:**
   - en un Postgres **descartable y aislado** (un contenedor temporal en otro puerto, eliminado al terminar, nunca el
     volumen del usuario), `prisma migrate deploy` crea un schema idéntico al de `schema.prisma`;
   - `prisma migrate diff --from-url <descartable> --to-schema-datamodel` da vacío;
   - con esa base, el backend arranca y los tests de integración que usan Prisma real, si los hay, pasan.
5. **Base local del usuario:**
   - el procedimiento para marcar la migración nueva como aplicada sin tocar datos queda documentado y probado primero
     en una copia;
   - la copia se hace con `pg_dump` del volumen local hacia un Postgres descartable, y nunca escribe en la base
     original;
   - el tester verifica que después del procedimiento `prisma migrate status` queda limpio y los conteos de la base no
     cambian.
   - **El procedimiento sobre la base real del usuario requiere su confirmación explícita** antes de ejecutarse.
6. **Guardia:**
   - un test o chequeo (Jest o un script de `dev-lib`) falla si el schema y las migraciones vuelven a divergir;
   - por ejemplo, `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code` contra un shadow
     descartable, o una comparación offline si existe;
   - se documenta cómo correrlo y si se suma al CI (feature 026).
7. **`dev.ps1`:** si `-Init` o el arranque aplican migraciones (`migrate deploy`), siguen funcionando sobre la base del
   usuario después del baseline.
8. **Calidad:**
   - `npx prisma validate` sin errores;
   - `npx prisma generate` sin errores;
   - `npx tsc --noEmit` del backend sin errores;
   - `npm test` del backend en verde;
   - tests de `dev-lib` en verde si se toca `dev.ps1`.

## Fuera de alcance
- Cambios funcionales de schema: las restricciones únicas y `onDelete: Restrict` que relevó el 015 van en otro
  feature.
- Seeds reproducibles (#33).

## Riesgos
- **Pérdida de datos** si alguien corre `migrate dev` o `migrate reset` contra la base del usuario. Están prohibidos en
  este feature.
- **Columnas con datos que el schema no tiene:** se consulta al PO y al usuario antes de borrarlas.
- **Docker y puertos:** el Postgres descartable usa un puerto libre (no 3000, 3001, 5433 ni 8080) y se elimina al
  terminar.

## Pasos del flujo
- Requiere UX/UI: **no**.
- Requiere seguridad: **sí, acotado**: que no se exponga el Postgres descartable, que no se filtren credenciales y que
  no haya pérdida de datos.
- Arquitecto: **sí**: relevamiento de la deriva y procedimiento.
- Documentador: **sí**: COMANDOS (procedimiento de baseline y guardia), regla 6 de `CLAUDE.md` y BACKLOG.
- **Cambios de schema:** sí, solo de migraciones, sin cambiar el modelo. Aplica la regla 6.
- **Decisión del usuario requerida** antes de aplicar el baseline en su base local.
- Commit y push: autorizados por el usuario al aprobarse (sin force).

## Salvaguardas específicas
- **Prohibido contra la base del usuario:** `prisma migrate dev`, `prisma migrate reset`, `prisma db push`,
  `TRUNCATE`, `DROP` y `docker compose down -v`.
- **Sobre la base del usuario solo se permite**, hasta que el usuario confirme: introspección de lectura
  (`migrate diff --from-url` y `migrate status`), `SELECT` y `pg_dump` hacia afuera.
- El Postgres descartable va en un contenedor con nombre propio, en un puerto libre y en 127.0.0.1, y se elimina al
  terminar.
- No imprimir valores del `.env` ni URLs con credenciales.
