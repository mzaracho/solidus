# 05 — Revisión: 014-validation-whitelist

Revisor: agente `revisor`. Fecha: 2026-11-04. Base: commit 2155df6 más el árbol de trabajo (sin commit).
Se ignoró lo ajeno al feature (`global-prefix-config.ts`, `logger-config.ts`, `public-decorator.ts`,
`.claude/settings.json`, `.vscode/`, `frontend/AGENTS.md`, `docs/features/PLAN-pendientes.md`, `docs/features/015-*`).

## Resultados de calidad (corridos por el revisor)

| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit` backend | OK, sin salida |
| `npx tsc --noEmit` frontend | OK, sin salida |
| `npm test` backend | 42 suites, 770 tests, todo en verde |
| `npm test` frontend | 87 tests, todo en verde |
| `npm run build` frontend (`NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK |
| `npx eslint` archivos nuevos del backend (8) y `request-bodies.ts` / `request-bodies.test.mts` | 0 errores |
| `npx eslint` archivos modificados del backend (comparado contra `git show HEAD:` de cada uno) | Ninguno empeora; varios mejoran (`update-organization-command.ts` 12 a 2, `create-activity-command.ts` 7 a 5, `update-activity-command.ts` 10 a 9, `kpis` 3 a 2, `payer-dist` 26 a 24, `settlements` 168 a 165). El resto queda igual (baseline de `prettier`/`no-unsafe-*`) |
| `npx eslint` frontend (`data.ts` 13, `PatientDirectory` 11, `PayerRulesManager` 5, `WorkItemForm` 34 errores) | Igual que el informe del desarrollador; sin errores nuevos |

No se ejecutó `npm run lint` del backend, ni `dev.ps1`, ni SQL, ni se tocó el `.env`.

## Cumplimiento de los 9 criterios de la spec

| # | Criterio | Estado |
|---|---|---|
| 1 | `whitelist` global; `forbidNonWhitelisted` en bodies; guards intactos | Cumple. `RequestValidationPipe` usa dos `ValidationPipe` según `metadata.type`; `mode`, `orgId`, `organizationId` los leen los guards antes del pipe y ningún DTO los declara (invariante del 009 verde, ahora con prefijo `declare`) |
| 2 | Sin conversión implícita | Cumple. `enableImplicitConversion: false`, números de query con `@Type(() => Number)`, `@Transform` del login eliminado; `login.spec.ts` sigue probando `user: 123` y `password: {}` |
| 3 | Todo `@Body()`/`@Query()` con DTO validado | Cumple. Verifiqué los 28 usos en `src/api`: todos son clases. Fee rules (`splits` con `@IsDefined @IsArray` más `validateFeeRuleSplits` en el handler, mismo orden 404/403/400), settings (`OrgSettingsDto`), updates del #43 |
| 4 | Invariante estático | Cumple (ver comentarios abajo) |
| 5 | Campos del controlador no inyectables | Cumple. Revisé las 27 asignaciones `command.x =` / `query.x =` / `body.x =` de `src/api`: todas apuntan a un campo `declare` (o a `CreateActivityCommand.organizationId`, que es entrada legítima verificada en el servicio) |
| 6 | Frontend no se rompe | Cumple (ver recorrido de `data.ts` abajo) |
| 7 | Tests | Cumple: (o) por ruta con legítimo, sobrante y tipo incorrecto, `writeCount() === 0`; queries; guards con `?mode=`/`?orgId=`; (p) con el fixture compartido; `pipes-config.spec.ts` |
| 8 | Calidad | Cumple (tabla de arriba) |
| 9 | Verificación en vivo | Pendiente del tester |

## Hallazgos

### Bloqueantes
Ninguno.

### Mayores
Ninguno.

### Menores

