# Plan de pendientes (orden de ejecución)

Pedido del usuario (2026-11-02): hacer **todos** los pendientes, de a uno. Al aprobarse cada feature se
hace commit y push (sin force) y se empieza el siguiente.

Lo mantiene el PO. Los números con `#` son de `docs/auditoria/BACKLOG.md`.

| Orden | Feature | Ítems | Estado |
|---|---|---|---|
| 1 | 006-usuarios-dados-de-baja | #34 | **Hecho** (`d698615`) |
| 2 | 007-aislamiento-organizaciones | #3, #4, #5 | **Hecho** (`f69b73e`) |
| 3 | 008-fix-tabla-work-items | Bug O-3 del 005, #44 | **Hecho** (`8f65cb5`) |
| 4 | 009-modo-desde-rol | #2 (resto: `x-mode`), #41 | **Hecho** (`f2ecc50`) |
| 5 | 010-logs-y-limites | #37, #38, #14 | **Hecho** (`fad34cd`) |
| 6 | 011-controladores-huerfanos | #39 | **Hecho** (`1c643f5`) |
| 7 | 012-rate-limiting-login | #11 (resto) | **Hecho** (`052a01e`) |
| 8 | 013-errores-sin-details | #13, #42, #53, B-1 y B-2 del 006, I-4 del 010 | **Hecho** (`2155df6`) |
| 9 | 014-validation-whitelist | #12, #43 | En curso (desarrollo) |
| 10 | 015-transacciones | #16 (ya resuelto en el 007), guardia y carreras | Diseño aprobado; arranca tras el 014 |
| 11 | 016-schema-y-migraciones | Schema y migraciones no coinciden (hallazgo del 015), `User.cuit` | Pendiente (**prioridad alta**) |
| 12 | 017-dinero-y-motor-honorarios | #17, #40, #45, pagador borrado con reglas y baja de staff (hallazgos del 015) | Pendiente |
| 13 | 018-cookie-httponly | #10, #55 | Pendiente |
| 14 | 019-test-suite-fuera-de-prod | #15 | Pendiente |
| 15 | 020-docker-hardening | #19, #56 | Pendiente |
| 16 | 021-audit-fix | #36, #25 (`npm audit fix` sin cambios incompatibles), #61 | Pendiente |
| 17 | 022-upgrade-nest | #35, #25 (plan Nest/Prisma) | Pendiente |
| 18 | 023-secretos-historial | #6 (requiere decisión del usuario sobre reescribir el historial) | Pendiente |
| 19 | 024-dev-ps1-node-env | Normalizar `NODE_ENV` (H-1 del tester del 005) | Pendiente |
| 20 | 025-lint-verde | #23, #54, #64, #65 | Pendiente |
| 21 | 026-ci | #24 | Pendiente |
| 22 | 027-tests-backend | #20, #21 | Pendiente |
| 23 | 028-tests-frontend | #22 | Pendiente |
| 24 | 029-permisos-finos | #47, #48, #49, #50, #51, #52, #59, #60, #62, #63, #66 | Pendiente |
| 25 | 030-rate-limit-endurecido | #57, #58 | Pendiente |
| 26 | 031 y siguientes | P3: #26 a #33, #46; restricciones únicas y `onDelete` (hallazgos del 015) | Pendiente |

Nota: desde el 2026-11-04 los números de feature a partir del 016 se corrieron un lugar, porque se adelantó el feature
de schema y migraciones. Las specs ya escritas usan el nombre nuevo.

El orden puede cambiar si una feature revela dependencias. El PO frena y consulta al usuario cuando una tarea
requiere una decisión suya: reescribir el historial, acciones en GitHub o cambios de comportamiento visibles.

Nota operativa: AVG bloqueó `scripts/dev-lib.tests.ps1` (lo puso en cuarentena 3 veces). El usuario agregó la
exclusión de `C:\Repositorios\healthops-gem\scripts\` y lo sacó de la cuarentena (2026-11-04). Si vuelve a
desaparecer, se puede mover el sandbox de los tests (hoy en `%TEMP%\solidus-dev-tests-<GUID>`) a `.dev\`.
