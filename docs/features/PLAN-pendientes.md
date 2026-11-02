# Plan de pendientes (orden de ejecución)

Pedido del usuario (2026-11-02): hacer **todos** los pendientes, de a uno. Al aprobarse cada feature se
hace commit y push (sin force) y se empieza el siguiente.

Lo mantiene el PO. Los números con `#` son de `docs/auditoria/BACKLOG.md`.

| Orden | Feature | Ítems | Estado |
|---|---|---|---|
| 1 | 006-usuarios-dados-de-baja | #34 | **Hecho** (`d698615`) |
| 2 | 007-aislamiento-organizaciones | #3, #4, #5 | **Hecho** (`f69b73e`) |
| 3 | 008-fix-tabla-work-items | Bug O-3 del 005, #44 | **Hecho** (commit en curso) |
| 4 | 009-modo-desde-rol | #2 (resto: `x-mode`), #41 | En curso |
| 5 | 010-logs-y-limites | #37, #38, #14 (resto: `NODE_TLS_REJECT_UNAUTHORIZED`) | Pendiente |
| 6 | 011-controladores-huerfanos | #39 | Pendiente |
| 7 | 012-rate-limiting-login | #11 (resto) | Pendiente |
| 8 | 013-errores-sin-details | #13, #42, y B-1 y B-2 del 006 | Pendiente |
| 9 | 014-validation-whitelist | #12, #43 | Pendiente |
| 10 | 015-transacciones | #16 | Pendiente |
| 11 | 016-dinero-y-motor-honorarios | #17, #40, #45 | Pendiente |
| 12 | 017-cookie-httponly | #10 | Pendiente |
| 13 | 018-test-suite-fuera-de-prod | #15 | Pendiente |
| 14 | 019-docker-hardening | #19 | Pendiente |
| 15 | 020-audit-fix | #36, #25 (`npm audit fix` sin cambios incompatibles) | Pendiente |
| 16 | 021-upgrade-nest | #35, #25 (plan Nest/Prisma) | Pendiente |
| 17 | 022-secretos-historial | #6 (requiere decisión del usuario sobre reescribir el historial) | Pendiente |
| 18 | 023-dev-ps1-node-env | Normalizar `NODE_ENV` (H-1 del tester del 005) | Pendiente |
| 19 | 024-migracion-user-cuit | `User.cuit` sin migración | Pendiente |
| 20 | 025-lint-verde | #23 | Pendiente |
| 21 | 026-ci | #24 | Pendiente |
| 22 | 027-tests-backend | #20, #21 | Pendiente |
| 23 | 028-tests-frontend | #22 | Pendiente |
| 24 | 029 y siguientes | P3: #26 a #33, #46 | Pendiente |

El orden puede cambiar si una feature revela dependencias. El PO frena y consulta al usuario cuando una tarea
requiere una decisión suya: reescribir el historial, acciones en GitHub o cambios de comportamiento visibles.
