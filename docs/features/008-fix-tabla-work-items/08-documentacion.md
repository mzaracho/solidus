# 008 — Documentación

## Archivos modificados
- `docs/auditoria/BACKLOG.md`
- `.claude/CLAUDE.md`

No se tocó código, `.env`, `.claude/settings*.json`, README ni CHANGELOG (el feature es solo frontend y no cambia comandos).

## Cambios
- **BACKLOG #44**: marcado RESUELTO (feature 008): `canDeleteActivity` compartida con `AdmisionesTable`, ítem deshabilitado con tooltip. Se anotó en el mismo ítem que el bug de la tabla de work-items vacía ("No results", O-3 del 005) quedó resuelto por el 008. No figuraba en otro ítem.
- **BACKLOG #45 (nuevo)**: `PUT /activity/:id` ignora `grossAmount` y pagador mientras la UI informa éxito (M1); el pagador faltante "—" se reenvía (M2). Decidir si se editan (recalcular splits) o se deshabilitan en la UI. Relacionado con #17 y #40.
- **BACKLOG #46 (nuevo, menor UX)**: tooltip del ítem "Eliminar" deshabilitado no visible (`pointer-events-none`, M3) y "Eliminar" habilitado hasta hidratar el rol (M4).
- **CLAUDE.md** (Convenciones frontend): una línea sobre `canDeleteActivity` (`src/lib/activity-permissions.ts`) y `readSessionIdentity()` (`src/lib/session.ts`), solo presentación; el backend es la autoridad.

## Fuentes
`04-implementacion.md` y `05-revision.md` (M1 a M4).
