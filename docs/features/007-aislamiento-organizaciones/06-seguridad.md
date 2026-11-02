# 06 - Seguridad: 007-aislamiento-organizaciones

> Autor: ingeniero de seguridad de aplicaciones. Entradas: `.claude/CLAUDE.md`, `00-estado.md` (las decisiones prevalecen), `01-spec.md`,
> `03-diseno-tecnico.md`, `04-implementacion.md` (con la vuelta 1), `05-revision.md`, y el 06 de los features 005 y 006 (M-2 es el origen).
> Solo lectura: no se modificó código, no se ejecutó `dev.ps1`, no se levantó el stack, no hubo SQL, no se leyó el `.env`, y no hay commit ni push.
> Verificado: `npx tsc --noEmit` backend con 0 errores. `npm test` backend con 22 suites y 323 tests en verde. `npm test` frontend con 11 tests en verde.
> Sin tokens, secretos ni ids reales en este documento.

## 1. Resumen

El diseño de fondo es sólido. El `Dispatcher` entrega un `RequestContext` congelado que sale solo de `request.auth` y `request.orgAccess`
(los llenan los guards globales, no el cliente). Todas las rutas con `:id` pasan por `findFirst` con `inScope` o `inOrg`, con 404 idéntico.
El grep propio de controladores contra el test estructural coincide: las 18 rutas con parámetro de los controladores registrados
(activity 3, org 9, pro/payers 2, patients 4) están en `ID_ROUTE_CASES`.

Hay **un hallazgo ALTO dentro del alcance** que rompe el aislamiento entre organizaciones por una vía que el feature dejó sin cerrar:
tres endpoints GET siguen tomando la organización del header `x-org-id` crudo, y si el cliente **omite el header** y manda una
organización propia por query, el guard pasa y el handler consulta **sin filtro de organización**. Por eso el veredicto es RECHAZADO.

## 2. Hallazgos dentro del alcance

### ALTA-1 - Sin `x-org-id`, tres GET devuelven datos de todas las organizaciones (fuga entre tenants)

- **Archivos y líneas:**
  - `backend/src/api/controllers/v1/config/pro-controller.ts:143` (`getPayers`: `query.orgId = orgId`) y `backend/src/application/features/config/commands/payer-commands.ts:89` y `:99` (`organizationId: query.orgId`);
  - `backend/src/api/controllers/v1/dashboard/dashboard-controller.ts:34` (chart) y `:47` (payers) con `backend/src/infrastructure/features/dashboard/dashboard.service.ts:212` y `:302` (`where.organizationId = organizationId`).
- **Causa:** `OrgAccessGuard` acepta como válida una petición sin `x-org-id` si trae `?orgId=` u `?organizationId=` de una organización propia (cinco fuentes, ver `org-access-guard.ts:57`).
  Estos controladores siguen leyendo `@Headers('x-org-id')` y **pisan** con él el valor validado del query: queda `undefined`. Prisma ignora `organizationId: undefined`, así que el `where` pierde el filtro.
  Es exactamente el patrón que el criterio 2 pedía eliminar (organización "solo de RequestContext"), y la fila 35 del relevamiento (03 §2.2) lo dio por "filtrado, sin cambios" sin probar este caso.
- **Impacto:**
  - `GET /pro/payers?orgId=<mi org>` sin header: un usuario sin `Professional` (ADMIN o MEMBER) recibe **todos los pagadores de todas las organizaciones** (nombre, CUIT, retención). Con `Professional`, recibe todos los pagadores `isManagedBySystem` de todas.
  - `GET /dashboard/chart?orgId=<mi org>` y `GET /dashboard/payers?orgId=<mi org>` sin header y sin `mode=pro`: totales brutos, netos y por pagador **agregados de todas las organizaciones** (datos financieros ajenos).
  - Basta un JWT válido con cualquier vínculo. El front siempre manda el header, por eso nadie lo vio. Ningún test lo cubre (`org-isolation.spec.ts` manda siempre `x-org-id`).
  - Verificado por lectura de código, no en vivo (no se levantó el stack).
