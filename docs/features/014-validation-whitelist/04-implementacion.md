# 04 — Implementación: 014-validation-whitelist

Estado: terminado, sin commit ni push. Se siguió `03-diseno-tecnico.md` (aprobado) y los 10 defaults de `00-estado.md`.
Los puntos marcados **[013]** se releyeron sobre el estado commiteado (`2155df6`) antes de aplicarlos: ninguno
contradecía el diseño (el pipe y `tsconfig` no los tocó el 013; `fee-rule-splits.ts`, `update-organization-command.ts`,
`staff-`, `payer-` y `activity-type-commands.ts`, `data.ts` y `org-isolation.spec.ts` estaban como describe el diseño).

## 1. Qué se hizo por paso del plan

| Paso | Qué | Resultado |
|---|---|---|
| 0 | Releer los archivos **[013]** | Sin conflictos. Baseline: 39 suites / 682 tests Jest en verde |
| 1 | `tsconfig.spec.json`: `useDefineForClassFields: true` | Los 682 tests siguen en verde con el cambio (ningún bug oculto de producción) |
| 2 | Constantes (`MAX_MONEY_AMOUNT`, `MAX_PAGE_SIZE`, `MAX_ACTIVITY_PARTICIPANTS`, `DASHBOARD_BASIS`, `DASHBOARD_VALUE_TYPE`, `CHART_GROUP_BY`, `ADMISSION_NO_COADMISOR_BEHAVIOR`); helpers `dto-validators.ts` + spec; `fee-rule-splits.ts` usa `MAX_MONEY_AMOUNT` | Hecho |
| 3 | DTOs por área (pacientes, actividades, config, pro, fee rules, dashboard, settlements) con `declare` para los campos del controlador | Hecho |
| 4 | Controladores: B14 (`UpdateProProfileDto`), B20 (`MergePatientRequestDto`) y Q3 (`LookupStaffByCuitQueryDto`) con DTO; Q2 (`org/config`) y Q8 (`fee-rules` GET) sin `@Query()` | Hecho |
| 5 | `security-invariants.spec.ts`: regex con prefijo `declare`, se quitan 5 `orgId` de `ID_FIELDS`, 3 invariantes nuevos; `config-handlers.spec.ts` sin `orgId`; `patients-handlers.spec.ts` con `Object.assign(new UpdatePatientCommand(), …)` | Hecho |
| 6 | `test/request-dto-invariants.spec.ts` (criterio 4) | Verde. Verificado que falla si un campo vuelve a ser propio sin decorar (probé quitando un `declare`) |
| 7 | Frontend: `request-bodies.ts` + test, `data.ts` con builders, limpieza de `PatientDirectory` y `PayerRulesManager`, `getOrgConfig` sin `?orgId=`, `api-routes.test.mts`, `package.json` | Hecho |
| 8 | `RequestValidationPipe` + `pipes-config.spec.ts`; se quita el `@Transform` del login | Hecho |
| 9 | `org-isolation.spec.ts`: 2 tests con resultado nuevo + secciones (o) y (p) | Hecho |
| 10 | Calidad completa | Ver sección 7 |

Además, la tarea pendiente del 013: se borraron del `catch` de `WorkItemForm.tsx` los dos comentarios desactualizados
(los que decían que `AtencionesTable` ya muestra el error y "solo mostrar si el padre no lo mostró"). Quedó únicamente el
comentario del 403.

## 2. Configuración final del pipe

`backend/src/infrastructure.bootstrap/config/app/pipes-config.ts` define `RequestValidationPipe` (global, vía
`configurePipes`), con dos `ValidationPipe` internos según `metadata.type`:

| Opción | Body | Query |
|---|---|---|
| `transform` | true | true |
| `whitelist` | true | true |
| `forbidNonWhitelisted` | **true** (campo no declarado → 400 `property x should not exist`) | false (se descarta) |
| `forbidUnknownValues` | true (body array/primitivo → 400) | true |
| `transformOptions.enableImplicitConversion` | **false** | **false** (los números llevan `@Type(() => Number)`) |
| `validationError` | `{ target: false, value: false }` | ídem |

