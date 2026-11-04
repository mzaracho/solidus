# 04 - Implementacion: 009-modo-desde-rol

Dos sesiones del desarrollador: la 1 (cortada por limite de uso) hizo el backend casi completo; la 2 (esta) revisó,
arregló lo pendiente y completó el frontend. Sin commit, push, stash, reset ni checkout. Sin schema ni migración.

## Pasos del plan (03, §9)
| Paso | Estado | Sesión |
|---|---|---|
| 1 Tests de caracterización de montos | `find-all-activities.spec.ts` (nuevo) y casos de `dashboard.service.spec.ts` | 1 |
| 2 Pieza pura `view-mode.ts` + spec (matriz) | hecho | 1 |
| 3 Contexto y guard: `getActiveProfessionals`/`getOrgType`, decorador, `ViewModeGuard`, `RequestContext.view`/`requireViewScope`, tercer `APP_GUARD`, `guard-chain.spec.ts`, stubs | hecho | 1 |
| 4 Listados de actividad | `@UsesViewMode()`, handler con `ctx.view`, sin `@Query('mode')` | 1 |
| 5 Dashboard | `@UsesViewMode({ orgRole: 'ADMIN' })`, servicio con `view`; sin `mode`/`userId` | 1; **ahora** arreglé 2 errores de tsc en `dashboard-controller.ts` (`startDate/endDate` opcionales -> `as string`) |
| 6 Pacientes | `includeCurrentOrg`, `PatientsService.findAll(filter, view, opts)` | 1 |
| 7 Carga | `createActivity(dto, mode, scope)`, regla org en T, sin `@Headers('x-mode')` | 1 |
| 8 Liquidaciones | `@RequireOrgRole('ADMIN')` + `OrgRoleGuard`, `@CurrentOrgId()`, `organizationId` opcional y oculto, `requireOrgId`, `calculate-settlements.spec.ts` | 1 (verificado ahora) |
| 9 Invariantes | `x-mode` solo en guard/CORS/comentarios, sin `query.mode` etc., sin campo `mode`, `isProfessionalMode` acotado, campos `controller` asignados por el controlador | 1 |
| 10 Integración | `fake-prisma` con `some`, seed nuevo, secciones (j) matriz, (k) financieros, (l) estructural, (m) valores de modo, (n) lecturas por id y multi-organización | 1; **ahora** verifiqué que quedó completo y verde |
| Decisión 7 (00-estado) | `FindActivityByIdQuery` y `assertPatientReadable` (nuevo, `patient-read-access.ts`) en resumen y deuda: sin membresía solo lo propio / atendido (o todo con `canLoadActivities`), si no 404 genérico | 1 |
| 11 Frontend | ver abajo | **ahora** |
| 12 Calidad | ver abajo | **ahora** |

## Matriz implementada (`resolveViewMode`, 03 §4.2; ruta común / financiera con `orgRole: ADMIN`)
| Vínculos en X | Pide org | Pide pro | Sin pedido |
|---|---|---|---|
| ADMIN | org / org | 403 / 403 | org / org |
| MEMBER | org / 403 | 403 / 403 | org / 403 |
| Solo Professional | 403 / 403 | pro / pro | pro / pro |
| ADMIN + Professional | org / org | pro / pro | org / org |
| MEMBER + Professional | org / 403 | pro / pro | org / pro |
| ADMIN de SOLO_PRACTICE sin Professional | org / org | pro (vacío) / pro | org / org |
Valor desconocido, repetido o header distinto de query: 400 `invalid-mode`. Rutas marcadas: `GET/POST activity`,
`GET dashboard/{kpis,chart,payers}` (ADMIN), `GET v1/patients`. `settlements/calculate`: ADMIN siempre.