**M1. `page` sin tope superior en `GET activity`, `GET v1/patients` y `GET pro/payers`.**
`backend/src/application/features/activity/queries/find-all-activities-query.ts` (campo `page`),
`.../patients/queries/find-all-patients-query.ts` (`page`) y `.../config/commands/payer-commands.ts` (`GetPayersQuery.page`).
`@IsInt @Min(1)` acepta `page=99999999999`; `skip = (page-1)*limit` supera el entero de 32 bits de Prisma y termina en 500
(antes también, pero el feature declara cerrar los casos de entrada numérica). Sugerencia: `@Max(1_000_000)` (constante
`MAX_PAGE_NUMBER` en `app.constants.ts`) y un caso `?page=99999999999` → 400 en (o).

**M2. Los builders descartan en silencio los numéricos no finitos.**
`frontend/src/lib/request-bodies.ts`, `withFiniteNumbers` (usado en `buildCreateActivityBody`, `buildOrgUpdateBody`,
`buildPresetBody`, `buildActivityTypeBody`). Es lo que pide el diseño (§3.3) y evita el 400 por `gross: ''`. Efecto
colateral: `alertsDays` vacío ya no se guarda como `null` sino que la clave desaparece, y un monto que quedó como string
(`gross` `''` por un `onBlur` que todavía no corrió en `WorkItemForm.tsx` líneas 821-826) crea la atención sin monto en
lugar de fallar. Sugerencia: dejarlo documentado en el comentario del builder (hoy solo dice "NaN de un input vacío") y,
si se quiere cerrar el caso del monto, en `handleSubmit` de `WorkItemForm` validar `Number.isFinite(formData.gross)` antes
de armar `baseItem`.

**M3. `CreateActivityDto` quedó como clase paralela con decoradores viejos.**
`backend/src/application/features/activity/Dtos/create-activity.dto.ts`: sigue con `@IsString` en ids, `@IsNumber()` sin
tope y `paymentStatus` como `string`. Solo se usa como tipo interno del servicio (el body real es `CreateActivityCommand`),
pero un lector puede creer que ese es el contrato. Sugerencia: dejarla sin decoradores de class-validator (solo tipos) o
agregar un comentario "tipo interno, el body se valida en `CreateActivityCommand`". Mismo caso, código muerto:
`dashboard/Dtos/dashboard-kpi-query.dto.ts` (ya anotado por el desarrollador).

**M4. Campos de texto libre con tope de largo que ahora devuelven 400.**
`search` (`@MaxLength(100)`) en `GET activity` y `GET v1/patients`; llega desde inputs de búsqueda sin `maxLength`
(`PatientDirectory`, `SmartFilterBar`, `WorkItemForm`). Un texto pegado de más de 100 caracteres da el mensaje genérico
del 013. Sugerencia: agregar `maxLength={100}` a esos inputs (o subir el tope a 200). No bloquea.

**M5. Montos negativos y `roles` heredados de la base dan 400 al editar.**
`IsMoney` exige `>= 0` (antes se aceptaba un `gross` negativo) y `ActivityTypeRoleDto` exige `isRequired` booleano y
`feeStrategy` del enum: un tipo de actividad guardado antes del 014 con un rol sin `isRequired` falla al editarse. Es
coherente con el diseño y el builder ya recorta claves de más, pero conviene anotarlo para el tester (probar editar los
tipos de actividad del seed local) y, si aparece, normalizar en el builder (`isRequired: Boolean(role.isRequired)`).

### Sugerencias

**S1. Documentar la regla `declare` en `CLAUDE.md`** (convenciones backend), como hizo el 007 con `requireOrgScope`: "los
campos de una clase de `@Body()`/`@Query()` que asigna el controlador se escriben `declare campo: tipo;`; el resto lleva
decoradores de class-validator; `@Allow` y `enableImplicitConversion: true` están prohibidos (lo vigilan
`request-dto-invariants.spec.ts` y `security-invariants.spec.ts`)". Es tarea del documentador.

