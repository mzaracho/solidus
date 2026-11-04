# 015 — Transacciones en toda operación que escribe varias tablas

## Contexto
- **BACKLOG #16** pedía `$transaction` en `createActivity`, `MergePatientCommand` y el borrado de staff, y revisar que
  borrar staff no afecte las membresías de otras organizaciones. **Los tres casos ya quedaron cubiertos en el 007**
  (`activity.service.ts`, `merge-patient-command.ts` y `staff-commands.ts`), y la baja de staff ya no afecta a otras
  organizaciones.
- **Regla 5 del proyecto:** las operaciones que escriben varias tablas van dentro de `prisma.$transaction`. Nunca se
  hizo un relevamiento completo. Pueden quedar handlers o servicios con dos o más escrituras fuera de una transacción,
  o con lecturas de verificación separadas de la escritura (TOCTOU). Ejemplos posibles: fee rules con su pagador, alta
  de staff con usuario, membresía y profesional, pagadores con reglas, tipos de actividad con roles, cobros de
  atenciones con splits y settings de la organización.

## Historia de usuario
Como responsable de la plataforma, quiero que ninguna operación deje datos a medio escribir si falla a mitad de camino.

## Criterios de aceptación
1. **Relevamiento:** el diseño lista todos los handlers y servicios que escriben en la base (`create`, `update`,
   `upsert`, `delete`, `createMany`, `updateMany`, `deleteMany` y `$executeRaw`). Indica cuántas escrituras hace cada
   uno y si están en una transacción.
2. **Toda operación con dos o más escrituras va en `prisma.$transaction`** (forma interactiva). También van dentro las
   verificaciones de pertenencia o de estado de las que depende la escritura, cuando dejarlas afuera abre una ventana
   de inconsistencia relevante.
3. **Los servicios que se llaman desde una transacción** (por ejemplo `FeeResolutionService`, que ya recibe un cliente
   opcional desde el 007) usan el cliente de la transacción y no `this.prisma`.
4. **Sin cambios de comportamiento:** las respuestas y los status no cambian, salvo que una operación hoy pueda dejar
   datos parciales; en ese caso, ahora falla entera.
5. **Guardia:** un test o invariante detecta un handler o servicio con dos o más llamadas de escritura a
   `this.prisma.<modelo>` fuera de `$transaction`. Si un análisis estático exacto no es viable, se aproxima por
   heurística con una lista blanca justificada.
6. **Tests:** por cada operación que se mueva a una transacción, un test en el que la segunda escritura falla
   (Prisma mockeado o la base en memoria del 007) y se verifica que no queda nada escrito, o que se llamó a la
   transacción y se propagó el error.
7. **Calidad:**
   - `npx tsc --noEmit` del backend sin errores;
   - ESLint sin errores nuevos en los archivos tocados;
   - `npm test` del backend en verde.
8. **Verificación (tester):** `-Smoke` OK y los conteos de la base sin cambios. Las escrituras se cubren con Jest.

## Fuera de alcance
- Cambiar el nivel de aislamiento de Postgres.
- Reintentos ante deadlocks.
- Cambios de schema.

## Riesgos
- **Transacciones largas** (por ejemplo, con cálculos del motor de honorarios adentro): se mantienen acotadas.
- **Superposición con el 014:** el 014 toca DTOs y handlers. Este feature arranca después de su commit.

## Pasos del flujo
- Requiere UX/UI: **no**.
- Requiere seguridad: **sí, acotado** (TOCTOU y consistencia).
- Arquitecto: **sí, acotado** (relevamiento y lista de cambios).
- Documentador: **sí, acotado**: BACKLOG #16 resuelto (con referencia al 007) y regla 5.
- Cambios de schema: no.
- Commit y push: autorizados por el usuario al aprobarse (sin force).

## Salvaguardas vigentes
- Sin seeds ni SQL de escritura; sin `down -v`, `prune` ni borrar volúmenes; sin stash, reset ni checkout.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
- No imprimir valores del `.env`.