## Archivos
Creados (backend): `view-mode.ts`(+spec), `view-mode-decorator.ts`, `view-mode-guard.ts`(+spec), `org-access.service.spec.ts`,
`find-all-activities.spec.ts`, `calculate-settlements.spec.ts`, `patients.service.spec.ts`, `patient-read-access.ts`.
Modificados (backend): controladores activity/dashboard/patients/settlements, queries de actividad/dashboard/pacientes/settlements,
`create-activity.dto`, `activity.service`(+spec), `dashboard.service`(+spec), `patients.service`, `org-access.service`,
`auth-context`, `request-context`(+spec), `guard-provider`, `app-module`, `guard-chain.spec`, `app.constants`,
`find-all-patients-filter`, `i-patient-service`, `security-invariants.spec`, `test/helpers/{fake-prisma,scope}.ts`,
`test/org-isolation.spec.ts`, specs de handlers de activity y patients.
Frontend creados: `src/lib/view-mode.ts`, `src/lib/view-mode.test.mts`.
Frontend modificados: `lib/constants.ts` (`VIEW_MODE`, `ORG_ROLE`, `APP_ROLE_CODE`), `services/data.ts`, `services/api-routes.test.mts`,
`components/layout/Sidebar.tsx`, `work-items/page.tsx`, `PacientesTable.tsx`, `AtencionesTable.tsx`, `PayerRulesManager.tsx`, `package.json` (test suma `view-mode.test.mts`).
Eliminados: ninguno por mí.

## Frontend (ahora)
- `data.ts`: `createWorkItem` saca `mode` del body (`const { mode, ...body }`) y lo manda solo en `x-mode`; `getFeeRules(slug, ctx?)` sin `?mode=` (3 llamadas ajustadas); `calculateSettlements` sin `organizationId` y sin los dos `getOrgDetails`. `getDashboardStats`, `getWorkItems`, `getPatients` siguen mandando `?mode=` como preferencia.
- `lib/view-mode.ts`: `allowedViewModes({orgRole, roles, professionalId})`, `pickViewMode`, `canSeeRestrictedLinks` (solo ADMIN).
- `Sidebar.tsx`: selector "Ver como" según `allowedViewModes`; corrección automática de la vista guardada con `pickViewMode` (reemplaza "un solo código"); enlaces `restricted` (Dashboard org, Liquidaciones, Reglas y Ajustes de org) ocultos y con redirección para todo `orgRole` distinto de ADMIN.
- `work-items/page.tsx`: un `ApiForbiddenError` no de organización se muestra como tabla vacía; el de organización sigue a `/sin-acceso`.
- El token no trae `professionalId` en el store, así que `allowedViewModes` se alimenta de `orgRole` y `roles`.

## Tests y calidad
- Backend: `npx tsc --noEmit` 0 errores. `npx jest`: 30 suites, 517 tests, verde.
- Frontend: `npx tsc --noEmit` 0 errores; `npm test` 35/35 (5 archivos); `npm run build` OK.
- ESLint (solo archivos tocados): sin errores nuevos de lógica. Quedan los preexistentes (`no-explicit-any` en `data.ts`/Sidebar, `no-unsafe-*`/`no-unused-vars` en queries y services) y ruido de `prettier/prettier`: los archivos del backend tienen finales de línea mezclados y muchos errores prettier ya existían; NO corrí `prettier --write` para no reescribir archivos enteros (queda para el revisor decidir). Warnings nuevos de `exhaustive-deps` en el Sidebar (mismo patrón que el código previo).
- Tests agregados/ajustados: ver tabla de pasos. Sección (e) de org-isolation ajustada (`x-mode: org` sin membresía en el destino = 403). `api-routes.test.mts`: x-mode solo en createWorkItem, sin `mode=` en getFeeRules, sin `organizationId=` en settlements, sin `mode` en el body.

## Desvíos y pendientes para el PO
1. **`scripts/dev-lib.tests.ps1` figura borrado (`D`) en el árbol de trabajo.** No lo toqué ni sé de dónde viene (ajeno a este feature; no lo restauré porque checkout está prohibido). Revisar antes del commit: hay que restaurarlo o confirmar que es intencional.
2. Prettier: sin formatear (ver Calidad).
3. El front no tiene `professionalId` en el store; si se quiere, hay que hidratarlo desde el token. Hoy basta el código de rol `PROFESSIONAL`.
4. Pendientes ya decididos por el PO: aclaraciones 8, 9 y 11 y opción B de 1 al BACKLOG (documentador).
5. Sin tocar los ajenos (5 `config/app`, `public-decorator`, `.claude/settings.json`, `.vscode/`, `frontend/AGENTS.md`).

## Notas
- Revisor: confirmar que ninguna ruta que dependa del modo quedó sin `@UsesViewMode` (el test (l) fija el conjunto) y el criterio de prettier.
- Seguridad: modo solo en `ViewModeGuard`; `Professional` con `deletedAt` ya no cuentan; lecturas por id sin membresía devuelven el 404 genérico; settlements exige ADMIN y toma la org del contexto.
- Tester: probar en vivo la matriz con A (ADMIN), M (MEMBER) y P; MEMBER sin Professional pidiendo pro = 403; verificar en navegador que el MEMBER no ve Dashboard/Liquidaciones y que la vista guardada se corrige. Captura previa de montos (03 §8.3) no hecha en esta sesión (sin stack); los montos quedan cubiertos por los specs de valores conocidos.

