# Documentación del feature 014 (ValidationPipe con whitelist y DTOs explícitos)

## Archivos modificados
- `.claude/CLAUDE.md`: bullet nuevo en Convenciones backend (pipe global, DTOs obligatorios, `declare`, prohibiciones,
  helpers, topes); bullet nuevo en Convenciones frontend (builders de `request-bodies.ts` y test de contrato con el
  fixture); conteos de tests actualizados (backend 42 suites / 773; frontend 87).
- `docs/auditoria/BACKLOG.md`: #12 y #43 RESUELTOS (014); la nota sobre `?mode=` pasa a "resuelto"; sección nueva
  "Candidatos surgidos del feature 014" con #67 a #70.
- `docs/auditoria/RIESGOS.md` (local, ignorado por git): INFO-1 del 009 resuelto; sección nueva "Residuales del feature 014".

No se tocaron: `COMANDOS.md` (no trata validación ni formato de requests), código, `.env`, `.claude/settings*.json`.
No existen README ni CHANGELOG en la raíz.

## Qué cambió en la documentación
- Reglas para agentes: `RequestValidationPipe` (whitelist en todo, `forbidNonWhitelisted` en bodies, sin conversión
  implícita, `forbidUnknownValues`, errores sin valores del cliente); todo `@Body()`/`@Query()` con clase validada
  (`test/request-dto-invariants.spec.ts`); `declare` en campos que asigna el controlador; prohibidos `@Allow(` y
  `enableImplicitConversion: true`; `dto-validators.ts`; `MAX_PAGE_SIZE`/`MAX_PAGE_NUMBER`.
- Frontend: builders espejo de los DTOs y fixture `backend/test/fixtures/frontend-request-bodies.json`.
- Riesgos: mass assignment y validación de entrada resueltos; B-1, B-2 y B-3 de seguridad cerrados en la vuelta 1.

## BACKLOG nuevos
- #67 `PacientesTable` mock que manda un array a `POST activity` (decisión 2).
- #68 `PUT org` reemplaza el JSON de settings en vez de fusionar (decisión 3).
- #69 `paymentMethod` y otros textos libres a enum (decisión 7).
- #70 Menores para el feature 015: M-1 (canLoadActivities null en UpdateStaff, 500), M-2 (test de `null` en roles),
  N1 (comentarios/Swagger de `ActivityTypeRoleDto`), N3 (prettier en dos imports).
- `RetroactiveModal` ya está en #45.

## Notas
- Los números de tests salen de 04-implementacion.md (vuelta 2). Tras el commit, `docs/auditoria/ESTADO.md` (línea ~153)
  todavía lista "ValidationPipe sin whitelist" como zona frágil: no se tocó por no estar en el pedido.
