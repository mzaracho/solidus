# 09 — Cierre: 014-validation-whitelist

Fecha: 2026-11-04. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, con **2 vueltas de corrección de 3**:
- **Vuelta 1:** los menores del revisor y de seguridad, entre ellos M5, que podía hacer fallar la edición de roles
  existentes.
- **Vuelta 2:** la decisión del PO de preservar exactamente la semántica actual de los roles, para que no cambien los
  montos.

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI | — | Omitida |
| Arquitecto | 03-diseno-tecnico.md | APROBADO (lo terminó antes del corte por límite de uso); el PO aceptó las 10 aclaraciones |
| Desarrollador | 04-implementacion.md | Completo, con las vueltas 1 y 2 |
| Revisor | 05-revision.md | APROBADO; vueltas 1 y 2 APROBADO |
| Seguridad | 06-seguridad.md | APROBADO; vueltas 1 y 2 APROBADO |
| Tester | 07-testing.md | APROBADO; los datos existentes se validaron por lectura |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **`RequestValidationPipe` global:**
  - `whitelist` en todo y `forbidNonWhitelisted` en los bodies;
  - `forbidUnknownValues` y sin conversión implícita;
  - los errores no llevan valores del cliente;
  - un campo sobrante recibe un mensaje genérico, sin el nombre de la clave.
- **DTOs:**
  - cada `@Body()` y `@Query()` de la API tiene un DTO con class-validator (20 bodies y 8 queries);
  - los campos que asigna el controlador van con `declare`;
  - helpers: `IsMoney`, `IsOptionalNotNull` y otros;
  - topes: montos, porcentajes, páginas (`MAX_PAGE_NUMBER` 10.000), `limit` hasta 100, participantes y roles hasta 20;
  - un `null` en un campo no nulable da 400;
  - `settings` tiene que ser un objeto.
- **Roles de los tipos de actividad:** `normalizeActivityTypeRoles` mantiene la semántica de lectura de
  `ActivityService` (`isRequired ?? true`, y `feeStrategy` ausente se guarda ausente), así que no cambian los montos.
- **Invariantes:**
  - `test/request-dto-invariants.spec.ts`;
  - en `security-invariants`: no se permite `@Allow(` ni `enableImplicitConversion: true`, y las opciones del pipe
    son obligatorias.
- **Frontend:**
  - builders `src/lib/request-bodies.ts` que espejan los DTOs;
  - un test de contrato con 30 bodies reales, que comparte un fixture con el backend;
  - ya no se manda `?orgId=` en `getOrgConfig`;
  - se valida el monto en `WorkItemForm`;
  - `maxLength` de 100 en las búsquedas.
- **Pendiente del 013:** se borraron los comentarios desactualizados de `WorkItemForm`.
- **Tests:** backend con 42 suites y 773 tests; frontend con 87.
- **Documentación:**
  - `CLAUDE.md`;
  - BACKLOG: #12 y #43 resueltos, nuevos #67 a #70;
  - RIESGOS (local).

## Verificación de los criterios (PO)
| Criterios | Estado |
|---|---|
| 1, 2 | Cumplen en vivo: un sobrante da 400 genérico; tipos incorrectos, ids malformados y paginación fuera de rango dan 400 |
| 3, 4, 5 | Cumplen: invariante sin allowlist; un `userId` o `id` inyectado da 400 |
| 6 | Cumple: el contrato con 30 bodies del front pasa, y los datos existentes validan. **Falta la prueba en navegador** (07-testing, §7) |
| 7, 8 | Cumplen |
| 9 | Cumple: `-Smoke` OK y los conteos sin cambios |

## Pendiente
- **Prueba en navegador:** crear y editar una atención, editar tipos de actividad con roles, settings, pagador y regla,
  y la búsqueda.
- **#70, al 015:** `canLoadActivities` en `null` en `UpdateStaff` da 500 (M-1 de seguridad); test de `null` dentro de
  los roles (M-2); comentarios y Swagger desactualizados en `ActivityTypeRoleDto` (N1); prettier en dos imports (N3).
- **#67:** el mock de `PacientesTable`.
- **#68:** fusionar los settings.
- **#69:** convertir los textos libres en enum.
- **`docs/auditoria/ESTADO.md` (~153):** todavía menciona "ValidationPipe sin whitelist". Es una foto fechada y no se
  actualiza.

## Pasos omitidos
UX/UI.
