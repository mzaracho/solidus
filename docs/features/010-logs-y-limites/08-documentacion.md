# 08 — Documentación: 010-logs-y-limites

## Qué cambió en el código (según 04 y los reportes)
- Log de acceso de una línea por request (`METHOD ruta STATUS Nms`), sin query ni datos sensibles, `warn` para 4xx y 5xx; incluye 401/403 de los guards.
- Límite del body configurable con `BODY_SIZE_LIMIT` (default 1mb, máximo 10mb, formato `<número>[b|kb|mb]`; inválido = el backend no arranca). 400, 413 y 415 del parser con respuesta genérica.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` prohibida: el backend no arranca; `dev.ps1 -Init` la quita de `backend/.env` y avisa una vez.

## Archivos de documentación modificados
- `docs/auditoria/COMANDOS.md`: corregido "default 50mb" por el límite real; nota de `NODE_TLS_REJECT_UNAUTHORIZED`; fila nueva en "Errores comunes"; sección nueva "Log de acceso y errores del body"; conteo de Jest a 32 suites, 567 tests. No figuraba el conteo de dev-lib (1026), por eso no se agregó.
- `.claude/CLAUDE.md`: línea breve en Comandos (`BODY_SIZE_LIMIT`, TLS prohibida, línea de acceso); Jest de 30 a 32 suites.
- `docs/auditoria/BACKLOG.md`: #37, #38 y #14 marcados RESUELTOS; notas del 010 (I-4 manejador final genérico, relacionado con #13; I-2 UUID en el log y retención; `BODY_SIZE_LIMIT` configurable en el compose). No se numeraron ítems nuevos: quedaron como notas.
- `docs/auditoria/RIESGOS.md` (local, ignorado por git): B-3, B-4, S14, S16 y la referencia en S7 marcados resueltos por el 010; residuales I-2 e I-4.

## Sin cambios
README (no menciona estos temas), `.env.example` (ya los había actualizado el desarrollador). No se tocó código, `.env` ni `.claude/settings*.json`. Sin commit ni push.

## BACKLOG nuevos
Ninguno numerado (notas bajo "Candidatos surgidos del feature 005").
