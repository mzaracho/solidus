# 05 - Revisión: 009-modo-desde-rol

Revisor, 2026-11-04. Solo lectura: no se editó código ni se ejecutó `dev.ps1`, SQL, stash, reset, checkout, commit ni push. Del `.env` no se leyó nada.
Entradas: `.claude/CLAUDE.md`, `00-estado.md` (decisiones 1 a 11), `01-spec.md`, `03-diseno-tecnico.md`, `04-implementacion.md`, `git diff` (último commit `8f65cb5`) y los archivos nuevos. Se ignoró lo ajeno indicado (5 `config/app/*.ts`, `public-decorator.ts`, `.claude/settings.json`, `.vscode/`, `frontend/AGENTS.md`, `PLAN-pendientes.md`, `scripts/dev-lib.tests.ps1`).

## Resultados de las verificaciones

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` backend | 0 errores |
| `npx tsc --noEmit` frontend | 0 errores |
| `npx jest` backend | 30 suites, 517 tests, verde |
| `npm test` frontend | 35/35, verde |
| `npm run build` frontend | OK |
| ESLint backend (archivos tocados, comparado contra `HEAD` archivo por archivo) | **Ningún error nuevo de lógica** (`no-unsafe-*`, `no-unused-vars`, `no-unnecessary-type-assertion`: delta 0). Solo cambia `prettier/prettier` (detalle en MENOR-2) |
| ESLint backend, archivos NUEVOS (10) | 0 errores |
| Prettier, archivos NUEVOS | 8 de 10 conformes. `view-mode.spec.ts` y `view-mode-guard.spec.ts` solo difieren en finales de línea (CRLF); el contenido formatea igual |
| ESLint frontend (archivos tocados vs `HEAD`) | Sin errores nuevos. `Sidebar.tsx` suma 2 advertencias `react-hooks/exhaustive-deps` (ver MENOR-4); `data.ts` baja un `no-unused-vars` |

## Cumplimiento de los 12 criterios

| # | Criterio | Estado |
|---|---|---|
| 1 | Relevamiento en el diseño | Cumple (03 §2). Verificado contra el código: no quedan lecturas de `mode`/`x-mode` fuera del guard |
| 2 | Modo único en el servidor + invariante | Cumple. `ViewModeGuard` (tercer `APP_GUARD`) es el único lector de `x-mode` y `?mode=`; `request.viewAccess` -> `RequestContext.view`; los handlers usan `requireViewScope(ctx)` y fallan cerrado (403) si falta el decorador. Invariantes en `security-invariants.spec.ts` (lista blanca de `x-mode`, sin `query.mode`/`command.mode`/etc., sin campo `mode` en clases, `isProfessionalMode` acotado) |
| 3 | `mode=org` sin membresía: 403 | Cumple (`view-mode.ts:resolveViewMode`, sección (j) de `org-isolation`) |
| 4 | `mode=pro` sin `Professional`: 403 | Cumple, con la excepción documentada `SOLO_PRACTICE` ADMIN |
| 5 | Financieros solo ADMIN | Cumple. Dashboard por `@UsesViewMode({ orgRole: 'ADMIN' })` (rol de la base, solo cuando el modo efectivo es org, por lo que el dashboard pro del `MEMBER`+`Professional` sigue vivo); `settlements/calculate` por `@RequireOrgRole('ADMIN')` + `OrgRoleGuard` |
| 6 | `settlements/calculate` con `@CurrentOrgId()` | Cumple. El controlador pisa `query.organizationId`; el handler usa `requireOrgId`; `ID_FIELDS` pasa a ser verdad y un invariante nuevo (campos `controller` asignados por el controlador) cubriría la regresión |
| 7 | Montos sin cambios | Cumple. Las fórmulas de `find-all-activities-query.ts`, `dashboard.service.ts` y `activity.service.ts` no cambian (solo `isProfessionalMode(x) && proIds.length>0` pasa a `view.mode==='pro'`, equivalente porque con `proIds` vacío se retorna antes). Specs con valores conocidos: `find-all-activities.spec.ts` (nuevo) y casos nuevos en `dashboard.service.spec.ts` |
| 8 | Frontend | Cumple (ver sección Frontend) |
| 9 | Tests | Cumple: matriz pura (`view-mode.spec.ts`), guard (`view-mode-guard.spec.ts`), servicio (`org-access.service.spec.ts`), integración con `AppModule` real (secciones (j) a (n) de `org-isolation.spec.ts`), invariantes, `node --test` del front |
| 10 | Calidad | Cumple (tabla de arriba) |
| 11 | Verificación en vivo | Pendiente del tester |
| 12 | Sin schema | Cumple (sin migración) |

## Conformidad con las decisiones del PO (00-estado)

1. **MEMBER sigue viendo montos por atención:** sin cambios. OK.
2. **Vista pro por `Professional` activo en cualquier organización:** `getActiveProfessionals(userId)`; en pro solo se leen filas atadas a esos ids tomados de la base. No reabre el aislamiento del 007. OK.
3. **403 sin degradar:** `resolveViewMode` devuelve `null` y el guard responde `forbidden` (mismo cuerpo que un rol insuficiente); valores desconocidos, repetidos o header distinto de query dan 400 `invalid-mode`. OK.
4. **`deletedAt` no nulo deja de contar:** `deletedAt: null` y `user.deletedAt: null` en `getActiveProfessionals`. OK.
5. **Pacientes en pro:** `includeCurrentOrg` (membresía o `canLoadActivities` en esa organización) en `find-all-patients-query.ts` y `patients.service.ts`. OK.
6. **`POST /activity` con `x-mode: org` sin membresía en el destino:** 403 en `activity.service.ts` (paso 2). OK.
7. **Lecturas por id sin membresía:** `find-activity-by-id-query.ts:38` (solo su `Professional` como principal o participante) y `patient-read-access.ts` (resumen y deuda: pacientes atendidos, o todos con `canLoadActivities`); lo ajeno da `resourceNotFound()`, el mismo 404 del 007. OK.
8, 9, 11. Al BACKLOG: no se tocaron (correcto).
10. **MEMBER de práctica propia sin `Professional` que pide pro:** 403 (el `soloPracticeAdmin` exige `ADMIN`). OK.

## Hallazgos

### BLOQUEANTE
Ninguno.

### MAYOR
Ninguno.

### MENOR

**MENOR-1. Cast en `dashboard-controller.ts:46-47` (evaluación pedida).**
`q.startDate = query?.startDate as string;` y `q.endDate = query?.endDate as string;`. El cast es funcionalmente inocuo: el servicio `getPayerDistribution` ya acepta `string | undefined`, y el comportamiento es el mismo que antes (`Object.assign` desde un `any`). Pero miente: `GetDashboardPayerDistributionQuery.startDate/endDate` están declaradas obligatorias (`@IsString()`) y el parámetro inline `{ startDate?: string; endDate?: string }` no pasa por `ValidationPipe` (el metatype es `Object`), así que esas validaciones nunca se ejecutan en esta ruta. Ventaja colateral: se dejó de copiar con `Object.assign` cualquier clave del cliente (`mode`, `userId`) al query. Sugerencia: reemplazar el tipo inline por `@Query() query: GetDashboardPayerDistributionQuery` (o un DTO) y asignar `query.orgId = orgId`, o al menos declarar `startDate?`/`endDate?` en la clase y quitar los casts. Aceptable dejarlo así en este feature.

**MENOR-2. Decisión de no correr prettier (evaluación pedida).**
Es razonable: `npm run lint` reescribe archivos enteros, hay finales de línea mezclados (LF/CRLF) y centenares de errores previos; formatear mezclaría ruido con el cambio. Pero el feature no solo arrastra EOL: **agrega** errores `prettier/prettier` en líneas tocadas (delta por archivo contra `HEAD`):
- `application/features/activity/queries/find-activity-by-id-query.ts` +23 (el bloque nuevo de las líneas 36-58 usa sangría de 4 espacios, igual que el resto de ese archivo, que ya no cumplía);
- `test/org-isolation.spec.ts` +75, `dashboard.service.spec.ts` +11, `patients-handlers.spec.ts` +4, `security-invariants.spec.ts` +4, `calculate-settlements-query.ts` +4, `fake-prisma.ts` +3, `activity-handlers.spec.ts` +2, `create-activity.dto.ts` +1, `get-patient-summary-query.ts` +1;
- baja en `activity-controller.ts` (-2), `dashboard-controller.ts` (-1), `find-all-activities-query.ts` (-3), `get-dashboard-payer-dist-query.ts` (-2), `activity.service.ts` (-2), `dashboard.service.ts` (-3), `i-patient-service.ts` (-1), `patients.service.ts` (-1).
Ninguno afecta lógica. Sugerencia: aceptar la decisión y dejar un ítem de BACKLOG para normalizar EOL y formatear con un commit aparte; mientras tanto, los dos `.spec.ts` nuevos con CRLF conviene guardarlos en LF.
Relacionado: `create-activity-command.ts:114` quedó una línea en blanco antes del `}` de la clase al quitar el campo `mode`.

**MENOR-3. `ViewScope.requested` sin consumidores.**
`request-context.ts:~22` y `auth-context.ts` exponen `requested` ("solo informativa"), pero ningún handler lo lee. Sugerencia: mantenerlo solo si el tester o el logging lo usan; si no, eliminarlo (superficie mínima).

**MENOR-4. `Sidebar.tsx:106` dependencia `allowedModes.join(',')`.**
El efecto de corrección de la vista guardada depende de una cadena derivada y omite `allowedModes`/`pickViewMode` de las dependencias: suma advertencias `react-hooks/exhaustive-deps` (de 1 a 3). Funciona, pero conviene `useMemo` sobre `allowedModes` y poner la lista como dependencia. Además, el `orgRole` del token es el de la **primera** membresía: con varias organizaciones puede no coincidir con la de la URL (residual 8 de las decisiones, al BACKLOG; el backend responde 403 y el toast existente lo cubre).

**MENOR-5. Invariante "campo controller asignado" por expresión regular.**
`security-invariants.spec.ts` (test "cada campo controller de ID_FIELDS...") acepta cualquier `.campo =` dentro del archivo del controlador, aunque sea de otra clase. Es una barrera razonable (habría detectado el MENOR-1 del 007) pero con falsos negativos posibles. Sin acción necesaria.

### SUGERENCIAS
- `view-mode-guard.ts`: la consulta `getOrgType` solo ocurre en el caso `ADMIN` sin `Professional`; correcto. Si más adelante hay más rutas con `@UsesViewMode`, evaluar cachear `getActiveProfessionals` por request (hoy es una consulta por request en vista pro, igual o mejor que antes: el dashboard hacía una por método).
- `work-items/page.tsx`: el `catch` devuelve `null` ante un 403 de rol/modo; está bien y la tabla se renderiza vacía. Considerar mostrar el mensaje `SESSION_MESSAGES.forbiddenAction` en lugar de un vacío silencioso (la página es el Server Component, sin toast).
- El front no tiene `professionalId` en el store (documentado en 04): `allowedViewModes` se alimenta del código de rol `PROFESSIONAL`. Correcto para este feature; hidratarlo queda como mejora.

## Convenciones del proyecto
- Constantes de dominio: se reutiliza `USER_MODE` en `view-mode.ts`; en el front, `VIEW_MODE`, `ORG_ROLE`, `APP_ROLE_CODE` en `lib/constants.ts` (aunque `ORG_ROLE` no se usa aún en `view-mode.ts`, que compara con literales `'ADMIN'`/`'MEMBER'` en las líneas 22 y 40: sugerencia menor de usar la constante).
- Capas y CQRS: controladores finos, handlers con `requireViewScope(ctx)`, servicios reciben `ViewScope`; `IPatientService.findAll` cambia de firma y su única implementación se actualizó. `OrgAccessService` ganó dos métodos sin módulo nuevo.
- Excepciones HTTP de Nest (`ForbiddenException`, `BadRequestException`); sin `throw new Error`.
- Regla de `ID_ROUTE_CASES` y clasificación de `*Id` en `security-invariants.spec.ts`: actualizadas (`FindAllActivitiesQuery.userId` y los `userId` del dashboard salen de `ID_FIELDS` porque los campos se eliminaron).
- Capa de `patient-read-access.ts`: vive en `application/features/patients/` y usa `PrismaService` directo, como los demás handlers de lectura. Aceptable.
- Sin schema ni migración; sin secretos en archivos versionados.

## Frontend
- `allowedViewModes`/`pickViewMode`/`canSeeRestrictedLinks` son puras y tienen `view-mode.test.mts`.
- `Sidebar.tsx`: el selector "Ver como" y los enlaces `restricted` (Dashboard org, Liquidaciones, Reglas y Ajustes de org) se ocultan y redirigen para todo no-ADMIN; la vista persistida inválida se corrige (profesional sin membresía con `ORGANIZATION` guardada pasa a Pro).
- `data.ts`: `createWorkItem` manda el modo solo en `x-mode` y lo saca del body; `getFeeRules(slug, ctx?)` sin `?mode=` (3 llamadas ajustadas); `calculateSettlements` sin `organizationId` y sin los dos `getOrgDetails` previos. Los tres llamadores de `createWorkItem` pasan `mode` (el formulario lo arma desde la vista, `AdmisionesTable` fija `org`). `api-routes.test.mts` fija estos contratos.
- `work-items/page.tsx`: un `ApiForbiddenError` que no es de organización se muestra como tabla vacía; el de organización sigue a `/sin-acceso` por `withServerSession`.

## Tests faltantes
Ninguno bloqueante. Cobertura destacable: matriz completa vínculos x modo pedido (pura y por HTTP con `AppModule` real), 403 de financieros por rol, estructura de rutas con `@UsesViewMode` (sección (l)), valores de modo (m), lecturas por id sin membresía y vista multi-organización (n), `fake-prisma` con `some`. Quedan para el tester en vivo: matriz con A/M/P reales y `-Smoke`.

Veredicto previo (historial): APROBADO


## Re-revisión (vuelta 1)

Alcance: MEDIA-1 y BAJA-3 de seguridad, y los menores 1, 3 y 4 de esta revisión.

### Verificaciones ejecutadas
- Backend: `npx tsc --noEmit` sin errores; `npx jest` 30 suites, 525 tests en verde.
- ESLint sobre los 7 archivos de producción de la vuelta: solo 21 errores `prettier/prettier` (preexistentes, de formato) y `no-unsafe-*`; ningún error de lógica.
- Frontend: `npx tsc --noEmit` sin errores; `npm test` 35/35; `npm run build` OK.

### MEDIA-1: correcta
- `assertPatientReadable` devuelve `null` para miembros (sin cambios) y los ids de los Professional ACTIVE del usuario sin membresía, también con `canLoadActivities` (conserva el acceso al paciente, pero acota los montos). Sin Professional o sin atención al paciente: 404 genérico, igual que antes.
- `ownProfessionalsFilter` (propias o como participante) se aplica de forma consistente en el resumen (`items` y `totalDebt`), en `getDebt`/`calcDebt` y en `lastVisit` del listado. En el resumen, `totalDebt` se calcula sobre los `items` ya filtrados, así que no puede divergir.
- Listado en vista pro: la restricción se decide por paciente (`memberOrgIds.has(p.organizationId)`). Los miembros de la organización conservan el cálculo completo. Si `query.userId` faltara, `memberOrgIds` queda vacío y se acota todo: falla hacia el lado seguro. El controlador siempre lo asigna desde `@CurrentUserId()`.
- Otras rutas: `activity/:id` y el listado de atenciones ya acotan por propias/participante (revisado en la primera ronda); `dashboard`, `settlements` y reglas quedan en ADMIN. No encontré otra ruta que exponga montos ajenos a un profesional sin membresía.

### BAJA-3: correcta
`soloOrgIds` sale de las membresías con `role === 'ADMIN'` y `organization.type === 'SOLO_PRACTICE'`, en una sola consulta (se reutiliza la de `memberOrgIds`). Con tests de MEMBER fuera y ADMIN dentro.

### Menores
- MENOR-1: resuelto. `payers` tipa `@Query()` con `GetDashboardPayerDistributionQuery`, sin `any` ni `Object.assign`, y el import sin uso se quitó.
- MENOR-3: resuelto (línea en blanco; prettier solo en los dos specs nuevos).
- MENOR-4: resuelto. `allowedModes` en `useMemo` con dependencias `[orgRole, availableRoles]`; el efecto ya no omite dependencias. Queda el `no-explicit-any` preexistente.

### Hallazgos nuevos
- MENOR-6 (capas, sugerencia, NO bloqueante). `infrastructure/.../patients.service.ts:10` importa `ownProfessionalsFilter` desde `application/`: la infraestructura depende de la aplicación, al revés de lo que dicen las convenciones. Es una función pura sin dependencias (solo arma un objeto de filtro Prisma), así que no hay acoplamiento funcional ni ciclo de módulos real, y el impacto es de prolijidad. Sugerencia: moverla a `domain/features/patients/` (p. ej. `own-professionals-filter.ts`) y que `patient-read-access.ts` y el servicio la importen de ahí. Puede hacerse en esta rama o dejarse al BACKLOG.
- MENOR-7 (fuga residual mínima). El orden del listado (deudores primero) usa `workItems.some(paymentStatus != PAID)` sobre todas las atenciones, incluidas las de otros profesionales. Un profesional sin membresía podría inferir que un paciente tiene deuda con otro profesional por su posición, sin ver montos. Impacto bajo; si se quiere cerrar, acotar `debtorWhere` con `ownProfessionalsFilter` para los pacientes de organizaciones sin membresía.
- Observación (preexistente, fuera de alcance): el listado hace consultas N+1 por paciente (`calcDebt` + `findFirst`); la vuelta no empeora el patrón.

### Regresiones
Ninguna detectada. Los miembros conservan el comportamiento anterior (tests específicos en `patients-handlers.spec.ts`, `patients.service.spec.ts` y `test/org-isolation.spec.ts`).

Sin bloqueantes ni mayores.

VEREDICTO: APROBADO
