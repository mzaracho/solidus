# 08 — Documentación: 005-seguridad-backend

> Autor: documentador. Fuentes: `01-spec.md` (criterio 23), `03-diseno-tecnico.md` (§4), `04-implementacion.md`,
> `06-seguridad.md` y `07-testing.md`. Solo se documentó lo verificable en esos reportes y en el código. No se tocó
> código, `.env`, `backend/.env` ni `.claude/settings*.json`. Sin commit ni push.

## Archivos modificados

| Archivo | Versionado | Qué cambió |
|---|---|---|
| `.claude/CLAUDE.md` | sí | Regla 4: los JWT se verifican (guard global, HS256, issuer/audience), identidad desde `sub` con `@CurrentUserId()` (no se lee `x-user-id`), organización validada contra `OrganizationMember` o `Professional` activo (403 si no). Pendientes que siguen abiertos: IDOR por `:id`, `x-mode` del cliente, ADMIN en `ConfigController`, cookie sin HttpOnly, rate limiting. Requisitos de todo endpoint nuevo: autenticado (`@Public()` justificado), organización validada (`@OrgOptional` justificado), pertenencia por `:id`, permisos en backend. Stack: Jest con specs de guards, login, logs, CORS y rutas; el frontend tiene `npm test` (`node --test`). Comandos: Swagger en `/docs` solo con `NODE_ENV` `development`/`test`, `GET /health/liveness`, `CORS_ORIGIN` (generada por `dev.ps1`) y `CORS_EXTRA_ORIGINS` (opcional, sin comodines), `npm test` backend (13 suites) y frontend |
| `docs/auditoria/COMANDOS.md` | sí | Tabla de flags: Swagger en `/docs`; `-Smoke` usa `/health/liveness` (y `/` da 404); `-Docker` con el 3001 fijo y falla si está ocupado. Variable `CORS_EXTRA_ORIGINS`. Sección nueva "CORS y `CORS_ORIGIN`". Aviso de `BIND_ADDRESS=0.0.0.0` actualizado (la API ya exige JWT y organización; sumar el origen a `CORS_EXTRA_ORIGINS`, ejemplo `192.0.2.10`). Errores comunes: `NODE_ENV` heredado distinto de `development`/`test` (p. ej. `local`) se comporta como producción (`/docs` 404, sin logs debug; usar `NODE_ENV=development`); `docker compose build` con el override de la CA desde Git Bash puede fallar por permisos de Bake (usar PowerShell con `COMPOSE_BAKE=false`); puerto 3001 ocupado en `-Docker`. Backend: variables `CORS_*`, Swagger en `/docs`, conteo de tests Jest; frontend: `npm test` (reemplaza "no hay comando de tests") |
| `docs/auditoria/RIESGOS.md` | **no** (ignorado por `.gitignore`) | S1 resuelto; S2 parcial (todo exige JWT y organización; falta ADMIN en `ConfigController`); S5 con nota de lo resuelto (002 y 005); S7 resuelto; S8 y S11 resueltos; "login 500 si faltan campos" resuelto. Sección nueva "Residuales del feature 005" con M-1, M-2, M-3, M-4, B-1, B-2, B-3, B-4, H-2 y H-3. Notas de usuario de humo, `BIND_ADDRESS=0.0.0.0`, dependencias (`next` y `axios` actualizados) y zonas frágiles (headers) puestas al día |
| `docs/auditoria/BACKLOG.md` | sí | Ítems 1, 7, 8 y 9 marcados RESUELTO (feature 005); 2 y 11 marcados PARCIAL con lo que falta; nota en el 14 (Swagger ya hecho). Sección nueva "Candidatos surgidos del feature 005" con los ítems 34 a 39: usuarios con `deletedAt` (M-1), Nest 11 (H-2), `npm audit fix` del frontend (H-3), log de requests fallidos (B-3), límite del body (B-4) y `ProductionController`/`ReportingController` con `userId` por query (B-1) |
| `docs/features/005-seguridad-backend/08-documentacion.md` | sí | Este informe |

## Qué no se actualizó

- **CHANGELOG:** el proyecto no tiene (no hay `CHANGELOG*` en la raíz, `backend/` ni `frontend/`).
- **README de la raíz:** no existe.
- **`backend/README.md` y `backend/README_ES.md`:** no mencionan Swagger en `/`, CORS ni la autenticación; su paso `npx prisma db push` está desactualizado respecto de la regla de migraciones, pero es previo al 005 y ya figura en BACKLOG 32. No se tocaron.
- **`frontend/README*.md`:** no describen sesión ni rutas afectadas; sin cambios.
- **`docs/auditoria/ARQUITECTURA.md` y `ESTADO.md`:** no estaban en la lista del criterio 23; pueden quedar con referencias previas (guards viejos, Swagger en `/`). Se sugiere revisarlas en un feature de documentación.
- **`.claude/settings.json`:** aparece modificado en `git status` desde antes de este trabajo; según `06-seguridad.md` el cambio es solo de fin de línea. No lo toqué.

## Verificaciones

- Los datos citados (13 suites y 141 tests de Jest, 7 tests del frontend, `/health/liveness`, `/docs`, `CORS_ORIGIN`/`CORS_EXTRA_ORIGINS`) salen de 04, 06 y 07 y de `.env.example`/`backend/.env.example`.
- `CORS_METHODS`: en el código es una constante fija de `cors-config.ts`, no una variable de entorno; así quedó documentado.
- Sin secretos, tokens, URLs con credenciales ni datos reales; el único ejemplo de IP es `192.0.2.10`.
- Los archivos conservaron su fin de línea original (CRLF).