- **Remediación concreta:**
  1. Los tres controladores deben tomar la organización de `request.orgAccess.primaryOrgId` (decorador `@CurrentOrgId()` o `requireOrgScope`) y no del header. Mejor aún, pasar el `RequestContext` a los handlers como ya se hace en el resto del feature.
  2. Fallar cerrado en los handlers: `GetPayersQueryHandler`, `getChart` y `getPayerDistribution` deben lanzar 403 o devolver `[]` si la organización llega vacía (hoy `getKpis` ya lo hace con `if (!query.organizationId)`).
  3. Ampliar `security-invariants.spec.ts`: ningún controlador lee `@Headers('x-org-id')` salvo la lista blanca que se justifique. Resta leerlo en `activity-controller.ts:38,53`, `org-controller.ts:54,62,68,187`, `pro-controller.ts:41,112,139`, `dashboard-controller.ts:19,30,41`, `fee-rules-controller.ts:19` y `patients-controller.ts:44,63`. Los demás hoy fallan cerrado (devuelven vacío o error de Prisma), pero conviene unificar.
  4. Agregar un caso HTTP "sin `x-org-id`, con `?orgId=` propio" para `pro/payers`, `dashboard/*`, `fee-rules`, `v1/patients` y `org/*`, que verifique que no se devuelve nada de otra organización.

### MEDIA-1 - Reglas de honorarios con `splits` sin validar, creadas por un profesional dueño de pagador

- **Archivo:** `backend/src/application/features/fee-engine/commands/fee-rule-commands.ts` (`CreateFeeRuleDto.splits`, `@IsDefined()` con JSON libre) y el permiso `isPayerOwner` del handler.
- **Contexto:** es la opción (a) de la decisión 3 de `00-estado.md` (ADMIN, o el dueño del pagador para su pagador). La lista blanca de campos y la verificación del pagador están bien hechas y probadas.
- **Riesgo:** un profesional con `Professional` en una clínica puede crear un pagador propio (`POST pro/payers`) y una regla para ese pagador con `splits` arbitrarios (porcentajes sobre 100, valores negativos, `FIXED` mayores al monto, 100% a `PROFESSIONAL`). Si además puede cargar atenciones (`canLoadActivities`), el motor aplica esa regla a su propia atención y se asigna el reparto. El beneficiario `PROFESSIONAL` siempre es el `professionalId` del contexto (`fee-resolution.service.ts:238`), así que no puede apuntar a terceros, pero sí puede alterar el reparto de la organización.
- **Remediación:** validar el esquema de `splits` en el servidor (tipo `PERCENTAGE|FIXED`, `value` finito y no negativo, suma de porcentajes menor o igual a 100, beneficiario del enum). Para organizaciones que no son `SOLO_PRACTICE`, exigir `ADMIN` o confirmar con el PO que el dueño del pagador puede definir su propio reparto. No bloquea este feature porque es una decisión de política ya tomada, pero es un riesgo económico real.

### BAJA-1 - Baja de staff sobre un usuario sin otros vínculos (efecto global)

- **Archivo:** `backend/src/application/features/config/commands/staff-commands.ts:90` (`CreateStaff` vincula por email a cualquier `User` activo) y `:222-228` (`DeleteStaff` da de baja al `User` si no tiene otros vínculos).
- **Verificado el criterio 6:** el `User` con otro `Professional` activo o con membresía en otra organización **no** se da de baja, y la membresía que se borra es solo la de esta organización. La transacción es correcta.
- **Riesgo residual:** un ADMIN de la organización A puede dar de alta como staff a un usuario existente sin ningún vínculo (cuenta recién creada, sin onboarding) y luego eliminarlo: el `User` queda dado de baja globalmente (login bloqueado, 006). Impacto acotado a cuentas sin vínculos. Es consecuencia del vínculo por email (residual del 03, fila 27).
- **Remediación:** no dar de baja el `User` global desde la baja de staff (alcanza con quitar el vínculo), o exigir que la cuenta haya sido creada por esa organización. Registrar para el 013.

### BAJA-2 - Robustez menor de entradas

- `backend/src/api/controllers/v1/patients/patients-controller.ts:93`: `body.targetId` con cuerpo vacío lanza `TypeError` (500). Usar `body?.targetId`.
- `UpdatePatientCommand`, `UpdateActivityCommand` y `UpdateStaffCommand` aceptan valores sin validar (enums de pago, `email` de paciente, fechas) que terminan en error de Prisma (500). No hay fuga de datos por el `HttpFilter`/filtro global, pero conviene DTOs con `class-validator`.

## 3. Verificación por criterio (resultado)