**S2. El invariante no detecta un `declare` que no asigna nadie** (un campo de entrada del cliente escrito `declare` por
error daría siempre 400 en bodies). Hoy lo cubre el caso legítimo de (o)/(p) por ruta, pero una ruta sin caso (p) quedaría
sin red. Sugerencia opcional: en `request-dto-invariants.spec.ts`, para cada clave que tenga un `declare`, verificar con
una regex sobre el controlador que existe una asignación `\.campo\s*=`.

**S3. El `input` del fixture compartido está escrito a mano.** Es la parte del contrato que no se puede garantizar por
código (lo que realmente arma `WorkItemForm`), y el test del front solo prueba builder = `body`. Sugerencia: agregar en
el fixture un comentario con la fecha de relevamiento y revisar `input` cuando cambie `WorkItemForm`/`ActivityTypesManager`.

**S4. Fines de línea.** Varios archivos del feature están en LF en el árbol de trabajo y git avisa "LF will be replaced by
CRLF" (el repo normaliza en el commit). No es un problema, pero el diff crudo de esos archivos sale completo; conviene
revisar con `git diff --ignore-space-at-eol` (así lo hice) y no mezclar más cambios de EOL.

**S5. Test del pipe: caso `null`.** `pipes-config.spec.ts` prueba body array, texto y número; falta `null` literal. Nest
lo recibe como `{}` por el body-parser en modo estricto, así que no hay riesgo, pero el caso documentaría el comportamiento.

## Detalle de lo revisado

### `RequestValidationPipe` (`pipes-config.ts`)
Correcto. `whitelist: true` en ambos; `forbidNonWhitelisted` solo en body; `forbidUnknownValues: true`;
`enableImplicitConversion: false`; `validationError: { target: false, value: false }` (probado: el valor enviado no aparece
en la respuesta, solo el nombre de la propiedad). `param` y `custom` no pasan por validación (`:id` siguen con `requireId`
y el 404 genérico). Las apps de prueba (`login-app`, `org-isolation`) y `bootstrap.ts` usan `configurePipes`; no queda
otro `ValidationPipe` ni `useGlobalPipes` en `src/` ni `test/`.

### DTOs frente a lo que manda el frontend
- **Activity create/update:** ids con `IsOptionalEntityId` (aceptan `''`/`null`, como manda `WorkItemForm`: `presetId: ''`,
  `payerId: null`), `date` ISO estricto (acepta `yyyy-MM-dd` y `toISOString()`; verifiqué con `class-validator` 0.14.3),
  `paymentStatus` y `attendance` contra los enums de Prisma (el front manda `PAID/PARTIAL/UNPAID` y
  `PRESENT/ABSENT_*`), `quantity` entero (el input usa `parseInt`), `hours` 0 a 1000. Los sobrantes del formulario completo
  (`month`, `patient`, `type`, `gross`, `paid`, `packDates`...) los quita el builder; `mode` viaja solo en el header.
- **Org settings:** `OrgSettingsDto` con las 2 claves de la UI y las 5 de `OrgSettings`; el handler arma `settings` solo
  con esas claves y mantiene la semántica de reemplazo del JSON (comparado con HEAD). `alertsDays` 0 a 3650.
- **Staff, categorías, presets, pagadores, activity types:** coinciden con la tabla del diseño. `cardValue: null` en presets
  y `undefined` en tipos de actividad siguen produciendo el mismo resultado en el handler (`cardValue ? x : null`).
  `UpdateStaffCommand.email` obligatorio y `CreateStaffCommand.email: ''` → 400 ya eran así en HEAD (no es regresión).
- **Fee rules:** `FeeRulePayerRefDto`/`ConnectDto` anidados con `@Type`; `organization` ahora es 400 y el front ya no lo
  manda (`PayerRulesManager` en los dos lugares y el builder).
- **Pacientes:** `search` decorado (sin eso la whitelist lo borraba), `declare organizationId`/`id`/`userId`, sin
  constructores.
