# 07 — Testing: 014-validation-whitelist (incluye vueltas 1 y 2)

> Autor: tester. Fecha: 2026-11-04. No se modificó código de producción ni se agregaron tests (los 773 de Jest y los 87 del frontend cubren los criterios; la verificación en vivo los confirma). Sin seeds, SQL de escritura (solo `SELECT` dentro de `BEGIN READ ONLY`), commit, push, stash, reset ni checkout. Puertos 3000/3001 intactos; FRONTEND_PORT=3002; sin Docker para la app. Tokens HS256 firmados en memoria (issuer `solidus-api`, audience `solidus-web`, 10 min); no se imprimió ni guardó ningún token, secreto o dato personal. Scripts auxiliares solo en el scratchpad.

## 1. Resultados automáticos

| Comando | Resultado |
|---|---|
| backend `npx tsc --noEmit` | Sin errores |
| backend `npx jest` | 42 suites, 773 tests, todo en verde |
| frontend `npx tsc --noEmit` | Sin errores |
| frontend `npm test` (`node --test`) | 87 tests, 0 fallas |
| frontend `npm run build` (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK |
| ESLint | No lo corrí; lo informan 04 y 05 (sin errores nuevos respecto de HEAD en los archivos tocados) |

## 2. Inspección de datos existentes (solo lectura)

Solo estructura y conteos; sin nombres ni datos personales.

**`ActivityType.roles`** (3 tipos, los 3 con `roles`, los 3 arrays; 2 tipos con 1 rol, 1 tipo con 3 roles; 5 roles en total):

| Clave | Tipo JSON | Presencia (de 5 roles) |
|---|---|---|
| `roleLabel` | string (máx. 11 caracteres, ninguno vacío) | 5 |
| `isRequired` | boolean | 5 |
| `feeStrategy` | string: `FIXED` en 4, `CATEGORY` en 1 | 5 |
| `fixedPercentage` | number (valores 20, 30, 40, 50) | 4 (los 4 `FIXED`) |

Ningún rol sin `isRequired` o `feeStrategy`, ninguna clave extra, ningún porcentaje negativo, mayor a 100 ni no numérico.

**`Organization.settings`** (3 organizaciones, las 3 objetos JSON): 2 son `{}` y 1 trae `admisionNoCoAdmisorBehavior` (string, valor del enum vigente), `defaultEventRole` (string de 7 caracteres), `defaultServiceType` (string de 7), `privatePayerName` (string de 10) y `proModePrivatePatientPct` (number, 100). Sin `alertsDays` ni `emailNotifs` guardados. Todas las claves están entre las 7 que acepta `OrgSettingsDto`.

**Validación con el código real (copia en memoria, sin escribir):** script en el scratchpad (`check.ts`, `ts-node` con el `tsconfig` del backend) que carga los JSON exportados por `SELECT` y valida con `class-validator` (`whitelist`, `forbidNonWhitelisted`, `forbidUnknownValues`) las clases `UpdateActivityTypeCommand` y `UpdateOrganizationCommand`, y compara la semántica de `normalizeActivityTypeRoles` (`isRequired ?? true`, `feeStrategy` y `fixedPercentage` como estaban):

| Verificación | Resultado |
|---|---|
| `roles` de los 3 tipos validan en el DTO de update | 3 de 3 válidos, 0 fallas |
| `normalizeActivityTypeRoles` deja la misma semántica | 3 de 3 iguales, 0 diferencias |
| `settings` de las 3 organizaciones validan en `UpdateOrganizationCommand` | 3 de 3 válidos, 0 fallas |

Hallazgo: ningún registro existente fallaría la validación al editarse. Observación (decisión ya tomada del PO, sin cambio): `PUT org` reemplaza el JSON de `settings` completo con las 7 claves declaradas; una clave guardada que no mande el cliente se pierde (comportamiento previo, ya en el BACKLOG).

## 3. Verificación en vivo (modo desarrollo)

`.\dev.ps1` levantó DB, backend (8080) y frontend (3002). `.\dev.ps1 -Smoke`: Backend OK, Frontend OK, Login OK (corrido al final, con las pruebas ya hechas). Usuario ADMIN de la organización con más pacientes y un usuario con `Professional` para `mode=PROFESSIONAL`. Solo se enviaron pedidos que fallan antes de escribir (ids aleatorios inexistentes, campos sobrantes, tipos incorrectos) o lecturas. Todas las respuestas de error tienen solo las claves `code,errors`, sin `details`, stack ni Prisma, y sin reflejar la clave ni el valor enviados.

| Caso | Esperado | Obtenido |
|---|---|---|
| `POST activity` con `paid` + clave sobrante inventada; con `userId` inyectado | 400 genérico | 400 `validation-failed`, "El cuerpo contiene campos no permitidos." (sin el nombre de la clave) |
| `POST activity` `patientId` número, objeto, `no-uuid`, `''` | 400 | 400, "patientId must be a UUID" (los 4) |
| `POST fee-rules` con `organization` sobrante; con `splits: "x"` | 400 | 400 (sobrante genérico más errores de campos obligatorios; `splits must be an array`) |
| `POST org/staff` con `userId` sobrante; con `canLoadActivities: "true"` | 400 | 400 en ambos |
| `PUT` a `activity`, `org/categories`, `org/presets`, `org/staff`, `org/activity-types`, `pro/payers`, `v1/patients` con id de path inexistente y body `{id}` / `{name:123}` | 400 | 400 `validation-failed` en los 14 (genérico por `id` sobrante o `name must be a string`) |
| `PUT org/staff/<rnd>/category` con `categoryId: 5` | 400 | 400, "categoryId must be a UUID" |
| `POST v1/patients/<rnd>/merge` con `{targetId: 5}` y con `{targetId, sourceId}` | 400 | 400 en ambos (UUID / sobrante genérico) |
| Login `{user: 123, password: "x"}`; `{user: {}, ...}`; con `remember: true` | 400 | 400 `validation-failed` en los tres |
| `GET activity` `page=0`, `page=abc`, `page=10001`, `limit=101`, `limit=1000`, `limit=0`, `status=XYZ`, `patientId`/`payerId` malformados, `startDate` inválida | 400 | 400 en todos |
| `GET v1/patients` `page=0`, `page=abc`, `page=10001`, `limit=101`, `limit=0` | 400 | 400 en todos |
| `GET pro/payers?page=0`; `settlements/calculate?month=2026-13`; `dashboard/kpis` con fecha o `basis` inválidos | 400 | 400 en todos |
| `dashboard/chart` con `groupBy=month` válido / `groupBy=zzz` / sin parámetros | 200 / 400 / 400 | 200 / 400 / 400 (el front manda siempre `groupBy=day`) |
| `GET dashboard/kpis` y `dashboard/payers` con `?mode=ORGANIZATION`; `kpis` con `?orgId=` propio | 200 | 200 |
| `GET activity` con `?mode=ORGANIZATION`; con `?orgId=` propio y sin `x-org-id`; con `orgId`+`organizationId` propios y una clave basura | 200 | 200 en los tres (la clave basura de la query se descarta) |
| `GET activity?orgId=<ajeno>` | 403 `org-access-denied` | 403 `org-access-denied` |
| `GET v1/patients` con `?mode=ORGANIZATION`; con `?orgId=` propio y `search` | 200 | 200 |
| `GET org/config` sin `?orgId=`; con `?orgId=` propio y sin header | 200 | 200 (los dos) |
| `GET org/activity-types`, `fee-rules`, `settlements/calculate?month=2026-01` | 200 | 200 |
| Usuario con Professional: `GET activity?mode=PROFESSIONAL`, `dashboard/kpis?mode=PROFESSIONAL` | 200 | 200 |

Los "leak" que marcó el script en respuestas 200 son datos propios legítimos (el id de la organización propia en `v1/patients`, `org/config`, `org/activity-types`, y la clave `details` de `settlements/calculate`, que es un campo de negocio, no el `details` de error).

## 4. Criterio por criterio

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | `whitelist: true` (y `forbidNonWhitelisted` en bodies); la query cruda de los guards no se rompe | En vivo: sobrantes en body 400 genérico (28 casos); `?mode=`, `?orgId=`, `?organizationId=` más una clave basura en la query dan 200 y el `orgId` ajeno da 403. Jest: `pipes-config.spec` (11+), `org-isolation.spec` (guards con la whitelist) | Cumple |
| 2 | Sin conversión implícita peligrosa; `@Transform` del login quitado | En vivo: `user: 123` y `user: {}` en login, `patientId` número/objeto: 400; `page=abc`, `limit=0` en query: 400. Jest: sin `enableImplicitConversion: true` (invariante), `@Type(() => Number)` | Cumple |
| 3 | Todo endpoint con DTO validado, enums/fechas/ids/montos con tope | En vivo: UUID malformado, fecha inválida, enum de `status`/`basis`/`groupBy`, `month` y topes de `page`/`limit` dan 400. Jest: DTOs por área, `dto-validators.spec`. Datos existentes validan (sección 2) | Cumple |
| 4 | Invariante estático (controlador con `@Body()`/`@Query()` sin clase validada falla) | Jest: `request-dto-invariants.spec` (20 bodies y 8 queries, allowlist vacía); el desarrollador comprobó que falla al quitar un `declare` | Cumple |
| 5 | Campos del controlador (`userId`, `organizationId`, `id`) no inyectables | En vivo: `userId` e `id` en el body dan 400; `PUT` con `{id}` 400. Jest: sección (o), criterio 5 (`?userId=` ignorado en `pro/payers`), `security-invariants` en verde | Cumple |
| 6 | El frontend no se rompe; 400 con mensaje genérico | Jest/`node --test`: fixture de 30 bodies del front reenviado a las rutas reales (sección p) y `request-bodies.test.mts`; build OK; `groupBy=day`, `mode` y fechas del front aceptados en vivo. El render del toast se comprueba a mano (sección 6) | Cumple (UI pendiente de comprobación manual) |
| 7 | Tests Jest (sobrante, tipo, legítimo, invariante, guards, contrato) | 773 de Jest y 87 del front, en verde; 14 rutas con body en vivo coinciden con la sección (o) | Cumple |
| 8 | Calidad | `tsc` backend y frontend sin errores; Jest 773; `node --test` 87; build OK; ESLint según 04/05 | Cumple |
| 9 | Verificación en vivo sin escribir datos | Sección 3 completa, `-Smoke` OK, conteos sin cambios (sección 5) | Cumple |

## 5. Conteos (solo `SELECT count`, en `BEGIN READ ONLY`)

| Momento | User | Organization | Patient | WorkItem | Total de filas de `public` (sin `_prisma_migrations`) |
|---|---|---|---|---|---|
| Antes (tras levantar, durante la inspección) | 9 | 3 | 72 | 324 | 1483 (valor de referencia de la tarea) |
| Después (tras todas las pruebas y `-Smoke`, antes de `-Stop`) | 9 | 3 | 72 | 324 | 1483 |

## 6. Bugs

Ninguno.

Observaciones (no bloquean, ninguna incumple un criterio):
- Los mensajes de validación de campos salen en inglés desde la API (decisión de 013; el front muestra el genérico en español). El sobrante usa el texto genérico en español.
- Un body con un sobrante y campos obligatorios ausentes devuelve el genérico más los errores de los campos faltantes (`name must be a string`, etc.). No refleja valores.
- `GET dashboard/chart` sin `groupBy` da 400 (comportamiento previo, el front lo manda siempre).
- Un `?orgId=` ajeno en un body da 403 `org-access-denied` y no 400 (desvío 2 de 04, ya revisado por seguridad).

## 7. Lista de verificación manual en navegador (para el usuario)

1. `.\dev.ps1` y abrir http://localhost:3002 (red de seguridad: usar una organización de prueba para las escrituras).
2. Crear una atención (con paciente, tipo, pagador y monto) y editarla: se guarda sin 400. En DevTools, el body no debe llevar `month`, `patient`, `type`, `gross`, `paid`, etc.
3. Crear una atención con el monto vacío o no numérico: aparece el toast "El monto no es válido." y no se crea.
4. Configuración, tipos de actividad: editar los 3 existentes (con roles `FIXED` y `CATEGORY`) y guardar; los roles y porcentajes se conservan (`isRequired` y `feeStrategy` iguales).
5. Configuración de la organización: guardar `settings` (días de alerta, notificaciones y las demás); dejar `alertsDays` vacío no rompe; un valor negativo o mayor a 3650 se rechaza.
6. Crear un pagador y una regla de honorarios (con splits); editar una regla.
7. Pacientes: buscar por texto, paginar, crear y editar un paciente; fusionar dos pacientes de prueba.
8. Atenciones y dashboard: abrir con filtros, y cambiar entre modo organización y profesional.
9. Forzar un 400 (por ejemplo, un formulario con un campo inválido): el toast debe mostrar el mensaje genérico en español, sin JSON ni nombres de campos técnicos.
10. `.\dev.ps1 -Stop` al terminar.

## 8. Qué no pude verificar

- Render de toasts, formularios y bodies reales en el navegador (lista de la sección 7).
- Rutas sin verificación previa que impida escribir si el pipe fallara (`POST org/categories`, `org/presets`, `pro/payers`, `v1/patients`, `PUT org`, `PUT pro/profile`) y los casos legítimos de creación y edición: no se probaron en vivo por no escribir; los cubre Jest (sección (o) y fixture del front).
- El 200 de escrituras reales con el body exacto del front: solo Jest.
- ESLint (según 04/05) y modo Docker.

## 9. Estado del entorno

- `.\dev.ps1 -Stop` ejecutado: 2 procesos y el contenedor detenidos, datos de la base conservados. Puertos 3002, 8080 y 5433 libres; 3000 y 3001 no se tocaron.
- `scripts/dev-lib.tests.ps1` sigue en disco.
- Solo se suma este `07-testing.md` (más scripts en el scratchpad). `.env`, `backend/.env` y `.claude/` sin cambios míos.

VEREDICTO: APROBADO