`param` y `custom` (`@CurrentOrgId()`, `@CurrentUserId()`) no se validan: los `:id` siguen con `requireId` (404 genérico).
El `exceptionFactory` es el de Nest: el filtro del 013 lo traduce a `validation-failed`. Los guards (`OrgAccessGuard`,
`ViewModeGuard`) corren antes del pipe sobre el request crudo, así que `?mode=`, `?orgId=` y `?organizationId=` no se
ven afectados y ningún DTO los declara. `pipes-config.ts` se reescribió completo (LF), así que el cambio de EOL que
traía queda incluido en el feature, como se indicó.

## 3. Endpoint → DTO

Bodies (20; B21 es el mock `PacientesTable`, sin cambios en el backend):

| Ruta | Clase | Cambios clave |
|---|---|---|
| `POST v1/auth/login` | `LoginRequestDto` | Sin `@Transform` |
| `POST activity` | `CreateActivityCommand` (+ `ActivityParticipantDto`) | `organizationId`/`professionalId`/`activityTypeId`/`presetId`/`payerId` `@IsOptionalEntityId`; `patientId` `@IsEntityId`; `date` ISO estricto; `paymentStatus`/`attendance` enums de Prisma; montos `@IsMoney`; `hours` 0-1000, `quantity` int 1-1000; `participants` máx. 10 |
| `PUT activity/:id` | `UpdateActivityCommand` | `declare id`; enums; fechas opcionales ISO estrictas |
| `PUT org` | `UpdateOrganizationCommand` (+ `OrgSettingsDto`) | Sin constructor; `declare id`; `settings` con las 7 claves (2 de la UI + 5 de `OrgSettings`); el handler arma `settings` solo con esas claves |
| `POST/PUT org/categories` | `CreateCategoryCommand`, `UpdateCategoryCommand` | Sin `orgId`; `percentage` `@IsPercentage` |
| `POST/PUT org/presets` | `CreatePresetCommand`, `UpdatePresetCommand` | Sin `orgId`; `@IsMoney` |
| `POST org/staff` | `CreateStaffCommand` | Sin `orgId`; `categoryId` `@IsOptionalEntityId` |
| `PUT org/staff/:id` | `UpdateStaffCommand` | `declare id` |
| `PUT org/staff/:id/category` | `AssignStaffCategoryCommand` | `categoryId` `@IsEntityId` |
| `POST/PUT org/activity-types` | `CreateActivityTypeCommand`, `UpdateActivityTypeCommand` (+ `ActivityTypeRoleDto`) | Sin `orgId`; `feeStrategy` `@IsEnum(FEE_STRATEGY)`; `fixedPercentage` `@IsPercentage` |
| `PUT pro/profile` | `UpdateProProfileDto` (nuevo) | Era tipo inline |
| `POST/PUT pro/payers` | `CreatePayerCommand`, `UpdatePayerCommand` | Sin `orgId`; `retentionPercentage` `@IsPercentage` |
| `POST fee-rules` | `CreateFeeRuleDto` | `splits` `@IsDefined @IsArray` (el esquema sigue en `validateFeeRuleSplits`, mismo orden 404/403/400); `payer.connect.id` `@IsEntityId`; fechas opcionales |
| `POST v1/patients` | `CreatePatientCommand` | Sin constructor; `declare organizationId`; ahora con class-validator |
| `PUT v1/patients/:id` | `UpdatePatientCommand` | Sin constructor; `declare id` |
| `POST v1/patients/:id/merge` | `MergePatientRequestDto` (nuevo) | Era tipo inline |

Queries (8): `GET activity` (`FindAllActivitiesQuery`: ids, enum de `status`, fechas, `page`/`limit` ≤ 100),
`GET org/staff/lookup` (`LookupStaffByCuitQueryDto`, nuevo), `GET pro/payers` (`GetPayersQuery`), `GET dashboard/kpis`,
`chart` y `payers` (fechas estrictas y enums `basis`/`valueType`/`groupBy`), `GET v1/patients` (`FindAllPatientsQuery`,
con `search` ahora decorado: sin eso la whitelist lo habría borrado) y `GET settlements/calculate`
(`month` `YYYY-MM` con mes 01-12). `GET org/config` y `GET fee-rules` ya no declaran `@Query()`: el controlador arma la
query (`GetOrgConfigQuery`, `FindFeeRulesQuery`) y asigna los campos.

## 4. Frontend