- **Dashboard y settlements:** fechas estrictas (`yyyy-MM-dd` que arma `getDashboardStats`), `basis` `ACCRUED/CASH` (los
  mismos que usa `dashboard/page.tsx`), `groupBy=day`, `month` `YYYY-MM` con mes 01-12 (el `<input type=month>`).

### Recorrido de `data.ts` y llamadores: ¿algún valor que ahora dé 400?
Recorrí todas las funciones con query o body y sus llamadores:
- `getWorkItems`: `page` desde 1; `limit` 20 (default), 12/18/24 (`PAGE_SIZE_OPTIONS`, `[12,18,24]` en `PatientDirectory`),
  nunca mayor a 100. `status` desde `SmartFilterBar`/`AdmisionesTable` solo `PAID/PARTIAL/UNPAID`; fechas `yyyy-MM-dd`
  (inputs de fecha y `handleDateSelect`); `type` es `t.code` (largo corto); `patientId` UUID; `payer` UUID. El builder
  descarta `payer`, `patient`, `method` y cualquier clave extra, y omite `''`/`null`.
- `getPatients`: `limit` 12/10/18/24; `page` desde 1; `search` solo se manda si no está vacío (ver M4 por el largo).
- `getPayers`: `limit` 12/18/24 y 100 (`AtencionesTable`), dentro del tope.
- `getDashboardStats`: fechas `yyyy-MM-dd` con `date-fns`; `chartBasis` es `ACCRUED|CASH`; `groupBy=day`.
- `calculateSettlements`: `month` `yyyy-MM`; `getOrgConfig`: sin query.
- `updateWorkItem`: `{paymentStatus}`, `{attendance}`, `{paymentStatus, paymentDate: yyyy-MM-dd, paymentMethod}` (modal de
  cobro) y la edición con el formulario completo reducida a 5 campos; `RetroactiveModal` queda en `{}` (no-op, como antes).
  Ningún `id` vacío llega: `patientId` vacío da 400 (decisión 9 del PO), el resto de los ids vacíos se aceptan como ausentes.
- Escrituras de formulario (staff, paciente, perfil, settings, preset, activity type, fee rule): los builders emiten solo
  claves de la lista; `userId`, `organizationId` (paciente), `organization` (fee rule) y `code` en el update ya no viajan.
- Literales sin builder (`login`, `createCategory`, `updateCategory`, `assignStaffCategory`, `createPayer`,
  `mergePatient`): ya enviaban solo claves declaradas. `createCategory` valida 0 a 100 en la UI.
- `PacientesTable` (mock) y `test-suite/page.tsx` siguen mandando datos inválidos: ya fallaban / no se usan contra datos
  reales (decisión 2 del PO y regla 9).
No encontré ninguna llamada del frontend con `limit` > 100, `page` 0, `status`/fechas con otro formato, `alertsDays` fuera
de rango por una vía normal (solo si el usuario escribe un valor fuera de 0 a 3650, caso aceptado) ni ids `''` que den 400.

### `declare`, `useDefineForClassFields` y el invariante
- `tsconfig.spec.json` con `useDefineForClassFields: true` alinea Jest (target ES2019) con producción (ES2023): ambos dejan
  los campos sin decorar como clave propia `undefined`. No encontré diferencias que oculten problemas: `strictNullChecks`
  distinto (false en spec) solo afecta a `design:type` de uniones, irrelevante con la conversión implícita apagada.
- `request-dto-invariants.spec.ts`: arranca el `AppModule` real, cuenta 20 bodies y 8 queries (anti falso verde), rechaza
  parámetros con nombre, tipos `Object/String/Number/Boolean/Array`, clases sin metadata y claves propias sin decorador,
  y recorre clases anidadas con `nestedValidation`. No encontré falsos negativos obvios; la lista blanca está vacía y se
  verifica que no acumule entradas. Ver S2 para el único hueco menor.
