# 017 — Documentación

Documentador, 2026-11-18. Solo documentación; no se tocó código ni se hizo commit.

## Qué cambió realmente
Dinero exacto con `Prisma.Decimal` (`money.ts`, guardia `money-invariants`), forma única de splits, edición de monto y
pagador en atenciones no cobradas, fecha de pago obligatoria, 409 al borrar pagadores con reglas o atenciones, baja
lógica de staff con vínculos, migración `20261118120000_fee_rule_payer_restrict` y la guardia `nest-build-compat`.
Conteos finales: backend 52 suites / 936 tests; frontend 129 tests.

## Archivos modificados
- `.claude/CLAUDE.md`: conteos (52 / 936 y 129); tres viñetas en convenciones de backend (dinero y guardia, atenciones
  cobradas y borrados, prohibición de re-exports con alias y `npx nest build`); una viñeta en frontend (fecha de pago,
  edición con campos cambiados, cobro múltiple por id, `getRowId`).
- `docs/auditoria/COMANDOS.md`: `npx nest build` como verificación previa al arranque/Docker y conteo de tests.
- `docs/auditoria/BACKLOG.md`: #17, #40, #45, #75 y #76 marcados RESUELTOS; sección "Candidatos surgidos del feature 017"
  con los ítems #88 a #105.
- `docs/auditoria/RIESGOS.md` (local, ignorado): sección "Residuales del feature 017".
- `docs/features/PLAN-pendientes.md`: fila 11 con `07b43e0`; fila 12 como **Hecho** (sin hash); números nuevos en los
  features 020 (#104), 021 (#103), 024 (#105), 025 (#99), 029 (#95, #96) y 031 y siguientes (#88 a #94, #97, #98, #100 a #102).
- `healthops_functional_spec.md`: sección 6, reglas de cobro y edición, y de borrado de pagadores/staff.

## Notas
- Los mensajes 400 en inglés ya existían como #66: no se duplicó.
- No se modificó el README (no menciona nada afectado).
- Pendiente del PO: agregar el hash del 017 en la fila 12 y recordar incluir `activity-update.service.spec.ts` y demás
  archivos sin versionar (`??`) en el commit.
