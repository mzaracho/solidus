# 08 - Documentación: 007-aislamiento-organizaciones

Solo se tocó documentación; ningún código, `.env` ni `.claude/settings*.json`. Sin commit ni push.

## Archivos modificados
| Archivo | Cambio |
|---|---|
| `.claude/CLAUDE.md` | Regla 4 reescrita: JWT verificado y aislamiento resuelto; organización solo de `@CurrentOrgId()` / `RequestContext` (lo vigila `security-invariants.spec.ts`), pertenencia por `:id` y de ids referenciados con 404 genérico (`org-resource.ts`), escrituras de `org/*` con ADMIN según el rol de la base, `x-mode` sin permisos. Pendiente: modo derivado del rol (009), cookie HttpOnly, rate limiting. En convenciones backend: patrón de endpoint nuevo (incluye `ID_ROUTE_CASES` en `test/org-isolation.spec.ts` y clasificación de campos `*Id`), política de atenciones en tres líneas con remisión a `00-estado.md`, y nota de que `ConfigController` ya no existe. |
| `docs/auditoria/BACKLOG.md` | #3, #4 y #5 RESUELTO (007); #2 sigue PARCIAL con nota; sección nueva "Candidatos surgidos del feature 007". |
| `docs/auditoria/RIESGOS.md` (local, ignorado por git) | S2, S3 y S4 marcados resueltos con salvedades; M-2 resuelto en gran parte (queda el 009); zona frágil de headers actualizada; sección "Residuales del feature 007". |
| `docs/auditoria/ARQUITECTURA.md` | Fila de `ConfigController` marcada como eliminada (estaba desactualizada). |
| `docs/auditoria/COMANDOS.md` | Sin cambios: no cambió nada operativo ni menciona rutas `/config/*`. |

## Ítems nuevos del BACKLOG (numeración siguiente a la #39)
- **#40** Motor de honorarios: unificar la forma de `splits` (UI vs `FeeResolutionService`) y acotar `FIXED` al bruto (MEDIA-2).
- **#41** `settlements/calculate` con `@CurrentOrgId()` + invariante (MENOR-1); evaluar `@RequireOrgRole('ADMIN')` y acceso por rol del dashboard (INFO-1).
- **#42** Mensajes 404 en español y sin JSON crudo en los toasts (m-4).
- **#43** DTOs con class-validator en comandos de update (S-2 / BAJA-2 resto); relacionado con #12.
- **#44** Ocultar "Eliminar" al MEMBER también en `workload/columns.tsx`, si aplica.

## Residuales registrados en RIESGOS.md
MEDIA-2 (abierto, #40), MENOR-1 (abierto, #41), BAJA-1 (aceptado, decisión 8), INFO-1 (abierto, #41 y 009).