- `security-invariants.spec.ts`: las regex con `declare` evitan que `declare mode` o `declare organizationId` escapen a los
  invariantes del 009 y a `ID_FIELDS`; las cinco entradas `'ignored'` se quitaron correctamente.

### Desvíos del desarrollador
1. **Quitar el `@Transform` de `page`/`limit` en `FindAllPatientsQuery`:** aceptado. Con `@Type(() => Number)` delante, el
   `@Transform` anterior convertía `?limit=0` y `?page=abc` en el valor por defecto y devolvía 200, contra el criterio 2.
   Efecto: `?page=` vacío da 400 y el front siempre manda números.
2. **`orgId`/`organizationId` ajeno en el body → 403 del guard, no 400:** aceptado y correcto. `OrgAccessGuard` lee
   `body.orgId`/`body.organizationId` antes del pipe (ya era así desde el 007); con la organización propia se obtiene el
   400 del pipe. Hay tests que cubren ambos casos.
3. Conteo 20/8 en el invariante, `GetOrgConfigQuery`/`FindFeeRulesQuery` sin `declare` (el controlador las construye con
   `new`; no pasan por el pipe), `UpdatePatientCommand.firstName/lastName` opcionales y el fixture de 30 casos: coherentes
   con el diseño.

### Convenciones y mantenibilidad
- Capas, CQRS, alias `@src/*`, constantes en `app.constants.ts`, excepciones HTTP de Nest y comentarios en español: se
  respetan. El módulo `request-bodies.ts` del front es puro (sin imports), con listas de campos que espejan los DTOs y un
  test que las ata al fixture del backend: buen mecanismo de contrato.
- Comillas simples y trailing commas en los archivos nuevos del backend (eslint sin errores). `PatientDirectory`,
  `PayerRulesManager` y `WorkItemForm` solo perdieron datos muertos y comentarios desactualizados (cierra la tarea
  pendiente del 013).
- No se tocaron guards, filtros ni schema; no hay migración.

## Tests faltantes
Ninguno bloqueante. Sugeridos: `?page=99999999999` → 400 (M1); caso `null` del pipe (S5); verificar que cada `declare`
tenga una asignación en el controlador (S2).

Veredicto de la primera revisión (historial): aprobado, sin bloqueantes ni mayores.

---

## Re-revisión (vueltas 1 y 2)

Revisor: agente `revisor`. Se releyeron `CLAUDE.md`, esta revisión, `06-seguridad.md` y las vueltas 1 y 2 de `04-implementacion.md`,
y se revisaron los archivos de las vueltas.

### Calidad (corrida por el revisor)
| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit` backend / frontend | OK / OK |
| `npm test` backend | 42 suites, 773 tests en verde |
| `npm test` frontend | 87 tests en verde |
| `npm run build` frontend (`NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK |
| `npx eslint` (comparado con `git show HEAD:` vía `--stdin`) | `update-organization-command` 12 a 2; `update-patient-command` 3 = 3; `create-activity.dto` 2 = 2; `find-all-activities-query` 31 = 31; `app.constants` 8 = 8; `activity-type-commands` 22 a 23, `payer-commands` 23 a 24, `find-all-patients-query` 2 a 3 (el +1 de las dos últimas es `prettier` por el import de una línea con `MAX_PAGE_NUMBER`; el de `activity-type-commands` es el `as any` heredado). Archivos nuevos (`pipes-config`, su spec, `dto-validators`, `update-pro-profile.dto`, `dashboard-kpi-query.dto`): 0 errores |

No se corrió `npm run lint`, ni `dev.ps1`, ni SQL.

