# 03 — Diseño técnico: 014-validation-whitelist

Fuentes leídas: `CLAUDE.md`, `01-spec.md` (9 criterios), 005 §1 y §3.5, 007 (diseño, implementación, `fee-rule-splits`,
contrato del front en `org-isolation.spec.ts` (g)), 009 `06-seguridad.md` (INFO-1), 013 `03-diseno-tecnico.md` (§2.2 a
§2.4 y §4), `BACKLOG.md` (#12, #43, #52 y la nota de #12). Código: `pipes-config.ts`, los 9 controladores registrados,
todas las clases de `@Body()` / `@Query()`, `org-access-guard.ts`, `view-mode-guard.ts`, `security-invariants.spec.ts`,
`test/org-isolation.spec.ts`, `test/all-routes-auth.spec.ts`, `frontend/src/services/data.ts` y todos sus llamadores.

> **Dependencia del 013.** El desarrollador del 013 tiene hoy en el árbol de trabajo cambios en los filtros,
> `error-contract.ts`, `fee-rule-splits.ts`, `update-organization-command.ts`, `staff-`, `payer-` y
> `activity-type-commands.ts`, `activity.service.ts`, `org-isolation.spec.ts` y (según su diseño) `data.ts`. Este
> diseño se leyó sobre ese estado intermedio. Todo lo marcado **[013]** se implementa **después del commit del 013** y
> sobre su versión final.

---

## 1. Estado actual verificado

| Pieza | Hallazgo |
|---|---|
| `pipes-config.ts` | `new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } })`. Sin `whitelist`, `forbidNonWhitelisted` ni `forbidUnknownValues` (Nest lo fija en `false`). El 013 no lo cambia (su §2.4). |
| Orden de ejecución | Guards → interceptores → pipes. `OrgAccessGuard` (`x-org-id`, `?organizationId`, `?orgId`, `body.organizationId`, `body.orgId`) y `ViewModeGuard` (`x-mode`, `?mode`) leen el `request` crudo **antes** del pipe. El pipe trabaja sobre una instancia nueva (`plainToClass`) y no modifica `req.query` ni `req.body`. **Los guards no se ven afectados por la whitelist.** El único choque posible es `forbidNonWhitelisted` respondiendo 400 por un parámetro que no declara el DTO. |
| Whitelist y decoradores | `whitelist` descarta toda propiedad **sin metadata de class-validator**. `@ApiProperty`, `@ApiHideProperty` y `@Type` **no cuentan**. Hoy hay clases de `@Body()` **sin ningún** decorador de class-validator (`UpdateOrganizationCommand`, `CreatePatientCommand`, `UpdatePatientCommand`) y campos sueltos sin decorar (`FindAllPatientsQuery.search`). Con `whitelist` a secas esos endpoints perderían todos (o esos) campos: el pedido llegaría vacío. |
| **Campos de clase en producción vs Jest** | `tsconfig.json` usa `target: ES2023`, así que `useDefineForClassFields` vale `true`: un campo declarado sin decorar (`id: string; // From Param`) se emite como campo nativo y **toda instancia tiene la clave propia `id` = `undefined`** (verificado en `dist/.../update-activity-command.js`: `class UpdateActivityCommand { id; date; ... }`). Con `forbidNonWhitelisted`, class-validator recorre `Object.keys(instancia)` y respondería **siempre** `property id should not exist`, aunque el cliente no mande `id`. **Jest usa `tsconfig.spec.json` con `target: ES2019`** (semántica de asignación, sin esa clave): los tests darían verde y producción fallaría en todos los `PUT`. Es el riesgo principal del feature (§3.4). |
| Conversión implícita | Convierte por `design:type`: `123` y `{}` a string en campos `string`, `"80"` a número en campos `number`. El login lo esquiva con `@Transform(({ obj, key }) => obj[key])` (005 §3.5). Las queries numéricas (`page`, `limit`) **ya** tienen `@Type(() => Number)` en `FindAllActivitiesQuery`, `GetPayersQuery` y `FindAllPatientsQuery`. No hay booleanos en query. |
| Ids | Todas las columnas son `@db.Uuid`. Los ids de path se validan en el handler con `requireId` (404 genérico). Los ids de query de `GET /activity` (`patientId`, `payerId`, `professionalId`) van directo al `where`: un valor que no es UUID hoy termina en 500 de Prisma. `UUID_REGEX` (guard y `org-resource`) acepta cualquier hex 8-4-4-4-12 (no exige versión RFC). |
| Enums | `PaymentStatus` y `AttendanceStatus` son enums de Prisma (`@prisma/client`). `FEE_STRATEGY` está en `app.constants.ts`. `basis`, `valueType`, `groupBy` y `admisionNoCoAdmisorBehavior` son uniones de tipos sin constante runtime. `paymentMethod` y `serviceType` son `String` libres en la base (los valores de `PAYMENT_METHOD` existen solo en el front y `serviceType` admite códigos propios de cada organización). |
| Montos | `Decimal(10,2)`: máximo 99.999.999,99. `fee-rule-splits.ts` ya tiene `MAX_FIXED = 99_999_999.99`. Ningún DTO de montos tiene tope ni rechaza `NaN`/`Infinity` (los rechaza `@IsNumber` por defecto, pero no hay `@Max`). |
| Settings de la organización | `UpdateOrganizationCommand.settings: any`. El handler hace `{ ...command.settings sin cuit/address, alertsDays, emailNotifs }` y **reemplaza** el JSON: un ADMIN puede guardar cualquier clave (incluidas `privatePayerName`, `proModePrivatePatientPct` y las demás de `OrgSettings`) y cada guardado desde la UI borra las claves que no manda. |
| `fee-rules` | Solo hay `GET` y `POST`. "Editar" es el mismo `POST`: si ya existe una regla para el pagador y la categoría, actualiza `splits` (upsert). `CreateFeeRuleDto` ya tiene decoradores; `splits` es JSON libre validado en el handler por `validateFeeRuleSplits` (007), después del 404 del pagador y del 403 de permiso. |
| Invariantes vigentes | `security-invariants.spec.ts`: **"009: ningún comando, query ni DTO declara un campo mode"** (regex `^\s+mode\??\s*[:!]`), `ID_FIELDS` (cada `*Id` de clases `implements IRequest` clasificado; regex `^\s+(?:public readonly \|readonly )?(id\|\w+Id)\??\s*[:!]`) y "cada campo `controller` lo asigna el controlador" (regex `\.campo\s*=`). |

---

## 2. Relevamiento por endpoint

Rutas registradas: `AuthController`, `HealthController`, `ActivityController`, `OrgController`, `ProController`,
`DashboardController`, `FeeRulesController`, `PatientsController`, `SettlementsController`. Las rutas sin `@Body()` ni
`@Query()` (`GET health/liveness`, `POST v1/auth/logout`, `GET/DELETE activity/:id`, `GET org`, `DELETE org/*/:id`,
`GET org/activity-types`, `GET pro/context`, `GET pro/memberships`, `DELETE pro/payers/:id`,
`GET v1/patients/:id/debt` y `/summary`) no cambian: sus `@Param('id')` son `string` (el pipe no los valida) y siguen con
`requireId` y el 404 genérico del 007.

Leyenda del tipo actual: **C** clase con class-validator completa · **C\*** clase con campos sin decorar · **C0** clase
sin ningún decorador de class-validator · **I** tipo inline · **N** parámetro con nombre (`@Query('x')`).
"Asigna el controlador" = campos que se completan después del pipe desde `@CurrentOrgId()`, `@CurrentUserId()` o `:id`.

### 2.1 Bodies (21)

| # | Ruta | Clase actual | Tipo | Lo que manda el front (función de `data.ts` y origen) | Sobrantes del front | DTO propuesto (campos y validaciones) |
|---|---|---|---|---|---|---|
| B1 | `POST v1/auth/login` | `LoginRequestDto` | C | `login`: `{ user, password }` | — | Igual; **se quita el `@Transform`** (§3.3). `user` `@IsString @IsNotEmpty @MaxLength(254)`, `password` `@IsString @IsNotEmpty @MaxLength(128)`. |
| B2 | `POST activity` | `CreateActivityCommand` | C | `createWorkItem` (`mode` va al header). Desde `WorkItemForm` (`AdmisionesTable`, `AtencionesTable`): **todo el estado del formulario** `...formData` + derivados: `date` (Date→ISO), `month`, `patient`, `patientId`, `patientOrganizationId`, `type`, `professional`, `participantsByRole`, `hours`, `quantity`, `gross`, `baseValue`, `payer`, `status`, `paymentMethod`, `paymentDate` (`yyyy-MM-dd` o `''`), `presetId` (`''` posible), `packDates`, `attendance`, `activityTypeId`, `amount`, `professionalId` (`''` posible), `participants`, `payerId` (`null` posible), `organizationId`, `paymentStatus`, `paid`, `serviceType` | `month`, `patient`, `patientOrganizationId`, `type`, `professional`, `participantsByRole`, `gross` (alias declarado; el front manda también `amount`), `baseValue`, `payer`, `status`, `packDates`, `paid` | `organizationId` `@IsOptionalEntityId` (organización destino, *verified* en el servicio, BACKLOG #52); `date` `@IsDateString({ strict: true })`; `patientId` `@IsEntityId`; `professionalId`, `activityTypeId`, `presetId`, `payerId` `@IsOptionalEntityId` (acepta `''` y `null`, como `optionalId`); `participants` `@IsOptional @IsArray @ArrayMaxSize(MAX_ACTIVITY_PARTICIPANTS) @ValidateNested({ each: true }) @Type(() => ActivityParticipantDto)` con `professionalId` `@IsEntityId` y `roleLabel` `@IsString @MaxLength(100)`; `role` `@IsOptional @IsString @MaxLength(100)`; `serviceType` `@IsOptional @IsString @MaxLength(50)`; `hours` `@IsOptional @IsNumber() @Min(0) @Max(1000)`; `quantity` `@IsOptional @IsInt @Min(1) @Max(1000)`; `paymentStatus` `@IsOptional @IsEnum(PaymentStatus)`; `paymentMethod` `@IsOptional @IsString @MaxLength(50)`; `paymentDate` `@IsOptionalDateString`; `amount`, `gross`, `amountBase`, `amountCard` `@IsOptional @IsMoney`; `attendance` `@IsOptional @IsEnum(AttendanceStatus)`. |
| B3 | `PUT activity/:id` | `UpdateActivityCommand` | C\* (`id`) | `updateWorkItem`: `{ paymentStatus }` (deudores, workload), `{ attendance }` (atenciones), `{ paymentStatus, paymentDate, paymentMethod }` (modal de cobro), **todo el formulario** al editar desde `AdmisionesTable`/`AtencionesTable`, y `{ grossAmount, payerName }` desde `RetroactiveModal` (`workload/columns.tsx`) | En la edición, todo lo que no sea los 5 campos; `grossAmount` y `payerName` (el backend nunca los persistió: ver 008 y Aclaración 1) | `declare id`; `date` `@IsOptionalDateString`; `paymentStatus` `@IsOptional @IsEnum(PaymentStatus)`; `paymentMethod` `@IsOptional @IsString @MaxLength(50)`; `paymentDate` `@IsOptionalDateString`; `attendance` `@IsOptional @IsEnum(AttendanceStatus)`. (BACKLOG #43) |
| B4 | `PUT org` | `UpdateOrganizationCommand` | **C0**, `settings: any`, constructor | `updateOrgSettings` (settings/general): `{ name, cuit, address, settings: { alertsDays, emailNotifs } }` (`alertsDays` puede llegar `null` si el input queda vacío: `parseInt('')` → `NaN` → `null` en JSON) | — | Sin constructor; `declare id`; `name` `@IsOptional @IsString @MaxLength(200)`; `cuit` `@IsOptional @IsString @MaxLength(20)`; `address` `@IsOptional @IsString @MaxLength(500)`; `settings` `@IsOptional @ValidateNested() @Type(() => OrgSettingsDto)`. `OrgSettingsDto`: `alertsDays` `@IsOptional @IsInt @Min(0) @Max(3650)`; `emailNotifs` `@IsOptional @IsBoolean`; y las 5 claves de `OrgSettings` (Aclaración 3): `privatePayerName` `@IsOptional @IsString @MaxLength(100)`, `proModePrivatePatientPct` `@IsOptional @IsPercentage`, `defaultServiceType` `@IsOptional @IsString @MaxLength(50)`, `defaultEventRole` `@IsOptional @IsString @MaxLength(50)`, `admisionNoCoAdmisorBehavior` `@IsOptional @IsEnum(ADMISSION_NO_COADMISOR_BEHAVIOR)`. El handler arma `settings` solo con esas claves (descarta `undefined`). |
| B5 | `POST org/categories` | `CreateCategoryCommand` | C | `createCategory`: `{ name, percentage }` | — | **Se quita `orgId`** (hoy "se ignora"). `name` `@IsString @MaxLength(200)`; `percentage` `@IsOptional @IsPercentage`. |
| B6 | `PUT org/categories/:id` | `UpdateCategoryCommand` | C\* (`id`) | `updateCategory`: `{ name, percentage }` | — | `declare id`; ídem B5. |
| B7 | `POST org/presets` | `CreatePresetCommand` | C | `createOrgPreset` (`ReferenceValuesManager`, hoy no montado): `{ name, baseValue, cardValue \| null, linkedType }` | — | **Se quita `orgId`**. `name` `@IsString @MaxLength(200)`; `baseValue` `@IsMoney`; `cardValue` `@IsOptional @IsMoney` (`null` permitido); `linkedType` `@IsOptional @IsString @MaxLength(50)`. |
| B8 | `PUT org/presets/:id` | `UpdatePresetCommand` | C\* (`id`) | `updateOrgPreset`: ídem B7 | — | `declare id`; ídem B7. (BACKLOG #43) |
| B9 | `POST org/staff` | `CreateStaffCommand` | C | `createStaff` (`org/profesionales`): `{ name, surname, userId: '' \| id, cuit, email, phone, canLoadActivities, categoryId: '' \| id }`; (`ProfessionalManager`, no montado): `{ name, surname, email, cuit, phone, canLoadActivities }` | `userId` | **Se quita `orgId`**. `name`, `surname` `@IsString @MaxLength(100)`; `cuit` `@IsString @MaxLength(20)`; `email` `@IsOptional @IsEmail @MaxLength(254)` (como hoy); `phone` `@IsOptional @IsString @MaxLength(50)`; `canLoadActivities` `@IsOptional @IsBoolean`; `categoryId` `@IsOptionalEntityId`. |
| B10 | `PUT org/staff/:id` | `UpdateStaffCommand` | C\* (`id`) | `updateStaff`: el mismo `formData` de B9 | `userId`, `categoryId` (la categoría va por B11) | `declare id`; `name`, `surname` `@IsString @MaxLength(100)`; `cuit` `@IsOptional @IsString @MaxLength(20)`; `email` `@IsEmail @MaxLength(254)` (obligatorio, como hoy); `phone` `@IsOptional @IsString @MaxLength(50)`; `canLoadActivities` `@IsOptional @IsBoolean`. (BACKLOG #43) |
| B11 | `PUT org/staff/:id/category` | `AssignStaffCategoryCommand` | C\* (`id`) | `assignStaffCategory`: `{ categoryId }` | — | `declare id`; `categoryId` `@IsEntityId`. |
| B12 | `POST org/activity-types` | `CreateActivityTypeCommand` | C | `createActivityType` (`ActivityTypesManager`): `{ code, name, baseValue?, cardValue?, roles?: [{ roleLabel, isRequired, feeStrategy, fixedPercentage? }] }` | Al editar, `roles` sale de lo guardado en la base (`t.roles`): puede traer claves extra guardadas antes de la whitelist | **Se quita `orgId`**. `code` `@IsString @MaxLength(50)`; `name` `@IsString @MaxLength(200)`; `baseValue`, `cardValue` `@IsOptional @IsMoney`; `roles` `@IsOptional @IsArray @ValidateNested({ each: true }) @Type(() => ActivityTypeRoleDto)`. `ActivityTypeRoleDto`: `roleLabel` `@IsString @MaxLength(100)`; `isRequired` `@IsBoolean`; `feeStrategy` `@IsEnum(FEE_STRATEGY)`; `fixedPercentage` `@IsOptional @IsPercentage`. El tope de 3 roles sigue en el handler (mismo mensaje). |
| B13 | `PUT org/activity-types/:id` | `UpdateActivityTypeCommand` | C\* (`id`) | `updateActivityType`: el **mismo** payload de B12, **con `code`** | `code` (el update nunca lo cambió) | `declare id`; `name` `@IsOptional @IsString @MaxLength(200)`; `baseValue`, `cardValue`, `roles` como B12. (BACKLOG #43) |
| B14 | `PUT pro/profile` | inline `{ displayName?, cuit?, phone?, email? }` | **I** | `updateProfessionalProfile` (settings/general en vista pro): `{ displayName, cuit, phone, email }` (`''` posibles) | — | **DTO nuevo `UpdateProProfileDto`**: `displayName` `@IsOptional @IsString @MaxLength(200)`; `cuit` `@IsOptional @IsString @MaxLength(20)`; `phone` `@IsOptional @IsString @MaxLength(50)`; `email` `@IsOptional @IsString @MaxLength(254)` (sin formato: hoy acepta `''`). |
| B15 | `POST pro/payers` | `CreatePayerCommand` | C | `createPayer`: `{ name, retentionPercentage, cuit? }` | — | **Se quita `orgId`**. `name` `@IsString @MaxLength(200)`; `cuit` `@IsOptional @IsString @MaxLength(20)`; `retentionPercentage` `@IsOptional @IsPercentage`. |
| B16 | `PUT pro/payers/:id` | `UpdatePayerCommand` | C\* (`id`) | (sin función en `data.ts`) | — | `declare id`; `name` `@IsString @MaxLength(200)`; `retentionPercentage` `@IsOptional @IsPercentage`. (BACKLOG #43) |
| B17 | `POST fee-rules` | `CreateFeeRuleDto` (envuelto en `CreateFeeRuleCommand.data`) | C | `createFeeRule` (`PayerRulesManager`, 2 lugares): `{ payer: { connect: { id } }, professionalCategory: 'all', splits: [{ role, percentage, beneficiaryType } x2], name, organization: { connect: { id: orgSlug } } }` | `organization` | `name` `@IsString @MaxLength(200)`; `payerId` `@IsOptionalEntityId`; `payer` `@IsOptional @ValidateNested @Type(() => FeeRulePayerRefDto)` → `connect` `@IsOptional @ValidateNested @Type(...)` → `id` `@IsEntityId`; `professionalCategory`, `conditionProfessionalRole` `@IsOptional @IsString @MaxLength(100)`; `serviceType` `@IsOptional @IsString @MaxLength(50)`; `splits` `@IsDefined @IsArray` (el esquema completo sigue en `validateFeeRuleSplits`, §3.7); `validFrom`, `validTo` `@IsOptionalDateString`. |
| B18 | `POST v1/patients` | `CreatePatientCommand` | **C0**, constructor | `createPatient` (`PatientDirectory`): `{ firstName, lastName, email, phone, organizationId: orgSlug }` | `organizationId` (lo asigna el controlador) | Sin constructor; `declare organizationId`; `firstName`, `lastName` `@IsString @MaxLength(100)`; `email` `@IsOptional @IsString @MaxLength(254)` (sin formato: hoy acepta `''`); `phone` `@IsOptional @IsString @MaxLength(50)`. |
| B19 | `PUT v1/patients/:id` | `UpdatePatientCommand` | **C0**, constructor | `updatePatient`: `{ firstName, lastName, email, phone }` | — | Sin constructor; `declare id`; `firstName`, `lastName` `@IsOptional @IsString @MaxLength(100)`; `email`, `phone` como B18. (BACKLOG #43) |
| B20 | `POST v1/patients/:id/merge` | inline `{ targetId: string }` | **I** | `mergePatient`: `{ targetId }` | — | **DTO nuevo `MergePatientRequestDto`**: `targetId` `@IsEntityId`. El controlador arma `MergePatientCommand` como hoy (el chequeo del handler queda). |
| B21 | (B2 de `PacientesTable`) | — | — | `PacientesTable.handleNewEntry` llama `createWorkItem(orgSlug, entries)` con un **array**: el body sale `{ "0": {...} }`. Hoy ya da 400 (`date` falta). Componente marcado "Mock". | todo | Sin cambio en el backend (sigue 400). Aclaración 2. |

### 2.2 Queries (10)

Parámetros de los guards: `mode` lo lee `ViewModeGuard`; `orgId` y `organizationId` los lee `OrgAccessGuard`. **Ninguno
se declara en DTOs** (§3.2).

| # | Ruta | Clase actual | Tipo | Lo que manda el front | Sobrantes | DTO propuesto |
|---|---|---|---|---|---|---|
| Q1 | `GET activity` | `FindAllActivitiesQuery` | C | `getWorkItems`: `mode`, `page`, `limit` y los filtros con valor: `startDate`, `endDate`, `type`, `status` (Admisiones); `patient`, `status`, `startDate`, `endDate`, `payer` (Atenciones, `SmartFilterBar`); `patientId` (historial de paciente). Mapea `payer`→`payerId` y `patient`→`search`, **pero deja también `payer` y `patient`** | `patient`, `payer` (y `method` si se usara `SmartFilterBar` en modo org: hoy no) | `declare organizationId`; `startDate`, `endDate` `@IsOptionalDateString`; `patientId`, `professionalId`, `payerId` `@IsOptionalEntityId`; `status` `@IsOptional @IsEnum(PaymentStatus)`; `type`, `queryType` `@IsOptional @IsString @MaxLength(50)`; `paymentMethod` `@IsOptional @IsString @MaxLength(50)`; `search` `@IsOptional @IsString @MaxLength(100)`; `page` `@IsOptional @Type(() => Number) @IsInt @Min(1)`; `limit` `@IsOptional @Type(() => Number) @IsInt @Min(1) @Max(MAX_PAGE_SIZE)`. |
| Q2 | `GET org/config` | `GetOrgConfigQuery` (solo `orgId`, que asigna el controlador) | C | `getOrgConfig`: `?orgId=<slug>` | `orgId` (redundante con el header) | **Sin `@Query()`**: no tiene parámetros del cliente. El controlador arma `const query = new GetOrgConfigQuery(); query.orgId = orgId;`. El front deja de mandar `?orgId=` (§4). |
| Q3 | `GET org/staff/lookup` | `@Query('cuit') cuit: string` | **N** | (sin uso en `data.ts`) | — | **DTO nuevo `LookupStaffByCuitQueryDto`**: `cuit` `@IsOptional @IsString @MaxLength(20)`. El controlador despacha `new LookupStaffByCuitQuery(dto.cuit)`. |
| Q4 | `GET pro/payers` | `GetPayersQuery` | C | `getPayers`: `page`, `limit` (12 o 100) | — | `declare orgId`, `declare userId`; `page` `@IsOptional @Type(() => Number) @IsInt @Min(1)`; `limit` `@IsOptional @Type(() => Number) @IsInt @Min(1) @Max(MAX_PAGE_SIZE)`. |
| Q5 | `GET dashboard/kpis` | `GetDashboardKpisQuery` | C | `getDashboardStats`: `mode`, `startDate`, `endDate` (`yyyy-MM-dd`) | — | `declare organizationId`; `startDate`, `endDate` `@IsDateString({ strict: true })`; `basis` `@IsOptional @IsEnum(DASHBOARD_BASIS)`; `valueType` `@IsOptional @IsEnum(DASHBOARD_VALUE_TYPE)`. |
| Q6 | `GET dashboard/chart` | `GetDashboardChartQuery` | C | `mode`, `startDate`, `endDate`, `groupBy=day`, `basis` | — | `declare orgId`; fechas como Q5; `groupBy` `@IsEnum(CHART_GROUP_BY)`; `basis` `@IsOptional @IsEnum(DASHBOARD_BASIS)`. |
| Q7 | `GET dashboard/payers` | `GetDashboardPayerDistributionQuery` | C | `mode`, `startDate`, `endDate` | — | `declare orgId`; fechas como Q5. |
| Q8 | `GET fee-rules` | `FindFeeRulesQuery` (solo `organizationId`/`userId`, que asigna el controlador) | C | `getFeeRules`: nada | — | **Sin `@Query()`**: el controlador arma la query y asigna los dos campos. `?mode=org` se sigue ignorando (test (m) del 009). |
| Q9 | `GET v1/patients` | `FindAllPatientsQuery` | **C\*** (`search` sin decorar: **con whitelist se perdería la búsqueda**) | `getPatients`: `search`, `page`, `limit` (12 o 10), `mode` | — | `declare organizationId`, `declare userId`; `search` `@IsOptional @IsString @MaxLength(100)`; `page`, `limit` con su `@Transform` actual + `@Type(() => Number) @IsInt @Min(1)` (`limit` `@Max(MAX_PAGE_SIZE)`). |
| Q10 | `GET settlements/calculate` | `CalculateSettlementsQuery` | C | `calculateSettlements`: `month` (`yyyy-MM`) | — | `declare organizationId`; `month` `@IsString @Matches(/^\d{4}-(0[1-9]\|1[0-2])$/)` (hoy acepta `2026-13`). |

---

## 3. Decisiones

### 3.1 `whitelist: true` en todo; `forbidNonWhitelisted` solo en bodies (criterio 1)

- **Bodies: `forbidNonWhitelisted: true`.** Un campo no declarado responde 400 `validation-failed` con el mensaje
  `property <x> should not exist` (formato del 013). Es lo preferido por la spec y vuelve explícito el contrato de
  escritura. Requisito: el front deja de mandar sobrantes. Se limpian en `data.ts` (§4). Hoy los mandan B2, B3, B9, B10,
  B13, B17 y B18.
- **Queries: `whitelist: true` sin `forbidNonWhitelisted`.** Lo no declarado se descarta en silencio. Justificación:
  1. `?mode=` lo manda el front en dashboard, actividades y pacientes, y lo lee `ViewModeGuard`. **No se puede declarar
     `mode` en los DTOs**: lo prohíbe el invariante del 009 ("ningún comando, query ni DTO declara un campo mode"), que
     existe para que ningún handler lea el modo del cliente. La nota del BACKLOG #12 ("declarar el campo") contradice esa
     decisión de seguridad posterior.
  2. `?orgId=` y `?organizationId=` los lee `OrgAccessGuard` y están cubiertos por los tests (i) del 007. Con
     `forbidNonWhitelisted` en queries habría que declararlos en cada DTO o excluirlos con una lista, otra superficie de
     error.
  3. Un parámetro de query sobrante no escribe nada: descartarlo da la misma protección (no llega al handler).
- **Convivencia con los guards:** no hace falta ningún cambio. Los guards corren antes del pipe sobre el `request` crudo
  y el pipe no modifica `req.query` ni `req.body`. En queries, `mode`, `orgId` y `organizationId` se descartan del DTO
  después de que los guards los leyeron. En bodies, el único campo de organización legítimo es
  `CreateActivityCommand.organizationId` (organización destino, *verified*), que sigue declarado. `orgId` y
  `organizationId` en cualquier otro body responden 400 (además de lo que ya hace el guard).
- **Implementación:** un pipe global `RequestValidationPipe` (en `pipes-config.ts`) con dos `ValidationPipe` internos,
  uno por tipo de parámetro. No se agrega dependencia ni se reimplementa validación:

  ```ts
  const base: ValidationPipeOptions = {
    transform: true,
    whitelist: true,
    forbidUnknownValues: true,              // body que no es objeto (array, primitivo) o clase sin metadata: 400
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false }, // los errores no cargan el valor enviado
  };
  export class RequestValidationPipe implements PipeTransform {
    private readonly strict = new ValidationPipe({ ...base, forbidNonWhitelisted: true });
    private readonly lenient = new ValidationPipe({ ...base, forbidNonWhitelisted: false });
    transform(value: unknown, metadata: ArgumentMetadata) {
      return (metadata.type === 'body' ? this.strict : this.lenient).transform(value, metadata);
    }
  }
  export const configurePipes = (app: INestApplication) => app.useGlobalPipes(new RequestValidationPipe());
  ```
  - `param` y `custom` (`@CurrentOrgId()`, `@CurrentUserId()`) siguen igual: su metatipo es `String`, el pipe no los
    valida (`toValidate` devuelve `false`) y los `:id` siguen con `requireId`.
  - Se usa el `exceptionFactory` por defecto de Nest: `BadRequestException` con `message: string[]`, que el filtro del
    013 traduce a `validation-failed` (§2.2 punto 3 del 013). **[013]**
  - Las apps de test (`org-isolation`, `login-app`) ya llaman `configurePipes`: heredan el pipe nuevo.

### 3.2 Campos que asigna el controlador: `declare` (criterio 5)

- **Regla única:** todo campo de una clase de `@Body()` o `@Query()` es **(a)** entrada del cliente, con al menos un
  decorador de class-validator, o **(b)** asignado por el servidor (`:id`, `@CurrentOrgId()`, `@CurrentUserId()`), y
  entonces se escribe **`declare campo: tipo;`** sin decoradores.
- `declare` no emite el campo en JavaScript: la instancia no tiene esa clave hasta que el controlador la asigna. Así:
  - en bodies, si el cliente la manda, 400 (`forbidNonWhitelisted`); en queries, se descarta;
  - el controlador la asigna después del pipe, como hoy (`command.id = id`, `query.organizationId = orgId`), y el
    handler la lee igual;
  - no aparece en Swagger (hoy varios tienen `@ApiHideProperty`, que se quita porque no se puede decorar un `declare`).
- Campos afectados: `id` de B3, B4, B6, B8, B10, B11, B13, B16, B19; `organizationId` de B18, Q1, Q5, Q10; `orgId` de
  Q4, Q6, Q7; `userId` de Q4, Q9; `organizationId` de Q9.
- **Se quitan** los `orgId` "que se ignoran" de B5, B7, B9, B12 y B15: el front no los manda, el handler no los lee y
  con la whitelist pasan a ser 400. Se actualizan las 5 entradas `'ignored'` de `ID_FIELDS` y los `assign(..., { orgId })`
  de `config-handlers.spec.ts`.
- Se quitan los constructores de `UpdateOrganizationCommand`, `CreatePatientCommand` y `UpdatePatientCommand`:
  `plainToClass` llama `new Clase()` sin argumentos, y el constructor crearía las claves `id`/`organizationId` con
  `undefined`, el mismo problema de §3.4. El único uso con argumentos es `patients-handlers.spec.ts`
  (`new UpdatePatientCommand(id, 'Ana', 'Prueba')`), que pasa a `Object.assign(new UpdatePatientCommand(), {...})`.
- Las queries sin parámetros del cliente (Q2, Q8) dejan de pasar por el pipe: el controlador las construye. Cumple el
  criterio 4 sin inventar un DTO vacío y sigue cumpliendo el invariante "el controlador asigna el campo" (`\.orgId\s*=`).
- `CreateActivityCommand.organizationId` queda declarado (organización destino, verificada en `ActivityService` contra
  `scope.orgIds`; BACKLOG #52 lo trata aparte).

### 3.3 Sin conversión implícita (criterio 2)

- `enableImplicitConversion: false`. `class-transformer` copia los valores crudos: un `123` o un `{}` en un campo
  `@IsString` da 400, y un `"80"` en un `@IsNumber` también.
- **Query:** todo número lleva `@Type(() => Number)` (ya lo tienen `page`/`limit`; se suma en Q4 y Q9 el `@IsInt`, el
  `@Min` y el `@Max`). No hay booleanos en query. Si se agrega uno, va con un `@Transform` explícito (`'true'`/`'false'`),
  nunca `@Type(() => Boolean)` (`Boolean('false')` es `true`).
- **Body:** el front manda números JSON en todos los casos relevados (`parseFloat`, `parseInt`, sliders, `Switch`).
  Excepciones resueltas en el front (§4): `gross` puede quedar `''` un instante en el formulario; el builder omite los
  numéricos que no son `number` finito.
- **Anidados:** `@Type()` explícito en todo `@ValidateNested` (ya está en `participants`, `roles`, `payer`, `connect`;
  se agrega en `settings`).
- **Login:** se **quita el `@Transform`** de `LoginRequestDto` y su comentario. Con la conversión desactivada en el pipe
  global ya no hace falta, y `login.spec.ts` sigue probando que `user: 123` y `password: {}` dan 400. Si alguien
  reactivara la conversión implícita, ese test y el de §8.2 lo detectan.

### 3.4 Semántica de campos de clase: alinear Jest con producción

- Se agrega **`"useDefineForClassFields": true`** en `backend/tsconfig.spec.json`. Producción (ES2023) ya la usa, y hoy
  Jest (ES2019) no: sin este cambio, los tests no verían el `property id should not exist` de producción ni el
  invariante de §5 podría detectarlo.
- Es un paso aislado (§7, paso 1). Si algún test existente falla con el cambio, el error es real en producción y se
  corrige en ese paso.
- No se cambia `tsconfig.json` (`useDefineForClassFields: false` en producción cambiaría la semántica de todas las
  clases; descartado en §9).

### 3.5 Helpers de validación (criterio 3)

Archivo nuevo `backend/src/infrastructure.bootstrap/config/core/validation/dto-validators.ts`, junto a `org-resource.ts`
y la CQRS (los DTOs de `application/` ya importan de `infrastructure.bootstrap/config/core`). Composiciones con
`applyDecorators` de `@nestjs/common`, sin dependencias nuevas:

| Helper | Composición | Por qué |
|---|---|---|
| `IsEntityId()` | `IsUUID('loose')` | Mismo criterio que `UUID_REGEX` (cualquier hex 8-4-4-4-12, sin exigir versión RFC: `'all'` rechazaría ids de seeds locales del tipo `11111111-...`). Acepta mayúsculas, como `requireId`. |
| `IsOptionalEntityId()` | `ValidateIf(v => v !== undefined && v !== null && v !== '')` + `IsUUID('loose')` | `''` y `null` cuentan como ausente, como `optionalId` (el front manda `presetId: ''`, `professionalId: ''`, `payerId: null`, `categoryId: ''`). |
| `IsOptionalDateString()` | mismo `ValidateIf` + `IsDateString({ strict: true })` | `paymentDate: ''` es habitual y los handlers ya lo tratan como ausente. `strict` rechaza `2026-02-30`. |
| `IsMoney()` | `IsNumber({ allowNaN: false, allowInfinity: false })` + `Min(0)` + `Max(MAX_MONEY_AMOUNT)` | Tope de `Decimal(10,2)`. **Sin `maxDecimalPlaces`**: el front calcula `precio * horas` en coma flotante (`0.1 * 3`) y Postgres redondea a 2 decimales al guardar; exigir 2 decimales rompería cargas legítimas. |
| `IsPercentage()` | `IsNumber` finito + `Min(0)` + `Max(100)` | Categorías, retención, `fixedPercentage`, `proModePrivatePatientPct`. |

- Strings: `@IsString() @MaxLength(n)` directos (topes en §2, holgados para no rechazar datos existentes al editar).
  **No** se agrega `@IsNotEmpty` donde hoy no está: cambiaría la semántica (el front ya valida obligatorios).
- `ValidateIf` en falso omite todos los validadores de la propiedad: los dos helpers opcionales se usan solos.

**Constantes nuevas** en `src/domain/constants/app.constants.ts`: `MAX_MONEY_AMOUNT = 99_999_999.99` (lo usa también
`fee-rule-splits.ts` en lugar de `MAX_FIXED` **[013]**), `MAX_PAGE_SIZE = 100` (el front pide como máximo 100, en
`getPayers(…, 1, 100)`), `MAX_ACTIVITY_PARTICIPANTS = 10`, `DASHBOARD_BASIS = { ACCRUED, CASH }`,
`DASHBOARD_VALUE_TYPE = { NET, GROSS }`, `CHART_GROUP_BY = { DAY: 'day', MONTH: 'month' }`. En
`domain/features/organization/org-settings.ts`: `ADMISSION_NO_COADMISOR_BEHAVIOR = { TO_ADMISOR, TO_ORG }` (el tipo de
`OrgSettings` pasa a derivarse de la constante).

### 3.6 Enums con constantes de dominio

- `@IsEnum(PaymentStatus)` y `@IsEnum(AttendanceStatus)` con los enums de Prisma (son los del dominio y ya se importan
  así en los handlers). `@IsEnum(FEE_STRATEGY)`, `@IsEnum(DASHBOARD_BASIS)` y similares con los objetos `as const`
  (`isEnum` compara contra `Object.values`).
- **No son enum**, y quedan `@IsString @MaxLength`: `paymentMethod` (la base tiene valores históricos y la lista vive
  solo en el front), `serviceType`/`type`/`linkedType`/`code` (códigos propios de cada organización), `role` y
  `professionalCategory` (`'all'` o nombre de categoría). Aclaración 7.

### 3.7 Validador de `splits` (fee rules)

- **Se conserva** `validateFeeRuleSplits` en el handler, como único dueño del esquema y en el mismo orden del 007
  (404 del pagador y 403 de permiso antes del 400 de splits). En el DTO se suma solo `@IsDefined() @IsArray()`, un
  chequeo estructural barato: un `splits` que ni siquiera es array responde 400 en el pipe.
- **No** se convierte en `@ValidateNested`: hay dos formas por elemento (UI y motor) y unificarlas es el 016.
- `splits` no es anidado validado: la whitelist **no** lo recorre. Las claves extra dentro de cada elemento las sigue
  rechazando `hasOnly` del validador.
- "Crear y editar" (criterio 3) es el mismo `POST` (upsert): un solo DTO cubre los dos casos. No hay ruta `PUT`.

### 3.8 Ids malformados en body y query: 400

- Un id de **body o query** que no es UUID responde ahora **400 `validation-failed`** en el pipe (antes: 404 en el
  handler, o 500 de Prisma en los filtros de `GET /activity`).
- Los **ids de path** no cambian: siguen con `requireId` y el 404 genérico idéntico del 007.
- No filtra información: el formato del UUID es público, y la distinción entre "existe", "es de otra organización" y
  "no existe" sigue siendo el mismo 404 para todo UUID bien formado. Aclaración 4.

---

## 4. Frontend

- **Módulo nuevo `frontend/src/lib/request-bodies.ts`**, puro, sin imports (o solo `./constants.ts` con la extensión,
  como `view-mode.ts`) para probarlo con `node --test`:
  - `pickDefined(obj, keys)`: copia solo esas claves y omite las `undefined`;
  - listas de campos por endpoint, que espejan los DTOs: `ACTIVITY_CREATE_FIELDS`, `ACTIVITY_UPDATE_FIELDS`,
    `STAFF_CREATE_FIELDS`, `STAFF_UPDATE_FIELDS`, `PATIENT_FIELDS`, `ORG_UPDATE_FIELDS`, `ORG_SETTINGS_FIELDS`,
    `PRO_PROFILE_FIELDS`, `FEE_RULE_FIELDS`, `PRESET_FIELDS`, `ACTIVITY_TYPE_CREATE_FIELDS`,
    `ACTIVITY_TYPE_UPDATE_FIELDS` y `ACTIVITY_TYPE_ROLE_FIELDS`;
  - un builder por función de escritura: `buildCreateActivityBody(data)` (participantes mapeados a
    `{ professionalId, roleLabel }`; los numéricos que no son `number` finito se omiten, así `gross: ''` o `NaN` no
    llegan; no manda `gross` porque ya manda `amount`; nunca manda `mode`), `buildUpdateActivityBody`,
    `buildStaffCreateBody`, `buildStaffUpdateBody`, `buildPatientBody`, `buildOrgUpdateBody` (settings con
    `alertsDays` y `emailNotifs`), `buildProProfileBody`, `buildFeeRuleBody` (sin `organization`), `buildPresetBody`,
    `buildActivityTypeBody(data, 'create' | 'update')` (roles con las 4 claves; `update` sin `code`), y
    `buildWorkItemsQuery(mode, filters, page, limit)` (solo `mode`, `page`, `limit`, `startDate`, `endDate`, `type`,
    `status`, `patientId`, `payerId` desde `payer` y `search` desde `patient`; descarta `payer`, `patient` y cualquier
    otra clave).
- **`services/data.ts`** **[013]**: `createWorkItem`, `updateWorkItem`, `createStaff`, `updateStaff`, `createPatient`,
  `updatePatient`, `updateOrgSettings`, `updateProfessionalProfile`, `createFeeRule`, `createOrgPreset`,
  `updateOrgPreset`, `createActivityType`, `updateActivityType` hacen `JSON.stringify(buildX(data))`. `getWorkItems` usa
  `buildWorkItemsQuery`. `getOrgConfig` deja de mandar `?orgId=${slug}` (la organización va en `x-org-id`, como ya hace
  `getActivityTypes`). Las demás (`login`, `createCategory`, `updateCategory`, `assignStaffCategory`, `createPayer`,
  `mergePatient`) ya arman literales exactos y no cambian. Las firmas `data: any` no cambian: no hay cascada de tipos en
  los componentes.
- **Llamadores:** se quita `organizationId: orgSlug` en `PatientDirectory.tsx` y `organization: { connect: ... }` en
  `PayerRulesManager.tsx` (datos muertos; el builder los descartaría igual, pero así el código no sugiere lo contrario).
  `workload/columns.tsx` (`RetroactiveModal`) **no cambia**: el builder deja el body en `{}` y el `PUT` sigue siendo el
  no-op de hoy (Aclaración 1).
- **Mensaje del 400:** con el 013, `toApiError` mapea `validation-failed` al genérico "Hay datos incompletos o con
  formato inválido..." **[013]**. El 014 no agrega textos.
- `mode` en la query (`dashboard`, `activity`, `v1/patients`) y el header `x-mode` **se mantienen**: son parámetros de
  guards, no de DTOs.

---

## 5. Invariante estático del criterio 4

Spec nuevo `backend/test/request-dto-invariants.spec.ts`. Arranca el `AppModule` real con `PrismaService` reemplazado
por el proxy de `all-routes-auth.spec.ts` (sin base) y recorre los controladores registrados con `ModulesContainer`,
igual que los specs existentes. Para cada método con ruta:

1. Lee `ROUTE_ARGS_METADATA` (`@nestjs/common/constants`) y toma los argumentos `RouteParamtypes.BODY` y `QUERY`
   (se ignoran los `__customRouteArgs__`, `PARAM`, `REQ`, `RES`).
2. **Falla** si el argumento tiene `data` (`@Body('x')`, `@Query('x')`): tipo inline con nombre.
3. Toma el metatipo de `design:paramtypes[index]`. **Falla** si es `undefined`, `Object` (tipo literal, `Record`,
   `any`), `String`, `Number`, `Boolean` o `Array`.
4. **Falla** si `getMetadataStorage().getTargetValidationMetadatas(metatipo, '', true, false)` está vacío (clase sin
   decoradores de class-validator).
5. **Falla** si alguna clave propia de `new metatipo()` no tiene metadata. Esto detecta un campo sin decorar que no es
   `declare` (el `property id should not exist` de producción, o un campo que la whitelist borraría, como
   `FindAllPatientsQuery.search` hoy). Requiere el paso de §3.4.
6. Repite 4 y 5 en las clases anidadas: para cada propiedad con metadata `NESTED_VALIDATION`, hace
   `plainToInstance(metatipo, { [prop]: {} })` (o `[{}]` si la metadata es `each`) y toma el `constructor` del valor
   resultante. Así se encuentran `ActivityParticipantDto`, `ActivityTypeRoleDto`, `FeeRulePayerRefDto`,
   `FeeRulePayerConnectDto` y `OrgSettingsDto` sin una lista a mano.

- **Lista blanca:** `INLINE_ALLOWLIST: Record<'<método> <ruta>', string>`, **vacía**. Toda entrada futura necesita
  justificación, y el test verifica que cada entrada siga existiendo (como `WHERE_ID_ALLOWLIST`).
- El test también cuenta las rutas con body o query (21 y 8 después del cambio) para que un refactor que deje de
  enumerarlas no dé un falso verde.

**Ajustes en `security-invariants.spec.ts`:**
- Las regex de `ID_FIELDS` y de "ningún comando declara `mode`" aceptan el prefijo `declare `
  (`(?:public readonly |readonly |declare )?`). Sin eso, `declare organizationId` desaparecería de la clasificación y
  `declare mode` evadiría el invariante del 009.
- `ID_FIELDS`: se quitan `CreateActivityTypeCommand.orgId`, `CreateCategoryCommand.orgId`, `CreatePayerCommand.orgId`,
  `CreatePresetCommand.orgId` y `CreateStaffCommand.orgId`. Las demás entradas quedan (incluido `GetOrgConfigQuery.orgId`
  y `FindFeeRulesQuery.*`, que el controlador sigue asignando).
- Invariantes nuevos (estáticos, sobre el texto):
  - `enableImplicitConversion: true` no aparece en `src/`;
  - nadie usa `@Allow(` (dejaría pasar cualquier valor por la whitelist);
  - `pipes-config.ts` contiene `whitelist: true` y `forbidNonWhitelisted: true` (la prueba de comportamiento está en
    §8.1).

---

## 6. Archivos

### Crear
| Archivo | Contenido |
|---|---|
| `backend/src/infrastructure.bootstrap/config/core/validation/dto-validators.ts` | Helpers de §3.5 |
| `backend/src/infrastructure.bootstrap/config/core/validation/dto-validators.spec.ts` | Unit de los helpers (`''`, `null`, mayúsculas, UUID suelto, fechas estrictas, topes) |
| `backend/src/infrastructure.bootstrap/config/app/pipes-config.spec.ts` | Comportamiento del pipe (§8.1) |
| `backend/src/application/features/patients/dtos/merge-patient-request.dto.ts` | `MergePatientRequestDto` |
| `backend/src/application/features/config/Dtos/update-pro-profile.dto.ts` | `UpdateProProfileDto` |
| `backend/src/application/features/config/Dtos/lookup-staff-by-cuit-query.dto.ts` | `LookupStaffByCuitQueryDto` |
| `backend/test/request-dto-invariants.spec.ts` | Invariante del criterio 4 (§5) |
| `backend/test/fixtures/frontend-request-bodies.json` | Bodies que arma el front, compartidos con el test del front (§8.3) |
| `frontend/src/lib/request-bodies.ts` | Builders y listas de campos (§4) |
| `frontend/src/lib/request-bodies.test.mts` | Tests de los builders contra el fixture |

### Modificar (backend)
| Archivo | Cambio |
|---|---|
| `src/infrastructure.bootstrap/config/app/pipes-config.ts` | `RequestValidationPipe` + `configurePipes` |
| `tsconfig.spec.json` | `"useDefineForClassFields": true` |
| `src/domain/constants/app.constants.ts` | Constantes de §3.5 |
| `src/domain/features/organization/org-settings.ts` | `ADMISSION_NO_COADMISOR_BEHAVIOR` |
| `src/application/features/auth/dtos/login-request.dto.ts` | Sin `@Transform` |
| `src/application/features/activity/commands/create-activity-command.ts`, `Dtos/create-activity.dto.ts` (`ActivityParticipantDto`) | Validaciones de B2 |
| `src/application/features/activity/commands/update-activity-command.ts` | B3 (`declare id`, enums, fechas) |
| `src/application/features/activity/queries/find-all-activities-query.ts` | Q1 |
| `src/application/features/config/commands/update-organization-command.ts` **[013]** | B4: sin constructor, `OrgSettingsDto`, handler arma `settings` con las claves declaradas |
| `src/application/features/config/commands/category-commands.ts`, `preset-commands.ts`, `staff-commands.ts` **[013]**, `activity-type-commands.ts` **[013]**, `payer-commands.ts` **[013]** | B5 a B13, B15, B16, Q4 |
| `src/application/features/config/queries/get-org-config-query.ts` | Sin decoradores (ya no pasa por el pipe) |
| `src/application/features/dashboard/queries/*.ts` | Q5 a Q7 |
| `src/application/features/fee-engine/commands/fee-rule-commands.ts` | B17; `FindFeeRulesQuery` sin decoradores |
| `src/application/features/fee-engine/fee-rule-splits.ts` **[013]** | `MAX_MONEY_AMOUNT` en lugar de `MAX_FIXED` |
| `src/application/features/patients/commands/create-patient-command.ts`, `update-patient-command.ts` | B18, B19 |
| `src/application/features/patients/queries/find-all-patients-query.ts` | Q9 |
| `src/application/features/settlements/queries/calculate-settlements-query.ts` | Q10 |
| `src/api/controllers/v1/config/org-controller.ts` | Q2 sin `@Query`, Q3 con DTO |
| `src/api/controllers/v1/config/pro-controller.ts` | B14 con DTO |
| `src/api/controllers/v1/fee-engine/fee-rules-controller.ts` | Q8 sin `@Query` |
| `src/api/controllers/v1/patients/patients-controller.ts` | B20 con DTO |
| `src/security-invariants.spec.ts` | §5 |
| `src/application/features/config/config-handlers.spec.ts` **[013]**, `patients/patients-handlers.spec.ts` | Sin `orgId` en los `assign`; `UpdatePatientCommand` sin constructor |
| `test/org-isolation.spec.ts` **[013]** | §8.2 y §8.3 |

### Modificar (frontend) **[013]**
`src/services/data.ts`, `src/services/api-routes.test.mts`, `src/components/domain/patients/PatientDirectory.tsx`,
`src/components/domain/pro/settings/PayerRulesManager.tsx`, `package.json` (agrega `src/lib/request-bodies.test.mts` al
script `test`).

### Sin cambios
Guards, filtros (los toca el 013), `ActivityController` (su `create` y `update` ya asignan después del pipe), schema
(sin migración).

---

## 7. Plan de implementación (pasos chicos)

Cada paso termina con `npx tsc --noEmit` y `npm test` del área en verde.

0. **Esperar el commit del 013** y releer los archivos marcados **[013]**.
1. `tsconfig.spec.json`: `useDefineForClassFields: true`. Correr toda la suite Jest. Si algo falla, es un bug real de
   producción: se corrige en este paso y se documenta.
2. Constantes (`app.constants.ts`, `org-settings.ts`) y `dto-validators.ts` con su spec.
3. DTOs por área, con el pipe actual todavía puesto (más decoradores y `declare` no rompen nada con la configuración
   vieja). Orden: patients (B18, B19, Q9: incluye el `search` sin decorar), activity (B2, B3, Q1), config (B4 a B13,
   Q4), pro y fee-rules (B15 a B17), dashboard y settlements (Q5 a Q7, Q10). Un commit lógico por área.
4. Controladores: B14, B20 y Q3 con DTO; Q2 y Q8 sin `@Query()`.
5. `security-invariants.spec.ts` (regex con `declare`, `ID_FIELDS`, invariantes nuevos) y los specs de handlers
   afectados.
6. `request-dto-invariants.spec.ts` (§5): tiene que dar verde con lo hecho hasta acá.
7. Frontend: `request-bodies.ts` y su test con el fixture; `data.ts` usa los builders; limpieza de
   `PatientDirectory`/`PayerRulesManager`; `getOrgConfig` sin `?orgId=`; `api-routes.test.mts`. Correr `npm test`,
   `npx tsc --noEmit`, `npm run lint` y `npm run build` del front.
8. **Cambio del pipe** (`RequestValidationPipe`) y `pipes-config.spec.ts`; quitar el `@Transform` del login.
9. `org-isolation.spec.ts`: actualizar los tests que cambian de resultado (§8.2) y agregar las secciones nuevas.
10. Calidad completa (criterio 8) y verificación en vivo (§8.5).

El paso 8 va después del 7 para que en ningún punto intermedio el front mande sobrantes a un backend estricto.

---

## 8. Estrategia de tests

### 8.1 Pipe (`pipes-config.spec.ts`, app de prueba con un controlador sonda y `configurePipes`)
- Body: campo sobrante → 400 con `property x should not exist`; sobrante anidado (`nested.x`) → 400; campo `declare`
  enviado (`id`) → 400; body array → 400; body primitivo → 400; legítimo → 2xx, y el handler recibe una instancia de la
  clase sin claves extra.
- Sin conversión implícita: `123`, `{}` y `true` en un `@IsString` → 400; `"80"` en un `@IsNumber` de body → 400.
- Query: sobrante → 2xx y el handler no ve la clave; `declare` enviado (`?userId=`) → descartado; `?page=2` con
  `@Type(() => Number)` → `2` numérico; `?page=abc` → 400.
- Los errores no incluyen valores (`validationError.value: false`).

### 8.2 Por endpoint (Jest por HTTP, sección nueva "(o) 014" en `org-isolation.spec.ts`, con su seed y `fake-prisma`)
Tabla con `it.each`: para cada fila, el caso legítimo da 2xx; los otros dos, 400 `validation-failed` y
`fake.writeCount() === 0`.

| Ruta | Sobrante (→ 400) | Tipo incorrecto (→ 400) |
|---|---|---|
| `POST v1/auth/login` (en `login.spec.ts`) | `remember: true` | (ya existen) `user: 123`, `password: {}` |
| `POST activity` | `paid: true`; `createdByUserId` | `date: 'ayer'`; `amount: '100'`; `amount: 1e9`; `paymentStatus: 'PENDING'`; `participants: [{ professionalId: 'x' }]` |
| `PUT activity/:id` | `id`; `grossAmount` | `attendance: 'FOO'`; `paymentDate: '31/12/2026'` |
| `PUT org` | `settings.foo`; `id` | `settings.alertsDays: '60'`; `name: 123` |
| `POST`/`PUT org/categories` | `orgId` | `percentage: '80'`; `percentage: 101` |
| `POST`/`PUT org/presets` | `serviceType` | `baseValue: '3'`; `baseValue: -1` |
| `POST org/staff` | `userId` | `canLoadActivities: 'true'`; `categoryId: 'x'` |
| `PUT org/staff/:id` | `categoryId`; `userId` | `email: 'no-mail'` |
| `PUT org/staff/:id/category` | `id` | `categoryId: 5` |
| `POST`/`PUT org/activity-types` | `roles[0].extra`; `code` (solo en `PUT`) | `roles[0].feeStrategy: 'OTRA'`; `roles[0].isRequired: 'yes'`; `baseValue: '100'` |
| `PUT pro/profile` | `userId` | `displayName: 5` |
| `POST`/`PUT pro/payers` | `orgId`; `isManagedBySystem` | `retentionPercentage: '10'`; `150` |
| `POST fee-rules` | `organization` (el test actual "se ignora" pasa a esperar **400 sin escrituras**) | `splits: 'x'`; `payer.connect.id: 'x'`; `validFrom: 'ayer'` |
| `POST v1/patients` | `organizationId` | `firstName: 1` |
| `PUT v1/patients/:id` | `id`; `organizationId` | `email: {}` |
| `POST v1/patients/:id/merge` | `sourceId` | (ya existen: `null`, `5`, `''`, `['x']`) |

Queries (sobrante → 2xx con el mismo resultado que sin él; tipo incorrecto → 400):

| Ruta | Sobrante | Tipo incorrecto |
|---|---|---|
| `GET activity` | `?foo=1`, `?patient=x`, `?payer=x` | `?page=abc`, `?limit=1000`, `?patientId=x`, `?status=FOO`, `?startDate=xx` |
| `GET v1/patients` | `?userId=<otro usuario>` | `?limit=0`, `?search[a]=b` |
| `GET pro/payers` | `?userId=<otro usuario>` (mismo resultado) | `?page=-1` |
| `GET dashboard/kpis`, `chart`, `payers` | `?foo=1` | `?basis=XYZ`, `?groupBy=week`, `?startDate=no` |
| `GET settlements/calculate` | `?foo=1` | `?month=2026-13` |
| `GET org/staff/lookup` | `?foo=1` | `?cuit[]=a` |

**Criterio 5 (campos del controlador):** `organizationId` en `POST v1/patients` → 400; `id` en cada `PUT` → 400;
`?userId=<otro>` en `pro/payers` y `v1/patients` → el resultado es el del usuario del token; `?organizationId=<propia>`
en `dashboard/kpis` → 200 con datos de esa organización, y `<ajena>` → 403 del guard (ya lo cubren (i) y (k); se suma un
caso con la whitelist activa).

**Guards con la whitelist:** siguen en verde, sin cambios, (i) (`?orgId=` y `?organizationId=` sin header), (j)
(matriz de `?mode=` en `GET activity`, `dashboard/kpis`, `v1/patients`), (k) y (m) (`?mode=xyz` → 400 `invalid-mode`
del guard, antes del pipe; `GET fee-rules?mode=org` → 200). Se suma `GET org/config?orgId=<propia>` sin header → 200.

**Tests que cambian de resultado esperado:**
- "un body con `organization.connect` a otra organización se ignora" → ahora 400 sin escrituras.
- (g) `PUT org/activity-types/:id` con el payload de `ActivityTypesManager` → se manda el body del builder (sin `code`);
  se agrega un caso con `code` → 400.

### 8.3 Contrato con los bodies exactos del front
- `backend/test/fixtures/frontend-request-bodies.json`: por cada función de escritura de `data.ts`, uno o más casos
  `{ name, method, path, user, input, body }`. `input` es el objeto que arma el componente (el estado completo de
  `WorkItemForm` para crear y para editar, el `formData` de `org/profesionales`, el payload de `ActivityTypesManager`
  con `roles` leídos de la base con una clave extra, el de `PayerRulesManager` con `organization`, `settings/general`
  en las dos vistas, `{ grossAmount, payerName }` de `RetroactiveModal`, etc.). `body` es lo que tiene que salir del
  builder. Los ids van como marcadores (`"<<ptA1>>"`, `"<<payerA>>"`...).
- **Front** (`request-bodies.test.mts`): `buildX(input)` es igual a `body`, con los marcadores sin sustituir (los
  builders no validan ids). Además: ningún body contiene `mode`, `organization`, `userId`, `paid`, `gross`, ni `code` en
  el update de tipos de actividad; las claves de cada body son un subconjunto de su lista de campos.
- **Backend** (sección "(p) contrato del front 014" en `org-isolation.spec.ts`): sustituye los marcadores por ids del
  seed y manda cada `body` a su ruta con el usuario indicado; espera 2xx. Si alguien cambia un builder sin el fixture,
  falla el test del front; si cambia un DTO de forma incompatible, falla el del backend.
- Los dos tests leen el mismo archivo (repo único). Ningún build de Docker corre tests ni necesita el fixture.

### 8.4 Calidad (criterio 8)
Backend: `npx tsc --noEmit`, `npx eslint` sobre los archivos tocados (no `npm run lint`), `npm test`.
Frontend: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`.

### 8.5 Plan del tester en vivo (sin escrituras)
Con `.\dev.ps1` levantado por el usuario y un usuario ADMIN de una organización de prueba. Sin SQL; sin tocar los puertos
3000 ni 3001 de otros proyectos. Los conteos se toman por la API.

1. **Conteos antes:** `total` de `GET /api/activity?mode=ORGANIZATION&page=1&limit=1`, de
   `GET /api/v1/patients?page=1&limit=1` y largos de `GET /api/org/config` (categorías, presets, staff) y
   `GET /api/org/activity-types`.
2. **Solo rutas donde, si la validación fallara, el handler igual respondería 404 antes de escribir** (red de
   seguridad). Para cada una, un caso con un campo sobrante y otro con un tipo incorrecto; se espera 400
   `validation-failed`:
   - `POST /api/activity` con `patientId` = UUID aleatorio inexistente (+ `paid: true` / `amount: "100"`);
   - `POST /api/fee-rules` con `payer.connect.id` = UUID inexistente (+ `organization: {...}` / `splits: "x"`);
   - `POST /api/org/staff` con `categoryId` = UUID inexistente (+ `userId` / `canLoadActivities: "true"`);
   - `PUT` a `activity`, `org/categories`, `org/presets`, `org/staff`, `org/staff/<id>/category`,
     `org/activity-types`, `pro/payers` y `v1/patients` con **id de path aleatorio inexistente** (+ `id` en el body /
     un tipo incorrecto);
   - `POST /api/v1/patients/<uuid inexistente>/merge` con `{ targetId: 5 }` y con `{ targetId, sourceId }`;
   - `POST /api/v1/auth/login` con `{ user, password, remember: true }` y `{ user: 123, password: "x" }` (sin
     credenciales reales: un usuario ficticio).
   - **No** se prueban en vivo `POST org/categories`, `POST org/presets`, `POST pro/payers`, `POST v1/patients`,
     `PUT org` ni `PUT pro/profile`: no tienen una verificación previa que impida escribir si el pipe fallara. Los
     cubre Jest.
3. **Lecturas con guards:** `GET /api/dashboard/kpis?mode=ORGANIZATION&startDate=...&endDate=...` → 200;
   `GET /api/activity?mode=PROFESSIONAL` (usuario con Professional) → 200; `GET /api/v1/patients?mode=ORGANIZATION` →
   200; `GET /api/org/config?orgId=<propia>` sin `x-org-id` → 200; `GET /api/activity?orgId=<propia>` → 200;
   `?page=abc` y `?limit=1000` en `activity` → 400; `GET /api/settlements/calculate?month=2026-13` → 400.
4. **Navegador (solo lectura):** dashboard, admisiones con filtros, atenciones con filtros, pacientes con búsqueda,
   ajustes y configuración abren sin errores; en DevTools, los bodies de los formularios (abiertos y cancelados, o
   enviados solo en una organización de prueba si el PO lo autoriza) no tienen sobrantes.
5. `.\dev.ps1 -Smoke` OK.
6. **Conteos después:** iguales a los del punto 1.

---

## 9. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| `forbidNonWhitelisted` también en queries, declarando `mode`, `orgId` y `organizationId` en cada DTO (nota del BACKLOG #12) | Contradice el invariante del 009 (ningún DTO declara `mode`) y pone en los DTOs parámetros que solo leen los guards. No suma protección: una query sobrante no escribe. |
| `whitelist` sin `forbidNonWhitelisted` en ningún lado | No requeriría cambios en el front, pero la spec prefiere el 400 en bodies y un body con campos de más pasaría en silencio. |
| DTO de body separado del comando en los 21 endpoints | Correcto, pero duplica cada clase y obliga a copiar campo por campo en los controladores (otra lista blanca que se puede olvidar). `declare` logra lo mismo con el patrón actual (clase request = body). Se usan DTOs separados solo donde hoy hay tipos inline (B14, B20, Q3), como ya hacen login y fee-rules. |
| `useDefineForClassFields: false` en `tsconfig.json` | Cambiaría la semántica de campos de todas las clases en producción para esquivar un problema que `declare` resuelve en 15 campos. |
| `@Allow()` en los campos que asigna el controlador | Dejaría que el cliente los mande (el controlador los pisa), y abre una vía para saltear la whitelist. Se prohíbe por invariante. |
| Mover `validateFeeRuleSplits` a un `@ValidatorConstraint` | Cambia el orden 404/403/400 del 007 y su mensaje, y la forma de `splits` se unifica en el 016. |
| Mantener `enableImplicitConversion` con `@Transform` por campo, como el login | Deja la trampa por defecto: cada campo `string` nuevo nace convirtiendo `{}` en `"[object Object]"`. |
| Leer `mode`/`orgId` antes del pipe | Ya ocurre: los guards corren antes que los pipes. |
| `@IsUUID('all')` o `@IsUUID('4')` | Rechazarían UUIDs que la base y `UUID_REGEX` aceptan (seeds locales con ids "a mano"). |

---

## 10. Manejo de errores, rendimiento y compatibilidad

- **Errores:** todos los rechazos del pipe son `BadRequestException` con `message: string[]` → `validation-failed`
  (013), sin `details` ni valores. Los mensajes nombran la propiedad, incluida una clave inventada por el cliente
  (`property <clave> should not exist`). El 013 recorta a 20 mensajes de 200 caracteres, la respuesta es JSON y el front
  no muestra esos textos: riesgo bajo, queda como INFO para seguridad. Los 404/403 de los handlers no cambian.
- **Rendimiento:** despreciable. Ya se validaba cada request; se suma recorrer las claves para la whitelist y se elimina
  la conversión implícita. Mejora por topes: `limit` ≤ 100 y `participants` ≤ 10 (hoy cada participante es una
  consulta a la base).
- **Compatibilidad:**
  - Contrato de la API: más estricto (campos de más, tipos y formatos dan 400). El único cliente es el front, que se
    adapta en el mismo cambio. Swagger refleja los DTOs (los campos `declare` desaparecen de la documentación).
  - Cambios visibles: id de body o query malformado → 400 en lugar de 404/500; `?month=2026-13` → 400; `limit` > 100
    → 400; filtros `status` inválidos → 400 (hoy se ignoraban); `organization` en `POST fee-rules` → 400 (el front deja
    de mandarlo).
  - Sin cambios de schema ni migraciones.
- **Transacciones:** no se agregan escrituras. El handler de `PUT org` sigue con un solo `update`.

---

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| `property id should not exist` en producción y no en Jest (semántica de campos, §1) | `declare` (§3.2), `useDefineForClassFields: true` en `tsconfig.spec.json` (§3.4) y el chequeo 5 del invariante (§5). En vivo, los `PUT` del punto 2 de §8.5. |
| Un campo sin decorar que la whitelist borra en silencio (como `search`) | Chequeo 5 de §5. |
| El front manda un sobrante no relevado | Builders en un solo lugar, test del front con el fixture, replay en el backend y revisión de bodies en DevTools (§8.5). |
| Datos guardados con claves extra que vuelven en una edición (`roles` de tipos de actividad) | El builder mapea a las 4 claves; caso explícito en el fixture. |
| Valores existentes más largos que los `@MaxLength` | Topes holgados; solo afectan escrituras nuevas o ediciones de ese campo. |
| Conflictos con el 013 (mismos archivos) | Paso 0: se implementa después de su commit. |
| Superficie grande | Pasos por área (§7), con tsc y Jest en cada uno, y el pipe al final. |

---

## 12. Aclaraciones para el PO

Ninguna bloquea el diseño. Se aplican los defaults indicados salvo que el PO decida otra cosa.

1. **`RetroactiveModal` (`/work-items`, "Editar" con monto y pagador)** manda `grossAmount` y `payerName`, que el
   `PUT activity/:id` nunca persistió (conocido desde el 008). Hoy muestra "Actualizado correctamente" sin cambiar nada.
   **Default:** el builder descarta esos campos y el comportamiento queda igual (no-op con mensaje de éxito). Sugerencia
   para el BACKLOG: ocultar la acción o implementar la edición de montos en un feature propio.
2. **`PacientesTable` (`/org/pacientes`)** manda un array como body de `POST activity` y hoy ya recibe 400. Es un
   componente marcado "Mock". **Default:** queda igual. Sugerencia para el BACKLOG.
3. **Settings de la organización:** hoy un ADMIN puede guardar cualquier clave por API, y cada guardado desde la UI
   **reemplaza** el JSON (borra `privatePayerName`, `proModePrivatePatientPct` y las demás si estaban). **Default:** el
   DTO acepta las 2 claves de la UI y las 5 de `OrgSettings`, validadas; cualquier otra da 400. El reemplazo del JSON
   **no** cambia (es semántica de negocio). Sugerencia para el BACKLOG: fusionar con lo guardado. Si el PO prefiere
   aceptar solo `alertsDays` y `emailNotifs`, el cambio es quitar 5 campos del DTO.
4. **Ids malformados en body o query** responden 400 en lugar de 404 (los de path siguen con el 404 del 007). No filtra
   existencia. **Default:** aceptarlo.
5. **Fee rules "editar":** no hay ruta `PUT`. El `POST` hace upsert y su DTO cubre crear y editar.
6. **Clientes externos de la API:** cualquier integración que mande campos de más recibiría 400. Hoy el único cliente es
   el front.
7. **Sin enum** para `paymentMethod`, `serviceType`, `linkedType`, `code`, `role` y `professionalCategory`: son textos
   libres o códigos propios de cada organización, con valores históricos en la base. Quedan con tipo y largo máximo.
   Convertir `paymentMethod` en enum de dominio requiere relevar los datos existentes (otro feature).
8. **Topes elegidos:** montos 0 a 99.999.999,99 (sin negativos, como usa hoy la UI); porcentajes 0 a 100; páginas de
   hasta 100; hasta 10 participantes por atención; horas 0 a 1000; cantidad 1 a 1000; `alertsDays` 0 a 3650. **Default:**
   estos.
9. **`POST activity` con `patientId: ''`** pasa de crear una atención sin paciente a 400. El front nunca lo manda (sin
   paciente seleccionado ya falla hoy).
10. **Se quitan los `orgId` ignorados** de los bodies de creación de categorías, presets, staff, tipos de actividad y
    pagadores, y el `?orgId=` de `getOrgConfig` en el front. No cambia ningún resultado.

---

## 13. Trazabilidad con los criterios

| Criterio | Dónde |
|---|---|
| 1. `whitelist` y convivencia con guards | §3.1, §3.2 |
| 2. Sin conversión implícita, `@Transform` del login | §3.3 |
| 3. DTO validado en todo endpoint; fee rules, settings y #43 | §2, §3.5 a §3.7 |
| 4. Invariante estático | §5 |
| 5. Campos del controlador | §3.2, §8.2 |
| 6. Front sin romperse, limpieza en `data.ts`, mensaje genérico | §4, §8.3 |
| 7. Tests | §8.1 a §8.3 |
| 8. Calidad | §8.4 |
| 9. Verificación en vivo | §8.5 |

VEREDICTO: APROBADO