- `frontend/src/lib/request-bodies.ts` (módulo puro, sin imports): `pickDefined`, listas de campos que espejan los DTOs y
  builders `buildCreateActivityBody`, `buildUpdateActivityBody`, `buildStaffCreateBody`, `buildStaffUpdateBody`,
  `buildPatientBody`, `buildOrgUpdateBody`, `buildProProfileBody`, `buildFeeRuleBody`, `buildPresetBody`,
  `buildActivityTypeBody(data, 'create' | 'update')` y `buildWorkItemsQuery`.
- `services/data.ts`: las 13 escrituras con formulario usan su builder; `getWorkItems` usa `buildWorkItemsQuery`
  (`payer`→`payerId`, `patient`→`search`, descarta el resto); `getOrgConfig` ya no manda `?orgId=`. `createWorkItem` sigue
  sacando `mode` al header `x-mode` (el test de `api-routes` lo exige) y después arma el body con el builder. Las demás
  funciones (`login`, `createCategory`, `updateCategory`, `assignStaffCategory`, `createPayer`, `mergePatient`) ya mandaban
  literales exactos y no cambian.
- Limpieza de datos muertos: `PatientDirectory` ya no manda `organizationId`; `PayerRulesManager` ya no manda
  `organization` (2 lugares).
- `RetroactiveModal` no cambia: el builder deja el body en `{}` y el `PUT` sigue siendo el no-op de hoy.
- `mode` en la query (`dashboard`, `activity`, `v1/patients`) y el header `x-mode` se mantienen.
- `request-bodies.test.mts` (agregado al script `test`) y 3 tests nuevos en `api-routes.test.mts`.

## 5. Invariante estático (criterio 4)

`backend/test/request-dto-invariants.spec.ts` arranca el `AppModule` real (Prisma reemplazado, sin base) y recorre los
controladores con `ModulesContainer`. Para cada `@Body()`/`@Query()` falla si: el parámetro tiene nombre, el tipo no es
una clase (`Object`, `String`, etc.), la clase no tiene decoradores de class-validator, o algún campo propio de
`new Clase()` no tiene decorador (hace falta `declare`); aplica lo mismo a las clases anidadas, encontradas por la
metadata `nestedValidation`. Cuenta 20 bodies y 8 queries (anti falso verde). `INLINE_ALLOWLIST` está vacía y se verifica
que no acumule entradas obsoletas.

En `security-invariants.spec.ts`: las regex de `ID_FIELDS` y de "ningún DTO declara `mode`" aceptan el prefijo `declare`;
se quitaron las 5 entradas `orgId: 'ignored'`; invariantes nuevos: sin `enableImplicitConversion: true` (y el pipe
declara `false`), sin `@Allow(`, y `pipes-config.ts` con `whitelist: true` y `forbidNonWhitelisted: true`.

## 6. Tests agregados o ajustados

Backend (de 39 suites / 682 tests a **42 suites / 770 tests**):
- `pipes-config.spec.ts` (nuevo, 11): controlador sonda; sobrante, anidado, campo `declare`, body no objeto, sin conversión
  implícita, errores sin valores, query que descarta `mode`/`orgId`/`organizationId`, `@Type(() => Number)`.
- `dto-validators.spec.ts` (nuevo, 5).
- `request-dto-invariants.spec.ts` (nuevo, 3).
- `org-isolation.spec.ts` (132 → 197): sección **(o)** (un caso por ruta con body: legítimo, sobrantes y tipos
  incorrectos, 400 `validation-failed` y `writeCount() === 0`; la ruta nueva sin caso hace fallar el test), body que no
  es objeto, 8 rutas con query (sobrante → mismo resultado, tipo incorrecto → 400), criterio 5 (`?userId=` ignorado en
  `pro/payers`) y guards con la whitelist (`?orgId=`/`?organizationId=` propio 200 y ajeno 403, `?mode=` en las 4
  variantes y `invalid-mode`); sección **(p)**: reenvía a las rutas reales los 30 casos del fixture
  `test/fixtures/frontend-request-bodies.json` (el mismo que lee el test del front).
- Ajustados: "un body con `organization.connect` … se ignora" ahora espera 400 sin escrituras (y 201 sin el campo);
  (g) `PUT org/activity-types` manda el body sin `code` y se suma el caso con `code` → 400.