### Verificación de los puntos clave
- **`normalizeActivityTypeRoles` (vuelta 2): correcto.** `isRequired: role.isRequired ?? true` coincide con `roleConfig?.isRequired ?? true`
  de `ActivityService` (línea 313). `feeStrategy` ausente (o `null`) no se guarda: `calculateParticipantFee` devuelve 0, igual que antes.
  `fixedPercentage` se guarda solo si no es null, y `FIXED` sin porcentaje sigue dando 400 en el handler de create (se valida sobre
  `command.roles` antes de normalizar). Con `feeStrategy: 'FIXED'` + porcentaje o `'CATEGORY'` el cálculo de honorarios es idéntico.
  Los montos no cambian. Solo se descartan claves ajenas, que el DTO ya rechaza.
- **`exceptionFactory` del pipe (B-1): correcto.** Aplana como Nest, reemplaza el constraint `whitelistValidation` por
  `NON_WHITELISTED_MESSAGE` (también en anidados, porque la recursión pasa por la misma rama), deduplica con `Set`, conserva los demás
  mensajes con su prefijo y sigue siendo `BadRequestException`, así que el filtro del 013 lo traduce a `validation-failed`. Solo aplica al pipe de body.
- **`IsOptionalNotNull` (B-3):** `ValidateIf(v !== undefined)`; `null` cae en `@IsString`. Aplicado a los cinco campos listados
  (incluido `UpdateActivityTypeCommand.name`). Correcto.
- **`@IsObject` en `settings` (I-3):** presente antes de `@ValidateNested`; un array o texto da 400.
- **`@Max(MAX_PAGE_NUMBER)` (M1):** en `page` de las tres queries (activity, patients, pro/payers); `limit` con `MAX_PAGE_SIZE`.
- **`WorkItemForm` (M2):** `handleSubmit` valida `typeof gross === 'number' && Number.isFinite` antes de armar el item; `gross` arranca en 0
  y el `onBlur` lo repone, así que un flujo normal no queda bloqueado. `alertsDays` vacío: la clave no viaja; documentado en `withFiniteNumbers`.
- **`CreateActivityDto` y `DashboardKpiQueryDto` (M3):** ahora `interface` sin decoradores, con comentario que remite a
  `CreateActivityCommand` / `GetDashboardKpisQuery`. `tsc` y los tests lo confirman.
- **`maxLength={100}` (M4):** en `PatientDirectory` (x2) y `SmartFilterBar`.
- **S5:** caso `null` agregado en `pipes-config.spec.ts`.

### Hallazgos nuevos
**Bloqueantes:** ninguno. **Mayores:** ninguno.

**Menores**
- **N1. Comentarios desactualizados en `ActivityTypeRoleDto`** (`backend/src/application/features/config/commands/activity-type-commands.ts`,
  líneas 24 y 28-31): dicen "si falta, el handler guarda `false`" (descripción de Swagger: "default false") y "el handler guarda CATEGORY",
  pero tras la vuelta 2 se guarda `true` y sin clave. Sugerencia: corregir ambos textos y la descripción de `@ApiPropertyOptional`
  ("default true"; "si falta, no se guarda y el honorario es 0").
- **N2. Cambio visible acotado en `WorkItemForm` para roles viejos sin `isRequired`.** `WorkItemForm` filtra con `r.isRequired` (ausente =
  opcional), y ahora al editar un tipo de actividad el rol queda guardado con `isRequired: true`, así que el formulario pasaría a exigir ese rol
  (el servicio ya lo trataba como requerido al calcular). No cambia montos y es coherente con la decisión del PO; se anota para que el tester lo
  vea con los tipos de actividad del seed local (solo afecta a roles que se reeditan).
- **N3. Lint:** el import de una línea de `MAX_PAGE_NUMBER, MAX_PAGE_SIZE` suma un error de `prettier` en `find-all-patients-query.ts` y
  `payer-commands.ts` (+1 cada uno). Sugerencia: partir el import en varias líneas.

Los menores M1 a M5 y la sugerencia S5 de la primera revisión quedan resueltos. S1 a S4 siguen como sugerencias (S1 es del documentador).
B-1, B-2, B-3 e I-3 de `06-seguridad.md` quedan cubiertos.

VEREDICTO: APROBADO
