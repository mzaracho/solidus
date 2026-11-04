# 011 — Documentación

## Archivos modificados
- `docs/auditoria/BACKLOG.md`: #39 marcado RESUELTO (feature 011), con mención de la eliminación de `PUT /api/profile`
  y del test `(a2)`. Nueva sección "Candidatos surgidos del feature 011" con el #55.
- `docs/auditoria/ARQUITECTURA.md`: ProductionController, ReportingController y ProfileController figuran como eliminados.
- `backend/docs/API_DOCUMENTATION.md` y `backend/docs/API_DOCUMENTATION_ES.md`: quitadas las líneas `GET /my-production`,
  `GET /work-items/reporting` y `GET /profile`. El resto no se tocó.
- `.claude/CLAUDE.md`: una viñeta en Convenciones backend (todo `@Controller` registrado en un módulo; lo vigila `(a2)`).
- `docs/auditoria/RIESGOS.md` (local): B-1 marcado RESUELTO por el 011.

## Qué cambió (verificado en 04-implementacion.md)
Se borraron los controladores no registrados `ProductionController`, `ReportingController` y `ProfileController`
con sus queries/comandos/DTO, y se agregó el test estructural `(a2)` que falla si un controlador de `backend/src/**` no está
registrado en un módulo.

## BACKLOG nuevos
- #55: `LogoutCommandHandler` sin registrar (MENOR-3 de seguridad); a resolver en el feature 017 (cookie HttpOnly).

## Notas
- INFO-3 del 007 no figura como entrada en `RIESGOS.md` (el INFO-3 existente es del 009 y no corresponde); no se modificó.
- No se tocó código, `.env` ni `settings*.json`. Sin commit ni push.
