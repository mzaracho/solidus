# 015 — Documentación

Documentador, 2026-11-04. Sin cambios de código, `.env` ni `.claude/settings*.json`. Sin commit ni push.
Fuentes: 04-implementacion, 05-revision, 06-seguridad, 07-testing (45 suites, 815 tests).

## Archivos modificados
| Archivo | Cambio |
|---|---|
| `.claude/CLAUDE.md` | Regla 5: toda operación con 2 o más escrituras va en `prisma.$transaction(async (tx) => …)` (arreglo prohibido), usar `tx` y no `this.prisma`, servicios auxiliares con `db: Prisma.TransactionClient = this.prisma`; lo vigila `src/transactions-invariants.spec.ts` (analizador `test/helpers/prisma-writes.ts`). Conteo de Jest: 45 suites / 815 tests (no quedaba ningún "13 suites" en la guía). |
| `docs/auditoria/BACKLOG.md` | #16 y #70 marcados RESUELTO. Sección nueva "Candidatos surgidos del feature 015" con los ítems 71 a 77. |
| `docs/auditoria/RIESGOS.md` (local, ignorado) | Fusión de pacientes sin transacción tachada como resuelta; zona frágil de `activity.service.ts` actualizada; sección "Residuales del feature 015". |
| `docs/auditoria/COMANDOS.md` | Solo el conteo de `npm test` (35/616 pasó a 45/815); no menciona transacciones. |

## Números nuevos de BACKLOG
- 71: limitaciones del detector `prisma-writes.ts` (al 025).
- 72: deadlock en fusiones cruzadas A→B y B→A (500).
- 73: restricciones únicas faltantes y `onDelete: Restrict` en `WorkItem.activityType`/`patient`.
- 74: ventana residual de alta de atención para el paciente origen durante la fusión.
- 75: borrar pagador con fee rules (409 provisional, al 017).
- 76: borrado físico de staff participante o beneficiario de splits (500, al 017).
- 77: Dockerfile `migrate deploy; start:prod` con `;` (al 020).
