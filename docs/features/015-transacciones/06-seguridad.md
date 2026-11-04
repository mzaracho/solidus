# 015 - Revisión de seguridad

Revisor de seguridad, 2026-11-04. Base `9e7f321` + cambios sin commitear. `npx tsc --noEmit` del backend: sin errores.

## Alcance
Toca superficie sensible solo en dos handlers (merge de pacientes, borrado de atención) y un DTO (#70). El resto son tests y helpers.

## Hallazgos
Bloqueantes / críticos / altos: ninguno.

### MENOR-1 - Ventanas residuales ya documentadas (sin cambio)
Alta de atención para el paciente origen durante la fusión, duplicados por "leer y luego insertar": requieren schema (FK Restrict, únicas). Ya están en el BACKLOG (diseño §3.4). Riesgo de integridad, no de aislamiento.

### MENOR-2 - Merge: efecto de `updatedAt` en ambos pacientes
`merge-patient-command.ts` (updateMany de bloqueo, dentro de `$transaction`). Solo cambia `updatedAt`; la API no lo expone. Sin acción.

### MENOR-3 - Cobertura solo contra base simulada
El filtro `NOT` en el `where` de `delete` y el bloqueo por `updateMany` se prueban con fake-prisma. Recomiendo que el tester lo confirme una vez en Postgres real (Prisma 5 acepta filtros no únicos en `delete`; `NOT` con dos campos equivale a NOT(A AND B)).

## Verificación punto por punto
1. Carreras.
   - Merge: la verificación previa usa `inScope(scope)` y `foundOr404`. El `updateMany` interno filtra `id in [source,target]` Y `organizationId: source.organizationId` (organización ya validada contra el scope del llamante). `count !== 2` lanza `resourceNotFound()`, el mismo 404 genérico del 007. No se reabre el aislamiento. El `workItem.updateMany` posterior queda acotado a pacientes ya validados.
   - Borrado: el `where` del `delete` lleva `NOT: { paymentStatus: PAID, paymentDate: { not: null } }`, así una atención cobrada no se borra aunque la cobren entre lectura y borrado. La existencia en la organización se valida antes con `inScope`; los ids son UUID únicos, de modo que no hay forma de borrar una atención de otra organización. Ante P2025 se relee con `{ id, ...inScope(scope) }`: sin fila, `resourceNotFound()` (404 genérico); con fila, 403 con el mismo mensaje de siempre. Un recurso ajeno o inexistente nunca llega a 403 (la verificación previa ya da 404). Otros errores se propagan sin tragarse.
   - El 403 de "cobrada" solo lo ve quien ya tiene la atención en su organización y permiso de borrar; no filtra información de recursos ajenos.
2. Bloqueos / DoS. El `updateMany` de bloqueo exige `organizationId` igual al del scope validado, así que un usuario no puede bloquear filas de pacientes de otra organización (ids ajenos devuelven 404 en la verificación previa, antes de abrir la transacción). Transacciones cortas, sin llamadas externas ni esperas. Un usuario de la misma organización puede serializar fusiones propias; aceptable.
3. #70. `UpdateStaffCommand.canLoadActivities` usa `@IsOptionalNotNull()` + `@IsBoolean()`: `null` da 400. Create no necesita cambio (`?? false`). Hay tests en org-isolation (sección o). M-2 (roles inválidos) ya daba 400.
4. Build. `tsconfig.build.json` excluye `test` y `**/*spec.ts`. `prisma-writes.ts` y `fake-prisma.ts` están en `test/` y no entran en `dist/`. El `transactions-invariants.spec.ts` es spec. Sin dependencias nuevas (usa la API del compilador de TypeScript, ya presente).
5. Secretos / datos. grep de password/secret/bearer/eyJ en los tests y docs nuevos: sin credenciales. Las únicas coincidencias son `POSTGRES_PASSWORD=$pw` / `<New-RandomHex>` en el diseño del 016 (variables/placeholders, valores generados al azar en ejecución). Ids de test son UUID ficticios.
6. Otros cambios en el árbol (`.claude/settings.json`, `global-prefix-config.ts`, `logger-config.ts`, `public-decorator.ts`, `activity-type-commands.ts` DTO): el diff muestra solo avisos de fin de línea (LF/CRLF) salvo comentarios/Swagger de `ActivityTypeRoleDto`; sin cambio funcional de seguridad. Recomiendo igualmente revisar `git diff .claude/settings.json` antes de commitear (regla 12). `.vscode/settings.json` sin versionar: revisar que no contenga datos sensibles antes de agregarlo.

## Conclusión
Los dos cierres de carrera mantienen el aislamiento del 007 y los errores genéricos; no se introduce ninguna superficie nueva.

VEREDICTO: APROBADO
