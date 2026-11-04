# 09 — Cierre: 011-controladores-huerfanos

Fecha: 2026-11-04. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, con **1 vuelta de corrección de 3**. Esa vuelta la decidió el PO para MENOR-1 y
MENOR-2 de seguridad.

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI, arquitecto | — | Omitidos: es un borrado de código muerto |
| Desarrollador | 04-implementacion.md | Completo, con la vuelta 1 |
| Revisor | 05-revision.md | APROBADO; vuelta 1 APROBADO |
| Seguridad | 06-seguridad.md | APROBADO; vuelta 1 APROBADO |
| Tester | 07-testing.md | APROBADO; vuelta 1 APROBADO |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **Rutas eliminadas** (ninguna estaba en uso):
  - `ProductionController` (`GET my-production`) y `ReportingController` (`GET work-items/reporting/*`), con sus
    queries. No estaban registrados y tomaban `userId` de la query.
  - `ProfileController` (`PUT /api/profile`), con su comando y su DTO. Era un mock con el handler sin registrar, que
    respondía 500.
- **Guardia estructural `(a2)` en `test/org-isolation.spec.ts`:**
  - falla si un `@Controller` de `backend/src/**` no está registrado en `AppModule`;
  - la lista blanca está vacía;
  - excluye `main.ts` y `bootstrap.ts`, que arrancan la app al importarse.
- **`security-invariants.spec.ts`:** se quitaron las entradas de las clases borradas y la lista de "no registrados".
  Ahora el control es más estricto.
- **Documentación:**
  - BACKLOG: #39 resuelto y #55 nuevo;
  - ARQUITECTURA;
  - `backend/docs/API_DOCUMENTATION*.md`;
  - `CLAUDE.md`;
  - RIESGOS (local).

## Verificación de los criterios (PO)
| Criterios | Estado |
|---|---|
| 1, 2 | Cumplen; la guardia detectó por nombre los controladores antes del borrado |
| 3 | Cumple: las rutas borradas dan 404 en vivo y las demás no cambian |
| 4 | Cumple: `tsc` y Jest (32 suites, 567 tests) |
| 5 | Cumple: `-Smoke` OK y los conteos sin cambios (9 / 3 / 72 / 324 / 1483) |

## Pendiente
- **#55:** `LogoutCommandHandler` sin registrar (el logout probablemente responde "Handler not found"). Va al 017,
  cookie `HttpOnly`.

## Pasos omitidos
UX/UI y arquitecto, por lo que indica la spec.