Cómo probar: `cd backend && npx tsc --noEmit && npx jest`; `cd frontend && npx tsc --noEmit && npm test && npm run build`.

## Vuelta de corrección 1
Sin commit, push, stash, reset ni checkout; sin schema. Se corrigen MEDIA-1, BAJA-3 y los menores 1, 3 y 4.

### MEDIA-1 (datos de otros profesionales para quien no es miembro)
- `patient-read-access.ts`: `assertPatientReadable` ahora devuelve `string[] | null`. `null` = miembro (sin cambios).
  Sin membresía devuelve los ids de SUS Professional activos de la organización del paciente, también con
  `canLoadActivities` (el permiso de carga sigue dando acceso al paciente, pero no a montos ajenos). Nuevo helper
  `ownProfessionalsFilter(ids)` (propias o como participante).
- `get-patient-summary-query.ts`: `items` y `totalDebt` filtrados con ese helper. `get-debt-query.ts` pasa los ids a
  `getDebt(id, professionalIds?)` (`IPatientService`, `PatientsService.getDebt/calcDebt`).
- Listado de pacientes en pro (`PatientsService.findAll`): se leen las membresías del usuario; para pacientes de una
  organización donde NO es miembro, `debt` y `lastVisit` se calculan solo sobre sus Professional.
- Tests: `patients.service.spec.ts` (deuda y última visita acotadas sin membresía, completas con membresía, `getDebt`),
  `patients-handlers.spec.ts` (resumen/deuda acotados con y sin permiso de carga, miembro sin acotar) y
  `test/org-isolation.spec.ts` (nueva atención de otro profesional sobre `ptA2`, monto 7777: el profesional sin
  membresía ve solo la suya y 30 de deuda, con y sin permiso de carga; el miembro ve 7807).
### BAJA-3
- `patients.service.ts`: `soloOrgs` sale de las membresías con `role === 'ADMIN'` y `organization.type === 'SOLO_PRACTICE'`
  (una sola consulta a `organizationMember`). Tests en `patients.service.spec.ts` (MEMBER fuera, ADMIN dentro).
### Menores
- 1: `dashboard-controller.ts` `payers` usa `GetDashboardPayerDistributionQuery` como tipo de `@Query()` (pasa por
  ValidationPipe, sin `Object.assign` ni casts); el front siempre manda `startDate` y `endDate`. Se quitó el import
  `DashboardKpiQueryDto`, que quedó sin uso.
- 3: línea en blanco sobrante en `create-activity-command.ts`; `prettier --write` solo sobre `view-mode.spec.ts` y
  `view-mode-guard.spec.ts` (nuevos).
- 4 (opcional): `Sidebar.tsx` con `useMemo` para `allowedModes`; desaparece el aviso de `exhaustive-deps` de ese efecto.

### Archivos tocados en esta vuelta
Backend: `api/controllers/v1/dashboard/dashboard-controller.ts`, `application/features/activity/commands/create-activity-command.ts`,
`application/features/patients/{patient-read-access.ts, queries/get-debt-query.ts, queries/get-patient-summary-query.ts, patients-handlers.spec.ts}`,
`domain/features/patients/service/i-patient-service.ts`, `infrastructure/features/patients/{patients.service.ts, patients.service.spec.ts}`,
`infrastructure.bootstrap/config/core/authentication/view-mode.spec.ts`, `infrastructure.bootstrap/guards/view-mode-guard.spec.ts`,
`test/org-isolation.spec.ts`. Frontend: `components/layout/Sidebar.tsx`.

### Calidad
- Backend: `npx tsc --noEmit` sin errores; `npx jest` 30 suites, 525 tests en verde. ESLint solo en archivos tocados: sin
  errores de lógica nuevos (quedan los `prettier/prettier` y `no-unsafe-*` preexistentes).
- Frontend: `npx tsc --noEmit` sin errores; `npm test` 35/35; `npm run build` OK. ESLint de Sidebar: queda el
  `no-explicit-any` preexistente.
- Nota de diseño: `patients.service.ts` (infraestructura) importa `ownProfessionalsFilter` de `application/`; si el
  revisor prefiere, se mueve a `domain/`.