| Punto pedido | Resultado |
|---|---|
| 1. IDOR por id en ruta, body y query | **Cubierto**, salvo ALTA-1 (que no es un id, es la organización). Lectura/escritura por id usan `findFirst({ id, ...inScope })` antes de escribir. 404 idéntico para inexistente, ajeno, no UUID y default del sistema (`requireId` + `foundOr404`). Ids referenciados en `createActivity` (paciente, pagador, profesional, participantes, preset, tipo), `CreateStaff`/`AssignStaffCategory` (categoría), `POST fee-rules` (pagador) y merge (origen, destino, misma organización, distintos) verificados contra la organización destino. TOCTOU: no relevante, ningún endpoint cambia `organizationId`, `createdByUserId` ni el profesional de un recurso; `createActivity` y merge escriben en `$transaction` y las lecturas previas no pueden quedar obsoletas de forma explotable. |
| 2. Contexto | `RequestContext` sale solo de `request.auth` y `request.orgAccess` (set por guards; el body no puede inyectarlo). Sin `whitelist` en el `ValidationPipe`, pero el contexto no viaja en el comando. `primaryOrgId` es `x-org-id` o la primera fuente, siempre dentro de `organizationIds`; con varias organizaciones, `OrgRoleGuard` exige ADMIN en todas para `org/*`. **Falla en ALTA-1** (controladores que aún usan el header). |
| 3. Autorización | Todas las escrituras de `org/*` y `PUT org` llevan `@RequireOrgRole('ADMIN')` con rol de la base. Política de atenciones de `00-estado` implementada en `canModifyActivity` (ADMIN todo; MEMBER edita cualquiera y borra propias; solo-Professional lo suyo; `null` por el dueño del `Professional`; cobrada con fecha 403). `canLoadActivities` exigido antes de leer ids, con `status ACTIVE` y `deletedAt null`. Reglas y pagadores por ADMIN o dueño. Nada depende de `x-mode` para permisos (queda solo para el cálculo de montos y la lista cross-org en modo pro). |
| 4. Mass assignment | `fee-rules` con lista blanca (probado: `payer.create`, `organization.connect`, `organizationId` e `id` no llegan a Prisma). Ningún handler pasa el body a `data`; `UpdateStaff`, `UpdateActivity`, `UpdatePatient`, categorías, presets y tipos arman `data` campo por campo. `UpdateOrganization` acepta `settings` arbitrario (014, ya conocido). |
| 5. Lookup por CUIT | `GET org/staff/lookup` es ADMIN, acotado a `primaryOrgId`, respuesta mínima sin email ni teléfono. `config/*`, `system/professionals`, `pro/payers/lookup`, `GET settlements`, `settlements/:id/details` y `fee-engine/professional-categories` no tienen controlador registrado. `ProductionController` y `ReportingController` siguen sin registrar (ver INFO-3). |
| 6. Baja de staff | Correcta (ver BAJA-1 para el residual). |
| 7. Frontend | `data.ts` solo cambió URLs a `org/*`, relanza errores y no muestra el detalle de un 404. `AdmisionesTable` decodifica el JWT únicamente para habilitar o deshabilitar el botón Eliminar (presentación); el backend decide. No agrega datos expuestos nuevos ni secretos. |
| 8. Secretos y datos reales | Tests con secreto armado en ejecución (`'k'.repeat(40)`), ids de `randomUUID()`, correos `example.test`. Docs del feature sin ids ni tokens. `.claude/settings.json` solo con cambio de fin de línea. |
| Dependencias | El feature no toca `package.json` del backend. `npm audit --omit=dev` del backend: 15 hallazgos (1 crítico `proxy-addr`, 7 altos: `body-parser`, `js-yaml`, `lodash`, `multer`, `path-to-regexp`, `@nestjs/platform-express`, `@nestjs/swagger`; resto moderados). Es la línea base previa; se aborda en un feature de dependencias (INFO-2). |
| CSRF, CORS, cabeceras, cripto, subida de archivos | Sin cambios en este feature. No se agregan subidas de archivos ni cripto. |

## 4. Informativos y residuales fuera de alcance (no bloquean)

- **INFO-1 (conocidos del diseño, 009/013/014):** dentro de su organización, un profesional sin membresía ve la lista de atenciones en modo organización, `GET activity/:id`, el resumen y la deuda de cualquier paciente; `settlements/calculate` y el dashboard en modo organización están abiertos a MEMBER y profesionales (la UI solo oculta el menú); `org/config` devuelve emails y CUIT del staff a cualquier vínculo; `CreateStaff` revela si un email tiene cuenta; oráculo de un bit del CUIT de organización en `POST pro/payers`; `x-mode` decide montos y el split privado en `SOLO_PRACTICE`; modo pro lista cross-org (solo recursos del propio `Professional`). Se recomienda priorizar `settlements/calculate` con `@RequireOrgRole('ADMIN')` por ser datos de pagos a todos los profesionales.
- **INFO-2:** dependencias con avisos altos y uno crítico (`proxy-addr`, solo explotable si se configura `trust proxy`; el proyecto no lo hace). Actualizar NestJS 10 en un feature aparte.
- **INFO-3:** `ProductionController`, `ReportingController` y `ProfileController` (mock que devuelve el body) no están protegidos con scope. Los dos primeros no están registrados; si el feature 011 los registra, deben usar `requireOrgScope`.
- **INFO-4:** un ADMIN que se borra a sí mismo como staff puede quedarse sin acceso (preexistente, anotado en el diseño).
- **INFO-5:** `whitelist` en el `ValidationPipe` sigue pendiente (BACKLOG 12). Hoy no es explotable porque los handlers mapean campo por campo y el contexto no viaja en el body.