- `login.spec.ts`: caso `remember: true` → 400. `security-invariants.spec.ts`, `config-handlers.spec.ts`,
  `patients-handlers.spec.ts` como en el paso 5.

Frontend (**87 tests** en total): `request-bodies.test.mts` (builder == body del fixture en cada caso, sin claves
prohibidas, subconjunto de la lista de campos, alias `gross`, `buildWorkItemsQuery`) y 3 tests en `api-routes.test.mts`.

## 7. Resultados de calidad

| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit` backend | OK |
| `npx tsc --noEmit` frontend | OK |
| `npm test` backend | 42 suites, 770 tests, todo en verde |
| `npm test` frontend | 87 tests, todo en verde |
| `npm run build` frontend (`NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK |
| ESLint backend (`npx eslint <archivos>`, nunca `npm run lint`) | Los archivos tocados ya tenían errores de baseline (casi todos `prettier` por CRLF/estilo y `no-unsafe-*`). Comparé cada archivo contra su versión de HEAD: ninguno quedó con más errores (varios bajaron, p. ej. `update-organization-command.ts` de 12 a 4); los archivos nuevos quedaron sin errores |
| ESLint frontend | `data.ts` 13, `PatientDirectory.tsx` 11, `PayerRulesManager.tsx` 5, `WorkItemForm.tsx` 34, igual que en HEAD; `request-bodies.ts` y los dos tests sin errores |

`prettier --write` solo sobre archivos que son íntegramente míos (nuevos o reescritos). En `org-isolation.spec.ts` formateé
únicamente las secciones (o) y (p) para no reformatear el resto del archivo.

## 8. Desvíos del diseño

1. **`FindAllPatientsQuery`: se quitó el `@Transform` de `page` y `limit`** (el diseño decía conservarlo y sumar
   `@Type`/`@IsInt`/`@Min`). Con `@Type(() => Number)` primero, el `@Transform(value ? Number(value) : default)` convertía
   `?limit=0` y `?page=abc` en el valor por defecto y respondía 200, contra el criterio 2 y el caso del diseño §8.2
   (`?limit=0` → 400). Quedan los defaults de la clase (`= 1`, `= 10`). Efecto: un valor vacío (`?page=`) da 400; el
   front siempre manda números.
2. **Bodies con `orgId`/`organizationId` ajeno responden 403 `org-access-denied`, no 400**: `OrgAccessGuard` lee
   `body.orgId`/`body.organizationId` antes del pipe (ya era así). Con el valor de la organización propia sí da 400
   `validation-failed`. Los tests de sobrante usan la organización propia y hay un test que cubre ambos.
3. **Conteo del invariante**: 20 bodies (no 21; B21 es el mock `PacientesTable`, que sigue sin DTO propio porque manda al
   mismo `POST activity`) y 8 queries.
4. `GetOrgConfigQuery` y `FindFeeRulesQuery` quedaron con campos comunes (sin `declare`): ya no pasan por el pipe, así que
   no aplica el problema de las claves `undefined`.
5. `FindAllActivitiesQueryHandler` conserva el chequeo defensivo del enum de `status` (sin casts, para no sumar errores de
   lint); el pipe ya lo rechaza antes.
6. `UpdatePatientCommand.firstName`/`lastName` pasaron a opcionales (como indica el diseño B19); `patientService.update`
   compila igual.
7. El fixture tiene 30 casos (24 con builder y 6 literales de funciones que ya mandaban un literal exacto); el diseño no
   fijaba la cantidad.

## 9. Cómo probarlo

```
cd backend  && npx tsc --noEmit && npm test
cd frontend && npx tsc --noEmit && npm test && NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 npm run build
```
Verificación en vivo: plan de `03-diseno-tecnico.md` §8.5 (no se levantó el stack ni `dev.ps1`). Sugerencias para el
tester: además de lo del plan, `GET /api/activity?limit=101` y `?page=abc` → 400, `GET /api/v1/patients?limit=0` → 400, y
revisar en DevTools los bodies de `POST`/`PUT activity` (no deben llevar `month`, `patient`, `type`, `gross`, `paid`,
etc.).

## 10. Pendientes y dudas para el PO

