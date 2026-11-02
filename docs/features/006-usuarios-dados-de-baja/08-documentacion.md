# 006 — Documentación

## Archivos modificados
- `docs/auditoria/BACKLOG.md`: ítem #34 marcado RESUELTO (feature 006).
- `docs/auditoria/RIESGOS.md` (local, ignorado por git): M-1 del 005 resuelto por el 006; sección nueva con los
  bajos B-1 (falla de base en el guard responde 500, falla cerrado) y B-2 (`details` en errores, preexistente, BACKLOG 13).
- `.claude/CLAUDE.md`: regla 4, una frase: el guard global responde 401 a usuarios inexistentes o dados de baja
  con una consulta por PK en cada request. Los usuarios dados de baja no figuraban como pendiente, no hubo que quitar nada.

## No tocado
README y CHANGELOG (no existen en la raíz), código, `.env` y `.claude/settings*.json`.