## 5. Veredicto

Un hallazgo ALTO dentro del alcance (ALTA-1): con `x-org-id` omitido, `GET pro/payers` y `GET dashboard/chart|payers` devuelven datos de otras organizaciones. Corregirlo exige tomar la organización del contexto validado en esos controladores (y en los restantes que aún leen el header), fallar cerrado en los handlers y sumar un test HTTP "sin header". Todo lo demás del feature está bien cerrado.

Veredicto previo (historial, revisión inicial): RECHAZADO por ALTA-1. Ver la re-revisión de la vuelta 2 más abajo.

---

## Re-revisión (vuelta 2)

> Solo lectura. Verificado: `npx tsc --noEmit` backend sin errores; `npm test` backend 24 suites, 374 tests en verde; `npm test` frontend 11 tests en verde.
> Sin SQL, sin `dev.ps1`, sin leer el `.env`, sin commit ni push. Se ignoró lo ajeno indicado (EOL, `.vscode/`, `frontend/AGENTS.md`).
> Sin ids, tokens ni secretos reales en este documento.

### 1. ALTA-1: RESUELTA

- Grep propio en `backend/src` (sin specs) de `@Req`, `@Request`, `req.headers`, `request.headers`, `request.query/body`, `@Headers`, `@Query('orgId')`, `@Body('organizationId')`: el header `x-org-id` y el query/body de organización solo se leen en `org-access-guard.ts` (validación de pertenencia). El único `@Headers` restante es `x-mode` (no es organización). Los demás usos de `req.` son autenticación y logging.
- Controladores registrados (Activity, Auth, Dashboard, FeeRules, Patients, Settlements, Health, Org, Pro, Profile) y no registrados (Production, Reporting): todos los que filtran por organización pisan el campo del DTO con `@CurrentOrgId()` (`request.orgAccess.primaryOrgId`, que sale del guard y falla con 403 si falta): activity `findAll`, org (`PUT`, `GET`, `config`, `activity-types`), pro (`context`, `profile`, `payers`), dashboard (`kpis`, `chart`, `payers`), fee-rules `GET`, patients `GET` y `POST` (en `POST` el body se pisa con `body.organizationId = orgId`). El orden de fuentes del guard pone el header primero, por lo que `primaryOrgId` es el header validado; una segunda organización propia por query no cambia el filtro.
- Fallan cerrado con organización vacía: `GetPayersQueryHandler` (`requireOrgId`), `DashboardService.getChart` y `getPayerDistribution` (`requireOrgId` antes de consultar), `getKpis`, `FindAllActivities`, `GetActivityTypes`, `GetOrgConfig`, `GetOrganization`, `FindFeeRules` y `PatientsService.findAll` (devuelven vacío o `null` antes de cualquier consulta; confirmado por lectura que ninguno consulta sin filtro). Con el controlador migrado, el valor vacío ya no es alcanzable por HTTP.
- `POST activity` con `body.organizationId`: el guard lo toma como fuente (string, UUID, con vínculo activo; si no, 403 idéntico) y lo agrega a `orgIds`. `ActivityService.createActivity` lo normaliza con `optionalId` (404 si no es UUID), exige `scope.orgIds.includes(orgId)` (403), usa el rol de esa organización destino (`roleIn(scope, orgId)`), `canLoadActivities` del `Professional` de esa organización y resuelve todos los ids referenciados contra esa organización. Uso seguro. `PUT` de `/activity/:id` ya no lleva organización de entrada.
- Tests: el invariante estático (`security-invariants.spec.ts`) y la sección (i) de `test/org-isolation.spec.ts` cubren el caso sin header con `?orgId=` y `?organizationId=` propios y ajenos.

### 2. MEDIA-1: RESUELTA (con un residual, MEDIA-2)