- Los ya decididos en `00-estado.md` siguen vigentes y van al BACKLOG: `RetroactiveModal` (#45/016), `PacientesTable`
  mock, fusionar `settings` con lo guardado, `paymentMethod` como enum.
- **Cambios visibles que conviene conocer** (todos dentro de lo aprobado): `alertsDays` negativo o mayor a 3650 ahora da
  400 (antes se guardaba); `status` inválido en `GET activity` da 400 (antes se ignoraba); `limit` > 100 da 400; ids
  malformados en body/query dan 400 en lugar de 404/500.
- `frontend/src/app/test-suite/page.tsx` (página de pruebas que escribe en la base, regla 9) manda objetos sueltos que
  los builders recortan; no se tocó y no se usa contra datos reales.
- `DashboardKpiQueryDto` (`dashboard/Dtos/dashboard-kpi-query.dto.ts`) no lo usa ningún controlador: queda como código
  muerto, fuera de alcance.
- La clasificación `'ignored'` de `ID_FIELDS` quedó sin entradas; se dejó el tipo por si se vuelve a necesitar.

## 11. Notas para los siguientes roles

- **Revisor:** los mismos DTOs se usan como clase de request y body (patrón `declare`); revisar que todo campo asignado
  por un controlador sea `declare` y que no haya `@Allow`. `useDefineForClassFields: true` en `tsconfig.spec.json` es
  clave para que Jest reproduzca producción (ES2023). Archivos sueltos fuera del feature que siguen modificados en el
  árbol y no son de este cambio: `.claude/settings.json`, `global-prefix-config.ts`, `logger-config.ts`,
  `public-decorator.ts` (solo EOL), `docs/features/PLAN-pendientes.md`, `docs/features/015-transacciones/`,
  `.vscode/`, `frontend/AGENTS.md`.
- **Seguridad:** campos del controlador (`id`, `organizationId`, `orgId`, `userId`) no se pueden inyectar: en bodies dan
  400 y en queries se descartan (tests en (o) y en `pipes-config.spec.ts`). Los mensajes de validación nombran la
  propiedad enviada (`property x should not exist`) pero nunca el valor (`validationError.value: false`, probado). Los
  guards no cambian; `forbidUnknownValues` rechaza bodies no objeto. `x-mode` y `?mode=` siguen sin declararse en ningún
  DTO (invariante del 009 intacto).
- **Tester:** el fixture `backend/test/fixtures/frontend-request-bodies.json` tiene los bodies que arma el front; sirve para
  armar los pedidos de la verificación en vivo. Las rutas sin verificación previa (`POST org/categories`, `org/presets`,
  `pro/payers`, `v1/patients`, `PUT org`, `PUT pro/profile`) no se prueban en vivo (las cubre Jest), como indica el diseño.

---

## Vuelta de corrección 1

Corrige los hallazgos de `05-revision.md` (M1 a M5, S5) y `06-seguridad.md` (B-1 a B-3, I-3). Sin commit ni push; sin tocar
schema, `.env`, `.claude/`, `scripts/` ni `docs/features/015-*`.

### Forma de los roles de tipos de actividad (M5)
`ActivityType.roles` es `Json?`. La forma documentada en `schema.prisma` y escrita por la UI (`ActivityTypesManager`, `EMPTY_ROLE =
{ roleLabel: '', isRequired: true, feeStrategy: 'CATEGORY' }`) es `{ roleLabel, isRequired, feeStrategy: 'CATEGORY'|'FIXED',
fixedPercentage? }`. Hasta el 014 el backend guardaba lo que llegara, sin validar, así que los datos viejos pueden no traer
`isRequired`, `feeStrategy` o `fixedPercentage`. Quién los lee: `ActivityService` usa `roleConfig?.isRequired ?? true` y trata un
`feeStrategy` ausente como honorario 0; `WorkItemForm` usa `r.isRequired` (ausente = opcional). Solo `roleLabel` es imprescindible.

Cambio: `ActivityTypeRoleDto` ahora tiene `roleLabel` obligatorio e `isRequired`, `feeStrategy` y `fixedPercentage` opcionales
(con sus validadores de tipo/enum/rango cuando vienen). Nueva `normalizeActivityTypeRoles` (exportada en
`activity-type-commands.ts`) que create y update usan antes de guardar: completa `isRequired = false`, `feeStrategy = 'CATEGORY'`
y guarda solo las 4 claves. Se mantienen los topes (`roleLabel` 100, `fixedPercentage` 0-100, FIXED sin porcentaje sigue 400,
máx. 3 roles en el handler).
**Desvío / duda:** `isRequired` por defecto `false` (como pidió el PO y como lo interpreta el formulario), pero
`ActivityService` hoy lee un `isRequired` ausente como `true` y `EMPTY_ROLE` de la UI arranca en `true`. Un rol viejo sin
`isRequired` que se edite desde la UI queda `false` (hoy el formulario ya lo mostraba como opcional). `feeStrategy` ausente pasa
a `CATEGORY` (antes daba honorario 0): es el valor que la UI muestra por defecto. Si el PO prefiere `true`, es un solo valor en
`normalizeActivityTypeRoles`.

### Por hallazgo
- **M5:** lo anterior. Test en `org-isolation.spec.ts` (`M5: roles viejos ...`): create y update con roles sin `isRequired`/
  `feeStrategy`, verifica lo guardado, y que siguen dando 400 un rol sin `roleLabel`, FIXED sin porcentaje y claves de más.
- **B-1:** `RequestValidationPipe` (pipe de body) usa un `exceptionFactory` propio: aplana los errores como Nest pero el
  constraint `whitelistValidation` se reemplaza por `NON_WHITELISTED_MESSAGE = 'El cuerpo contiene campos no permitidos.'`
  (una sola vez, sin la clave del cliente, también en anidados). El resto de los mensajes y el `validation-failed` del 013 no
  cambian. Tests en `pipes-config.spec.ts` (clave con caracteres raros no aparece en la respuesta; varios sobrantes dan un
  mensaje; sobrante + error de tipo) y la aserción de (o) ahora exige el texto genérico.
- **B-2:** `@ArrayMaxSize(MAX_ACTIVITY_TYPE_ROLES_INPUT = 20)` en `roles` de create y update. Casos con 21 roles en (o).
- **B-3:** nuevo `IsOptionalNotNull()` en `dto-validators.ts` (`ValidateIf(v !== undefined)`: `undefined` se omite, `null` falla
  el `@IsString`). Aplicado a `UpdateOrganizationCommand.name`, `UpdatePatientCommand.firstName`/`lastName`,
  `UpdateProProfileDto.displayName` y `UpdateActivityTypeCommand.name` (esta última encontrada en la revisión: `name` es columna
  no nulable y el handler pasaba el `null` a Prisma). Revisé el resto de los `@IsOptional` de update/create: apuntan a columnas
  nulables (`cuit`, `phone`, `email`, `cardValue`, `linkedType`, `retentionPercentage`, `percentage`) o el handler ya filtra
  (`UpdateActivityCommand` usa `if (command.x)`). Casos `null` en (o) para cada ruta (400, 0 escrituras).
- **I-3:** `@IsObject()` en `settings` de `PUT org` (un array o un texto dan 400). Casos en (o).
- **M1:** `MAX_PAGE_NUMBER = 10_000` (`app.constants.ts`) con `@Max` en `page` de `FindAllActivitiesQuery`,
  `FindAllPatientsQuery` y `GetPayersQuery`. Casos `page=99999999999` (las tres rutas) y `page=10001` en la tabla de queries de (o).
- **M2:** `WorkItemForm.handleSubmit` valida `typeof gross === 'number' && Number.isFinite(gross)` y muestra el toast "El monto
  no es válido." en lugar de crear la atención sin monto. `alertsDays` vacío (`parseInt('')` = NaN): antes `JSON.stringify` lo
  guardaba como `null` dentro del JSON de `settings`; ahora la clave no viaja y no se guarda. La UI lo lee con
  `alertsDays || 60` en ambos casos, así que el comportamiento visible es el mismo; documentado en el comentario de
  `withFiniteNumbers` (`request-bodies.ts`).
- **M3:** no se pueden borrar: `CreateActivityDto` (lo usa `ActivityService.createActivity` y `CreateActivityCommandHandler`)
  y `DashboardKpiQueryDto` (lo usa `DashboardService.getKpis`) son tipos internos con referencias vivas, no código muerto. En
  lugar de eliminarlos se convirtieron en `interface` sin decoradores de class-validator, con un comentario que aclara que el
  contrato del request es `CreateActivityCommand` / `GetDashboardKpisQuery`. `ActivityParticipantDto` (clase validada) queda en el
  mismo archivo. `tsc` y los tests lo confirman.
- **S5:** caso `null` literal en `pipes-config.spec.ts` (400).
- **M4 (opcional, hecho):** `maxLength={100}` en los 3 inputs de búsqueda (`PatientDirectory` x2, `SmartFilterBar`).

### Archivos
Backend: `src/infrastructure.bootstrap/config/app/pipes-config.ts` y `.spec.ts`; `.../core/validation/dto-validators.ts`;
`src/domain/constants/app.constants.ts`; `application/features/config/commands/activity-type-commands.ts`,
`update-organization-command.ts`; `config/Dtos/update-pro-profile.dto.ts`; `patients/commands/update-patient-command.ts`;
`patients/queries/find-all-patients-query.ts`; `activity/queries/find-all-activities-query.ts`;
`config/commands/payer-commands.ts`; `activity/Dtos/create-activity.dto.ts`; `dashboard/Dtos/dashboard-kpi-query.dto.ts`;
`test/org-isolation.spec.ts`.
Frontend: `src/components/domain/workload/form/WorkItemForm.tsx`, `patients/PatientDirectory.tsx`,
`shared/SmartFilterBar.tsx`, `src/lib/request-bodies.ts` (solo comentario).

### Resultados
| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit` backend / frontend | OK / OK |
| `npm test` backend | 42 suites, 773 tests en verde (antes 770) |
| `npm test` frontend | 87 tests en verde |
| `npm run build` frontend (`NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK |
| ESLint backend (`npx eslint <archivos>`) | Archivos nuevos/propios (`pipes-config`, su spec, `dto-validators`, `update-pro-profile.dto`, `dashboard-kpi-query.dto`) en 0 errores; `update-organization-command` 12 (HEAD) a 2; `update-patient-command` y `create-activity.dto` igual que HEAD; `activity-type-commands.ts` 23 contra 22 de HEAD (baseline de `prettier`/`no-unsafe-*`; el +1 es un `any` heredado del `as any` del JSON) |
| ESLint frontend | `request-bodies.ts` 0; `WorkItemForm` 34, `PatientDirectory` 11, `SmartFilterBar` 3: igual que antes |

Nota: los casos nuevos de (o) están dentro de tests ya existentes (el conteo de `it` de `org-isolation.spec.ts` sube de 197 a 198 por el
test de roles viejos; los demás tests de Jest suben por los dos casos nuevos de `pipes-config.spec.ts`).

## Vuelta de corrección 2

Decisión del PO: el 014 no cambia montos ni comportamiento de datos existentes; `normalizeActivityTypeRoles` replica la lectura
actual de `ActivityService`.

### Cambio
`activity-type-commands.ts` (`normalizeActivityTypeRoles`):
- `isRequired` ausente pasa a `true` (antes `false`), igual que `isRequired ?? true` de `ActivityService` y `EMPTY_ROLE` de la UI.
- `feeStrategy` ausente se guarda SIN la clave (antes se completaba con `CATEGORY`), así `ActivityService` sigue dando honorario 0.
- `fixedPercentage` sin cambios. Comentario en la función que documenta que los defaults replican la lectura actual.

### Tests
`test/org-isolation.spec.ts`, test `M5: roles viejos ...` ajustado: lo guardado ahora es `isRequired: true` por defecto y sin clave
`feeStrategy` en roles que no la traen (`not.toHaveProperty('feeStrategy')`, porque `toEqual` ignora claves `undefined`); sigue
verificando que FIXED conserva su porcentaje y los casos inválidos (sin `roleLabel`, FIXED sin porcentaje, claves de más) dan 400.

### Resultados
| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit` backend | OK |
| `npm test` backend | 42 suites, 773 tests en verde |
| ESLint `activity-type-commands.ts` | 23 errores, igual que la vuelta 1 (baseline heredado) |
| ESLint `org-isolation.spec.ts` | baseline heredado de lint del archivo de test (sin correr `--fix`) |

Desvío cerrado: el pendiente de decisión de la vuelta 1 queda resuelto.
