# 013 — Documentación

Redactor técnico. Solo documentación; no se tocó código, `.env` ni `.claude/settings*.json`. Sin commit ni push.

## Archivos modificados
- `.claude/CLAUDE.md`: convención backend de errores (contrato `{ code, errors: [{ message }] }` sin `details` en
  `filters/error-contract.ts`; excepciones de Nest con `{ code, message }` en español; sin `throw new Error` salvo lista
  blanca de `security-invariants.spec.ts`; 401/403/404 genéricos; 400 `validation-failed`; 5xx genérico con
  `X-Error-Id`; Prisma solo clase y código). Convención frontend (`toApiError`/`errorMessageOf`,
  `API_ERROR_MESSAGES`, nunca el cuerpo crudo). Conteos: backend 39 suites / 682 tests, frontend 53 tests.
- `docs/auditoria/BACKLOG.md`: #13, #42 y #53 marcados RESUELTOS (013); nota de I-4 del 010 corregida (los errores de
  `next(err)` los toman los filtros de Nest; igual se agregó `finalErrorHandler`); sección nueva "Candidatos surgidos del
  feature 013".
- `docs/auditoria/RIESGOS.md` (local, ignorado por git): B-2 del 005, B-1/B-2 del 006 e I-4 del 010 resueltos;
  sección de residuales del 013 (B-2, B-3).
- `docs/auditoria/COMANDOS.md`: nota sobre el formato de error y cómo buscar un 500 por `X-Error-Id` en el log.

## BACKLOG nuevos (59 a 66)
59 P2002/P2003 de Prisma como 409; 60 403 de "atención cobrada" a 409; 61 quitar `axios` y `@nestjs/axios`; 62 B-2
(CUIT de organización enumera entre organizaciones); 63 B-3 (log de `error.message` no Prisma en producción); 64 M-4
(test del orden init/finalErrorHandler en el bootstrap real); 65 M-5 (acoplamiento body-parser-config y
error-contract); 66 mensajes de validación de class-validator en inglés.

## Notas
- Los textos de B-2/B-3 y M-4/M-5 se tomaron del encargo del PO; no los contrasté línea a línea con 05/06.
- El README no describe el formato de error, no se tocó.