`validateFeeRuleSplits` se aplica en `CreateFeeRuleCommandHandler` después del permiso y antes de cualquier escritura, para crear y para actualizar la regla existente. Es la única ruta de escritura de `FeeRule` (grep: solo un `feeRule.create` y un `feeRule.update`, ambos en ese handler; no hay `upsert`, `updateMany` ni SQL crudo). Valida: arreglo de 1 a 20 objetos; solo las claves permitidas por forma (sin ids de beneficiario, sin `__proto__` ni claves extra); `percentage`/`value` numéricos finitos, no negativos, porcentajes hasta 100; `FIXED` hasta el máximo de `Decimal(10,2)`; `type` y `beneficiary` del enum; suma de porcentajes hasta 100. Respuesta 400 genérica.

### 3. BAJA-2: RESUELTA

`body?.targetId` en el controlador y 400 `Invalid request` en `MergePatientCommandHandler` si `targetId` no es string no vacío, antes de leer o escribir. Probado unitario y por HTTP.

### 4. Hallazgos nuevos o residuales

#### Dentro del alcance

- **Bloqueantes / altos:** ninguno.
- **MEDIA-2 (residual de MEDIA-1, no bloquea):** `fee-resolution.service.ts:231` (`computeAmounts`) usa `split.value` de un `FIXED` sin acotarlo al bruto de la atención, y el validador solo acota cada `FIXED` al tope de la columna. Un dueño de pagador (decisión 3) puede crear una regla con un `FIXED` de beneficiario `PROFESSIONAL` mayor que el bruto y asignarse un reparto inflado en sus propias atenciones. El impacto está limitado por la política ya aceptada (dueño del pagador propio), pero es económico. Remediación: en `computeAmounts` limitar cada monto a `grossAmount - totalAllocated` (mínimo 0), o rechazar `FIXED` en reglas creadas por quien no es `ADMIN`. Priorizar en el feature que toque el motor de honorarios.
- **MENOR-1:** `settlements-controller.ts:13` (`GET settlements/calculate`) sigue tomando `organizationId` del `@Query()` crudo y `CalculateSettlementsQueryHandler` lo usa sin pasar por el contexto. No es explotable: el DTO lo exige (`@IsString`, `ValidationPipe` global → 400 si falta) y el guard lo valida como fuente (pertenencia obligatoria, arreglos y no-UUID dan 403), así que solo llega una organización propia. Pero es la misma vía que el criterio 2 quería eliminar y el invariante estático no la detecta. Remediación: agregar `@CurrentOrgId()` y pisar `query.organizationId`, y sumar el controlador a la lista del invariante. El problema de fondo (cualquier vínculo calcula pagos a todos los profesionales) sigue siendo INFO-1.
- **MENOR-2:** `activity-controller.ts:57` usa `command.organizationId || orgId`: depende de la validación del servicio (correcta). Sin acción; opcional dejar `orgId` como valor por defecto único y rechazar el body distinto.
- **MENOR-3 (conocido):** `app/test-suite/page.tsx` recibirá 400 al crear reglas con `splits` en forma de objeto; es herramienta de desarrollo. Solo un aviso, no usar contra datos reales (regla 9).

#### Fuera del alcance (sin cambios respecto de la revisión previa)

BAJA-1 (decisión 8, aceptada por el PO), INFO-1 (acceso por rol de `settlements/calculate`, dashboard en modo organización, `org/config`, listas cross-org en modo pro), INFO-2 (dependencias: sin cambios en `package.json` del backend; el del frontend solo suma un archivo al script de test; la auditoría previa sigue vigente: 15 hallazgos, 1 crítico no explotable sin `trust proxy`), INFO-3 (`ProductionController`, `ReportingController` sin registrar), INFO-4, INFO-5 (`whitelist`).

### 5. Regresión de lo ya cerrado

Sin regresión: IDOR por `:id` (`findFirst` con `inScope`/`inOrg`, 404 idéntico para inexistente, ajeno y no UUID), ids referenciados verificados contra la organización destino, `@RequireOrgRole('ADMIN')` en las escrituras de `org/*`, política de atenciones (ADMIN, MEMBER, solo-Professional), lista blanca de campos en fee-rules (sin mass assignment) y baja de staff. Los cambios de la vuelta son aditivos (decorador, `requireOrgId`, validador) y no relajan ningún chequeo. El front solo cambió en `PayerRulesManager` y `org/profesionales/page.tsx` (manejo de errores), sin superficie nueva.

### 6. Resumen

ALTA-1, MEDIA-1 y BAJA-2 quedaron corregidas y probadas. No hay críticos ni altos dentro del alcance. Quedan un residual medio (MEDIA-2, `FIXED` sin acotar en el motor) y menores (MENOR-1 a 3) que no bloquean.

VEREDICTO: APROBADO
