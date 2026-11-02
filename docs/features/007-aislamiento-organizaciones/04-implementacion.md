# 04 - Implementación: 007-aislamiento-organizaciones

> Autor: desarrollador. Entradas: `00-estado.md` (decisiones 1 a 3 y aclaraciones, prevalecen sobre la spec), `01-spec.md`,
> `03-diseno-tecnico.md` (aprobado) y `.claude/CLAUDE.md`.
> No se hizo commit ni push, no se ejecutó `dev.ps1`, no se levantó el stack, no hay SQL ni seeds ni schema nuevo
> (criterio 14), y no se tocó `.env`, `backend/.env` ni `.claude/`. Ids de los tests: UUID generados en ejecución.

## 1. Qué se hizo por paso del plan (§7 del diseño)

| Paso | Resultado |
|---|---|
| 1. Contexto | `OrgAccessContext.primaryOrgId` (x-org-id normalizado o primera fuente presente) en `auth-context.ts` y `org-access-guard.ts`. Nuevo `config/core/cqrs/request-context.ts` (`RequestContext`, `OrgScope`, `buildRequestContext` que congela, `requireOrgScope` que da 403 `org-access-denied`, `roleIn`). `Dispatcher` pasa el contexto como segundo parámetro de `execute`; `IRequestHandler.execute(command, context)`. Specs: `request-context.spec.ts`, `dispatcher.spec.ts`, `org-access-guard.spec.ts` ampliado. |
| 2. Helper | Nuevo `config/core/authentication/org-resource.ts` (`resourceNotFound`, `forbiddenAction`, `requireId`, `optionalId`, `inScope`, `inOrg`, `foundOr404`) y `AUTH_ERROR_CODE.NOT_FOUND = 'not-found'`. Spec: `org-resource.spec.ts`. |
| 3. Lecturas por id | `GET activity/:id`, `GET v1/patients/:id/debt` y `/summary` con `findFirst` + `inScope`, 404 genérico y `requireId` (un id que no es UUID da 404 sin consultar la base). |
| 4. Update y delete de atenciones | `activity-ownership.ts` con `canModifyActivity(item, scope, 'edit' \| 'delete')`. `UpdateActivityCommand` y `DeleteActivityCommand` pierden `userId` y `mode`; el controlador deja de leer `x-mode` en `PUT` y `DELETE`. Orden: 404, ownership (403 `forbidden`), regla de cobrada con fecha de pago (403, mensaje actual). Política según 00-estado (ver §3). |
| 5. Crear atención | `ActivityService.createActivity(dto, mode, scope)`: organización destino T en el scope (si no, 403 `org-access-denied`); permiso de carga primero; fase de lecturas (organización, `activityTypeId`, `presetId`, `payerId`, `patientId`, `professionalId` y participantes, todo con `inOrg(T)` y 404 genérico); escrituras en un solo `prisma.$transaction` con `tx` (pagador por defecto, `Professional` automático en `SOLO_PRACTICE`, `WorkItem`, participantes, splits). `FeeResolutionService.calculateSplits(context, db)` y `calculateParticipantFee(..., db)` reciben cliente opcional. `GET activity` suma `createdByUserId` a cada ítem. Se eliminan `userId` de `CreateActivityCommand` y de `CreateActivityDto` (el usuario sale del scope). |
| 6. Pacientes | `UpdatePatientCommandHandler` registrado (`@RequestHandler` + `@Injectable`; antes `PUT v1/patients/:id` daba 500) con paciente en el scope. `MergePatientCommandHandler`: `requireId` en los dos, iguales = 400, los dos en el scope y con el mismo `organizationId` (si no, 404), `updateMany` + `delete` en `$transaction`. |
| 7. Configuración | Categorías, presets, tipos de actividad y staff: creación con `scope.primaryOrgId` (el `orgId` del body se ignora), update/delete con `foundOr404(findFirst({ id, ...inScope }))` antes de escribir. `CreateCategoryCommand.orgId` pasa a opcional. Tipos por defecto (`organizationId` null): 404. `DeleteActivityType` cuenta usos después del control. `AssignStaffCategory`: profesional en el scope y categoría de la organización del profesional. `CreateStaff`: `categoryId` con `optionalId` + `inOrg`. `DeleteStaff`: profesional en el scope (404 en lugar del `Error` 500); el `User` se da de baja solo si no le quedan otros `Professional` activos ni membresías en otras organizaciones; se borra solo la membresía de esta organización. Nuevo `LookupStaffByCuitQuery` (CQRS), acotado a la organización, respuesta mínima `{ type: 'PROFESSIONAL', id, name, hasUser }` o `{ type: 'NOT_FOUND' }`; `OrgController` ya no inyecta `PrismaService`. |
| 8. Pagadores y reglas | `PUT/DELETE pro/payers/:id`: pagador en el scope (404) y después ADMIN o dueño (403). `POST pro/payers`: `userId` y organización del scope, `deletedAt: null` en la búsqueda del `Professional`; sin `Professional` exige ADMIN; el CUIT de organización registrada se rechaza con 400 y mensaje sin nombre. `POST fee-rules`: `CreateFeeRuleDto` explícito, `data` de Prisma armado con lista blanca, pagador de la organización del request (404), permiso ADMIN o dueño del pagador (403). |
| 9. Eliminaciones y front | Ver §2 y §4. |
| 10. Integración y estructura | `test/helpers/fake-prisma.ts`, `test/helpers/scope.ts`, `test/org-isolation.spec.ts`, `security-invariants.spec.ts` ampliado, `frontend/src/services/api-routes.test.mts` y script `test` del front. |
| 11. Calidad | Ver §6. |

## 2. Archivos

**Creados (backend, src):** `config/core/cqrs/request-context.ts` (+ `.spec.ts`), `config/core/cqrs/dispatcher.spec.ts`,
`config/core/authentication/org-resource.ts` (+ `.spec.ts`), `application/features/activity/activity-ownership.ts`,
`application/features/activity/activity-handlers.spec.ts`, `application/features/config/queries/lookup-staff-by-cuit-query.ts`,
`application/features/config/config-handlers.spec.ts`, `application/features/fee-engine/fee-rule-commands.spec.ts`,
`application/features/patients/patients-handlers.spec.ts`, `infrastructure/features/activity/activity.service.spec.ts`.
**Creados (backend, test):** `test/helpers/fake-prisma.ts`, `test/helpers/scope.ts`, `test/org-isolation.spec.ts`.
**Creado (frontend):** `src/services/api-routes.test.mts`.

**Modificados (backend):** `auth-context.ts`, `org-access-guard.ts` (+ spec), `dispatcher.ts`, `i-request-handler.ts`,
`activity-controller.ts`, `create/update/delete-activity-command.ts`, `create-activity.dto.ts`, `find-activity-by-id-query.ts`,
`find-all-activities-query.ts`, `activity.service.ts`, `fee-resolution.service.ts`, `get-debt-query.ts`,
`get-patient-summary-query.ts`, `update-patient-command.ts`, `merge-patient-command.ts`, `category-commands.ts`,
`preset-commands.ts`, `activity-type-commands.ts`, `staff-commands.ts`, `payer-commands.ts`, `fee-rule-commands.ts`,
`org-controller.ts`, `pro-controller.ts`, `fee-rules-controller.ts`, `settlements-controller.ts`, `config-module.ts`,
`fee-engine-module.ts`, `security-invariants.spec.ts`.
**Modificados (frontend):** `src/services/data.ts`, `src/components/domain/workload/form/WorkItemForm.tsx`,
`src/components/domain/pro/atenciones/columns.tsx`, `src/components/domain/pro/atenciones/AtencionesTable.tsx`, `package.json`.

**Eliminados:** `api/controllers/v1/config/config-controller.ts`, `config/system-controller.ts`,
`fee-engine/professional-category-controller.ts`, `application/features/config/queries/config-general-queries.ts`,
`.../search-professionals-query.ts`, `application/features/fee-engine/commands/professional-category-commands.ts`,
`application/features/settlements/queries/settlement-queries.ts`.

**Rutas eliminadas** (pasan a 404 de Nest): todo `config/*` (`categories`, `activity-types`, `dictionaries`, `org-rules`,
`pro-rules`), `system/professionals`, `pro/payers/lookup`, `GET settlements`, `GET settlements/:id/details`,
`fee-engine/professional-categories/*`.

## 3. Política implementada (rol x acción)

Rol = el de la base en la organización **de la atención** (`roleIn(scope, item.organizationId)`), nunca `x-mode`.

| Acción | ADMIN | MEMBER | Solo vínculo `Professional` |
|---|---|---|---|
| Leer atención por id (`GET activity/:id`) | si | si | si |
| Crear atención (`POST activity`) | si | si | solo si su `Professional` en T tiene `canLoadActivities = true` y solo a su propio `Professional` (si no, 403) |
| Editar y cobrar (`PUT activity/:id`, incluye asistencia) | cualquiera de la organización | cualquiera de la organización (decisión 1) | `createdByUserId = sub`; si es null, solo si `Professional.userId = sub`; si no, 403 |
| Borrar (`DELETE activity/:id`) | cualquiera | `createdByUserId = sub`; si es null, solo si `Professional.userId = sub`; si no, 403 | igual que MEMBER |
| Borrar una cobrada con fecha de pago | 403 (sin cambios) | 403 | 403 |
| Escrituras de `org/*` (categorías, presets, staff, tipos de actividad, `PUT org`, lookup) | si | 403 | 403 |
| Lecturas de configuración (`GET org`, `org/config`, `org/activity-types`) | si | si | si |
| `PUT/DELETE pro/payers/:id` | si | solo si es dueño del pagador (`Payer.professional.userId = sub`) | ídem |
| `POST pro/payers` | si | solo si tiene `Professional` en la organización (pagador propio); si no, 403 | ídem |
| `POST fee-rules` | si | solo para un pagador propio; sin pagador o ajeno, 403 | ídem |

Cualquier recurso de otra organización, inexistente, default del sistema o con id que no es UUID: 404 con cuerpo
`{ code: 'not-found', errors: [{ message: 'Not Found' }] }`, idéntico byte a byte (los tests lo comparan).
Un `ADMIN` que además es dueño del `Professional` tiene los permisos del `ADMIN`; un `MEMBER` dueño del `Professional` de una atención
con `createdByUserId` null puede borrarla (regla de la decisión 1, "o el dueño del `Professional`").

## 4. Frontend

| Llamada (`services/data.ts`) | Antes | Ahora |
|---|---|---|
| `createCategory` | `POST config/categories` | `POST org/categories` |
| `updateCategory` | `PUT config/categories/:id` | `PUT org/categories/:id` |
| `deleteCategory` | `DELETE config/categories/:id` | `DELETE org/categories/:id` |
| `getActivityTypes` | `GET config/activity-types?orgId=` | `GET org/activity-types` (sin query; usa el header) |
| `createActivityType` | `POST config/activity-types` | `POST org/activity-types` |
| `updateActivityType` | `PUT config/activity-types/:id` | `PUT org/activity-types/:id` |
| `deleteActivityType` | `DELETE config/activity-types/:id` | `DELETE org/activity-types/:id` |

Otros cambios del front:
- `createWorkItem`: ante un 404 usa el texto por defecto "Error al guardar la actividad" (no muestra "Not Found").
- `WorkItemForm`: en modo profesional con paciente de otra organización (`patientOrganizationId` distinto de `orgSlug`) no manda
  `activityTypeId` ni `presetId` (salen de la organización de la URL y el backend los rechazaría). No es visible.
- Botones de modo pro (decisión 1): `columns.tsx` recibe `isMember` (último parámetro, con valor por defecto, así
  `DeudoresTable` compila sin cambios) y `AtencionesTable` lo calcula con `orgRole === 'MEMBER'` de la store. Editar y "Marcar
  Cobrado" quedan habilitados para el dueño **o** un `MEMBER` (siempre que no sea una atención externa); Eliminar sigue
  dependiendo de `isOwner` (`createdByUserId` del listado, que ahora llega del backend). "Cargar Asistencia" no estaba
  condicionado por ownership y sigue igual (el backend decide).
- `package.json`: `npm test` corre también `src/services/api-routes.test.mts`.

## 5. Tests agregados

Backend (Jest, Prisma mockeado o `fake-prisma`; ninguno toca la base):

| Spec | Qué cubre |
|---|---|
| `request-context.spec.ts`, `dispatcher.spec.ts`, `org-access-guard.spec.ts` (ampliado) | Contexto congelado, `requireOrgScope` (403 `org-access-denied`), `roleIn`, el handler recibe `(command, ctx)`, `primaryOrgId` (header, query, body, normalizado). |
| `org-resource.spec.ts` | `requireId`, `optionalId`, `foundOr404`, cuerpos idénticos, `inScope`/`inOrg`. |
| `activity-handlers.spec.ts` | Find (propia, ajena, inexistente, no UUID, sin scope). `canModifyActivity`: matriz de 11 casos x edit/delete. Update y delete por handler: 404 sin escritura, MEMBER ajena (edit ok, delete 403), profesional ajena, `null` con dueño del `Professional` y con otro usuario, cobrada con fecha, orden 404 > ownership > cobrada. |
| `activity.service.spec.ts` | ADMIN y MEMBER crean (transacción, `tx` a `calculateSplits`, `createdByUserId` del scope); profesional con `canLoadActivities` true (con `x-mode` org y pro) y false (403 sin escrituras ni `$transaction`, ni siquiera se lee el paciente); `professionalId` ajeno; organización fuera del scope; `patientId`, `professionalId`, participante, `activityTypeId`, `presetId` y `payerId` de otra organización: 404 sin escrituras; `''` y `null` como ausentes; id que no es UUID; pagador por defecto creado dentro de la transacción; `Professional` automático en `SOLO_PRACTICE`. |
| `patients-handlers.spec.ts` | Debt, summary y update (propio / ajeno sin escritura), handler registrado, merge (legítimo en `$transaction`; origen o destino ajeno, organizaciones distintas dentro del scope, mismo paciente = 400, no UUID). |
| `config-handlers.spec.ts` | Categorías, presets, tipos de actividad y staff (create con la organización del scope; update y delete propio / ajeno sin escritura); default del sistema = 404; delete de tipo ajeno no cuenta usos; `DeleteStaff` con y sin otros vínculos; `AssignStaffCategory`; `CreateStaff` con categoría ajena / vacía; pagadores (ADMIN / dueño / otro, sistema / propio, otra organización = 404, `POST` con y sin `Professional`, mensaje del CUIT sin nombre); lookup acotado. |
| `fee-rule-commands.spec.ts` | Pagador ajeno 404, ADMIN, dueño, no ADMIN con pagador ajeno / sin pagador (403), body con `payer.create` y `organization.connect` ajenos no llega a Prisma, regla existente solo actualiza `splits`. |
| `test/org-isolation.spec.ts` (AppModule real + `fake-prisma` + `OrgAccessService` stub) | (a) estructural: las rutas con `:param` del módulo son exactamente las 19 de `ID_ROUTE_CASES`; (b) por cada ruta: ataque con recurso de otra organización = 404, cuerpo igual byte a byte al de un id inexistente, cero escrituras, y caso legítimo 2xx; (c) toda ruta no GET de `OrgController` declara `@RequireOrgRole('ADMIN')` (14) y MEMBER / profesional reciben 403 sin escrituras; lecturas de formularios abiertas; (d) ownership por HTTP: 3 usuarios x 5 atenciones x edit/delete x `x-mode` org, pro y sin header; cobrada con fecha; (e) `POST activity`: `canLoadActivities` true / false, orden del permiso vs 404, profesional a otro `Professional`, ids de otra organización, organización sin vínculo; (f) 11 rutas eliminadas = 404; (g) contrato del front: `POST org/categories` con `{ name, percentage }`, `POST/PUT org/activity-types` con el payload de `ActivityTypesManager`, presets, staff; (h) lookup por CUIT; fee-rules y `pro/payers` por HTTP. |
| `security-invariants.spec.ts` (ampliado) | No existen los 3 controladores eliminados; `x-mode` solo en `activity-controller.ts` (una vez); update, delete y ownership sin `isProfessionalMode` ni `mode`; todo archivo con `where: { id` importa `org-resource` o está en lista blanca justificada (y la lista no acumula entradas obsoletas); **clasificación de todos los campos `*Id` e `id` de comandos y queries** (verified / ignored / controller / filter): un campo nuevo hace fallar el test; solo `ProController` inyecta `PrismaService`; los handlers de config no leen `command.orgId`. |

Frontend: `api-routes.test.mts` (3 tests): `data.ts` sin `/config/`, categorías y tipos de actividad por `/org/*`,
`getActivityTypes` sin `?orgId=`.

## 6. Resultados

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` backend | 0 errores |
| `npx tsc --noEmit` frontend | 0 errores |
| `npm test` backend | **22 suites, 322 tests, todo en verde** (antes del feature: 13 suites; se agregaron 9 suites) |
| `npm test` frontend | **10 tests en verde** (7 de `session` + 3 nuevos) |
| `npm run build` frontend | OK (sin necesitar `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS`) |
| `npx eslint <archivos tocados>` backend | Sin reglas nuevas distintas de `prettier/prettier` en archivos existentes (comparado contra la versión de `HEAD`). Los archivos nuevos quedan con 0 errores. Ver nota. |
| `npx eslint` frontend (`data.ts`, `WorkItemForm.tsx`, `columns.tsx`, `AtencionesTable.tsx`) | Mismos errores que en `HEAD` (13 / 35 / 0 / 10, todos `no-explicit-any` preexistentes) |

Nota de lint: varios archivos legados (`*-commands.ts`, `activity.service.ts`, `find-activity-by-id-query.ts`, etc.) ya no cumplían Prettier
en `HEAD` (4 espacios, sin comas finales, fin de línea mezclado). Mi código nuevo dentro de ellos sigue el estilo local, así que el conteo de
`prettier/prettier` sube entre 1 y 5 líneas por archivo; no corrí `prettier --write` sobre ellos para no reformatear código ajeno. En
los archivos que estaban limpios (`category-commands.ts`, `get-debt-query.ts`, `security-invariants.spec.ts`) sí lo corrí.
`npm run lint` del backend no se ejecutó (usa `--fix`).

## 7. Desvíos del diseño

1. **Política de ownership (00-estado, decisión 1).** El diseño base (opción A) se reemplazó por la opción b del usuario:
   `canModifyActivity` recibe la acción (`edit` / `delete`) y un `MEMBER` edita y cobra cualquier atención de la organización pero
   borra solo las propias. Solo cambió esa función y sus tests, como preveía el diseño.
2. **`GET org/staff/lookup` no corre por `PrismaService` del controlador** (como pedía el diseño) y el controlador quedó sin la dependencia.
3. **Mensaje y status del CUIT de organización en `POST pro/payers`:** pasó de `Error` (500) a `BadRequestException` (400) con el mensaje
   del diseño sin nombre. El diseño cambiaba solo el texto; el 400 sigue la convención de CLAUDE.md (errores de negocio con excepciones HTTP).
4. **`POST fee-rules`, búsqueda de la regla existente:** ahora usa `payerId` y `professionalCategory ?? null` (antes, un valor ausente
   significaba "cualquiera" y podía actualizar la regla de otro pagador). El front siempre manda ambos; es solo más estricto.
5. **Profesionales y participantes con `deletedAt: null`:** el diseño decía "profesional de T"; se agregó `deletedAt: null` en las
   verificaciones (un profesional dado de baja ya no se puede usar para cargar atenciones).
6. **`CreateActivityCommand.userId` y `CreateActivityDto.userId` eliminados** (el diseño solo hablaba de sacar `mode` y `userId` de update y delete).
   El usuario sale del scope y quedaba un campo muerto que habría permitido confundir la fuente.
7. **`CreatePayerCommand.userId` eliminado** y `ProController.createPayer` ya no lo asigna.
8. **`primaryOrgId` en `OrgAccessContext`:** el `Set` conserva el orden de inserción, así que es `x-org-id` si vino y, si no, la primera
   fuente presente (exactamente lo que dice el diseño); documentado en el guard.
9. **Transacciones:** `createActivity` y merge usan la forma interactiva `$transaction(async (tx) => ...)`. En `fake-prisma`
   el `tx` es el mismo cliente, por lo que los tests verifican que las escrituras ocurren **dentro** del callback.
10. **Prueba "registrado" del handler de pacientes:** se verifica la metadata `REQUEST_HANDLER_METADATA_KEY`, no un 200 real, en el spec
    unitario; el 200 real lo cubre `org-isolation.spec.ts` (`PUT v1/patients/:id` legítimo).

## 8. Pendientes para el PO (sin inventar política)

1. **UI de organización (`AdmisionesTable`).** Un `MEMBER` sigue viendo el botón Eliminar en atenciones ajenas (la tabla no recibe
   `currentUserId` ni `createdByUserId`). El backend responde 403 y la UI muestra el toast existente. Ocultar el botón requiere
   pasar el usuario a esa tabla; no se hizo por estar fuera del mínimo del feature. Decidir si se quiere.
2. **Profesional sin membresía que es co-participante** (no `professional` principal) de una atención creada por otro usuario: ya no puede
   cambiar la asistencia ni editarla (decisión 1: solo lo que cargó él o, si `createdByUserId` es null, las de su `Professional`).
   Antes el backend lo permitía porque el front nunca mandaba `x-mode` en `PUT`. Si es un flujo real, habría que ampliar la regla
   con "es participante" (no se hizo).
3. **Cobro y asistencia de profesionales sobre atenciones de colegas** en modo organización: un profesional que gestiona cobros ajenos queda
   fuera (solo `ADMIN` y `MEMBER`).
4. **`WorkItemForm` en modo pro con paciente de otra organización:** el desplegable aún ofrece los pagadores propios de la práctica;
   elegir uno da 404 ("Error al guardar la actividad"). Es la aclaración 3 del diseño; ocultarlos es un cambio visible chico, no hecho.
5. **`pro/deudores`** (aclaración 10): las acciones sobre atenciones de otras organizaciones dan 404; queda para el 009.
6. **`x-org-id` como organización destino en modo pro:** la atención se crea en la organización indicada en `organizationId` del body
   (la del paciente); si el usuario es solo `Professional` ahí, necesita `canLoadActivities` en **esa** organización, no en la de la URL.
7. **Dinero y otros residuales** de §8 del diseño (lecturas de `settlements/calculate` y dashboard para `MEMBER`, `org/config` con emails
   y CUIT del staff, `CreateStaff` revela si un email tiene cuenta, oráculo de un bit del CUIT) siguen vigentes; no se tocaron.
8. **Fin de línea:** el árbol de trabajo mezcla CRLF y LF (también en los 5 archivos ajenos con cambios solo de EOL). Varios archivos
   que edité quedaron con el EOL con que los escribió mi herramienta; el índice de git normaliza a LF, así que el diff no cambia.

## 9. Notas para revisor, seguridad y tester

**Revisor**
- Leer primero `request-context.ts`, `org-resource.ts`, `activity-ownership.ts` y `activity.service.ts` (`createActivity`): concentran el diseño.
- `ActivityService.createActivity`: el permiso de carga va **antes** de leer ningún id (así el tester puede probarlo con ids inexistentes).
  La regla de primera carga y los montos no cambiaron.
- `fake-prisma` lanza error ante operadores de `where` que no soporta, para evitar falsos verdes; los specs unitarios afirman el
  `where` exacto enviado a Prisma (`organizationId: { in: [...] }`).
- Los handlers que no usan el contexto no cambiaron de firma (TypeScript acepta menos parámetros).

**Seguridad**
- El `organizationId` del body de `POST activity` sigue siendo la organización destino, pero ahora se exige que esté en `orgAccess` y se
  reafirma en el servicio (403 `org-access-denied`).
- `fee-rules`: el `data` de Prisma se arma con lista blanca; el test prueba que `payer.create`, `organization.connect`, `organizationId`
  e `id` del body no llegan a Prisma.
- Baja de staff: el `User` global ya no se da de baja si tiene otros vínculos activos (aclaración 8). Residual conocido: un `ADMIN` que se borra
  a sí mismo como staff sigue pudiendo perder acceso si no tiene otros vínculos.
- Sin schema ni SQL nuevo; 7 archivos y 3 controladores eliminados reducen superficie.

**Tester (en vivo, §9.3 del diseño)**
- Las lecturas cruzadas con ids reales de otra organización y los ids inexistentes deben dar el mismo 404 `not-found`.
- Para `POST activity` del profesional con `canLoadActivities` en `false` y un `patientId` al azar: 403 `forbidden`. Con `true`: 404.
- `GET org/staff/lookup?cuit=` con el CUIT de un profesional de otra organización devuelve `{ "type": "NOT_FOUND" }`.
- `GET org/activity-types` ya no recibe `?orgId=`; `config/*`, `system/professionals` y `pro/payers/lookup` dan 404 de Nest.
- Probar en el navegador, sin guardar: ajustes (categorías y prestaciones cargan desde `org/*`), Carga & Seguimiento como ADMIN y como MEMBER.
- Los guardados de configuración desde la UI quedan cubiertos por el contrato de Jest; si se prueban en vivo, usar solo una organización de prueba.


## Vuelta de corrección 1

Respuesta a `05-revision.md` (RECHAZADO). Sin cambios de schema ni de contrato de API.

### F-1 (MAYOR) - el front mostraba éxito ante 403/404
- Causa: las funciones de escritura de `frontend/src/services/data.ts` capturaban el error y devolvían `false`, `null` o `{ success: false }`; los llamadores que no revisaban el valor mostraban éxito.
- Corrección en `data.ts`: dejan de tragar el error (relanzan, con `throw error` en el `catch`) `updateWorkItem`, `deleteWorkItem`, `createPatient`, `updatePatient`, `createStaff`, `updateStaff`, `assignStaffCategory`, `createPayer`, `createFeeRule`, `createCategory`, `updateCategory`, `deleteCategory`, `createOrgPreset`, `updateOrgPreset`, `deleteOrgPreset` (`mergePatient`, `deleteStaff`, `createWorkItem`, `updateProfessionalProfile` y las de tipos de actividad ya lanzaban). Un 403 llega como `ApiForbiddenError` (ya avisado con el toast de acceso) y un 404 como `Error`.
- Llamadores: todos usan `try/catch` y `if (isHandledApiError(e)) return` para no duplicar el toast del 403; si no, muestran el mensaje de error existente y no muestran éxito ni refrescan. Se agregó el manejo en los que no tenían (`AdmisionesTable` cobro, `AtencionesTable` eliminar, asistencia y cobro, `DeudoresTable` eliminar y cobrar, `ProfessionalManager` categoría, alta y switch con reversión por `loadData()`). Se ajustó el guard en `workload/columns.tsx`, `AdmisionesTable.handleDelete`, `profesionales/page.tsx`, `PatientDirectory`, `CategoryManager`, `ReferenceValuesManager` (los textos "Error de conexión" pasaron a "Error al guardar valor/Error al eliminar", porque el `catch` ahora es error de la API) y `PayerRulesManager`.
- Efecto lateral: `AtencionesTable.doDelete` ahora muestra `Registro eliminado` solo si salió bien (antes no mostraba nada).
- `app/test-suite/page.tsx` (herramienta de desarrollo, no usar contra datos reales) no se tocó.

### M-4 - alta de atención de un profesional sin membresía
- `backend/src/infrastructure/features/activity/activity.service.ts`: la búsqueda del `Professional` propio filtra `status: 'ACTIVE'` (ya tenía `deletedAt: null`).
- Test nuevo en `activity.service.spec.ts`: la consulta incluye `userId`, `organizationId`, `status: 'ACTIVE'` y `deletedAt: null`.
- `test/org-isolation.spec.ts`: los `Professional` de la base en memoria ahora llevan `status: 'ACTIVE'` (la base real lo asigna por defecto).

### M-3 - asignaciones muertas
- `org-controller.ts` (categorías, presets, staff, tipos de actividad) y `pro-controller.ts` (`POST payers`): se eliminaron `command.orgId = orgId` y los `@Headers('x-org-id')` que quedaban sin uso. Las clases de comando conservan el campo `orgId` (los handlers lo ignoran; lo verifica `security-invariants`). El header lo sigue validando `OrgAccessGuard`.

### Pendiente 8.1 - botón Eliminar para MEMBER en `AdmisionesTable`
- Se lee del token el usuario (`sub`) y el `professionalId` (solo presentación). El botón Eliminar queda deshabilitado, con tooltip, para un `MEMBER` si la atención no es suya (`createdByUserId`) o, con autor null, no es de su `Professional`. ADMIN o rol desconocido: sin restricción. El listado ya devolvía `createdByUserId` y `professionalId`; se agregaron al mapeo de filas. El backend sigue siendo la autoridad.

### Tests agregados
- Backend: 1 test en `activity.service.spec.ts` (M-4).
- Frontend: 1 test en `src/services/api-routes.test.mts` que verifica que las 17 funciones de escritura relanzan el error y no devuelven valores de fallo en el `catch`.

### Calidad
- `npx tsc --noEmit`: backend y frontend sin errores.
- `npm test` backend: 22 suites, 323 tests en verde. Frontend: 11 tests en verde.
- `npm run build` frontend: OK (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`).
- `npx eslint` sobre los archivos tocados, comparado con `HEAD`: frontend sin errores nuevos (74 vs 72 en total antes de ajustar `AdmisionesTable`, que luego quedó igual a `HEAD`); backend: solo `prettier/prettier` por EOL, ya presente en `HEAD`, sin reglas nuevas. No se corrió `npm run lint` ni `prettier --write`.
- No se tocó M-1 (opcional), M-2, M-5 ni M-6. No se tocaron los archivos ajenos.

### Dudas pendientes
- `workload/columns.tsx` (tabla genérica) no oculta Eliminar al MEMBER; solo corrige el manejo del error. El backend responde 403 y la UI lo muestra.
- M-5 sigue: el rol del token es el de la primera membresía.


## Vuelta de corrección 2

Respuesta a `06-seguridad.md` (RECHAZADO: ALTA-1, MEDIA-1, BAJA-2). Sin cambios de schema ni SQL. La política de quién escribe reglas (decisión 3) y BAJA-1 (decisión 8) no se tocaron.

### ALTA-1 - la organización sale solo del contexto validado
- Nuevo decorador `@CurrentOrgId()` (`backend/src/infrastructure.bootstrap/config/core/authentication/current-org-decorator.ts`): devuelve `request.orgAccess.primaryOrgId` (lo llena `OrgAccessGuard` tras validar la pertenencia) y responde 403 `org-access-denied` si no hay organización validada. Ningún controlador lee ya `@Headers('x-org-id')`.
- Controladores migrados (6): `activity-controller.ts` (`findAll` ya no cae a `query.organizationId`; `create` usa `command.organizationId || orgId`, donde el `organizationId` del body es el destino que el guard y el servicio ya validan, aclaración 6), `org-controller.ts` (`PUT org`, `GET org`, `GET org/config`, `GET org/activity-types`), `pro-controller.ts` (`context`, `profile`, `GET payers`), `dashboard-controller.ts` (`kpis`, `chart`, `payers`), `fee-rules-controller.ts` (`GET`) y `patients-controller.ts` (`GET`, `POST`).
- Falla cerrado (`requireOrgId` en `request-context.ts`: 403 `org-access-denied` si llega vacío, no string o solo espacios): `GetPayersQueryHandler` (`payer-commands.ts`) y `DashboardService.getChart` / `getPayerDistribution`, antes de cualquier consulta. `getKpis` ya devolvía ceros sin consultar; el resto de los handlers (actividades, pacientes, fee-rules, org, config, tipos de actividad) ya devolvían vacío o `null` sin organización y no cambiaron.
- Prettier sobre `org-controller.ts` y `pro-controller.ts` (m-1).
- Invariantes (`security-invariants.spec.ts`, 3 tests nuevos): (1) `x-org-id` solo aparece en 4 archivos de lista blanca justificada (guard, CORS, `auth-context` y el decorador, estos dos en comentarios); (2) ningún archivo de `api/`, `application/` ni `infrastructure/` usa `@Headers('x-org-id')`, `headers['x-org-id']`, `@Query('orgId'|'organizationId')` ni `@Body('orgId'|'organizationId')`; (3) los 6 controladores listados usan `@CurrentOrgId()`.
- Tests HTTP (`test/org-isolation.spec.ts`, sección (i)): sin `x-org-id` y con `?orgId=` y con `?organizationId=` propio, verifican solo datos de la organización A en `pro/payers` (admin, miembro y profesional), `dashboard/chart` (bruto 50, no 60), `dashboard/payers`, `dashboard/kpis`, `fee-rules`, `org`, `org/config`, `org/activity-types`, `pro/context`, `activity` y el alta en `v1/patients`; `PUT org` sin header cambia solo la organización A; sin header ni query: 403 en 10 rutas; `?orgId=`/`?organizationId=` de una organización ajena: 403 sin datos; header propio con `?orgId=` ajeno: 403. Se agregó `groupBy` mínimo a `test/helpers/fake-prisma.ts` y reglas de ambas organizaciones al seed (el test existente de `organization.connect` ahora busca la regla por nombre).
- Tests unitarios que fallan cerrado con organización vacía: `config-handlers.spec.ts` (`GetPayersQueryHandler`, 5 valores vacíos o no string) y nuevo `dashboard.service.spec.ts` (`getChart` y `getPayerDistribution` con `undefined`, `null`, `''` y `'   '`; sin consultas a Prisma; `getKpis` devuelve ceros).
- Limitación: `GET v1/patients` por HTTP no se puede ejercitar con `fake-prisma` (usa filtros de relación `some`/`NOT`); su cableado queda cubierto por el invariante estático y por el alta (`POST v1/patients`) sin header.

### MEDIA-1 - esquema de `splits` de las reglas de honorarios
Semántica relevada (hay dos formas en el código):
- Forma de la UI (`PayerRulesManager.saveRule` y `handleCreatePayer`): `[{ role, percentage, beneficiaryType: 'PROFESSIONAL' }, { role, percentage, beneficiaryType: 'ORGANIZATION' }]`. `percentage` es el porcentaje (0-100) del bruto del beneficiario; la UI siempre manda dos entradas que suman 100. La UI lee de vuelta `splits.find(role === 'PROFESSIONAL').percentage`.
- Forma del motor (`FeeResolutionService.SplitDefinition`): `{ beneficiary: 'ORG'|'PROFESSIONAL', type: 'PERCENTAGE'|'FIXED', value, roleLabel? }`. `PERCENTAGE` es 0-100 del bruto; `FIXED` es un monto. El beneficiario `PROFESSIONAL` es siempre el `professionalId` de la atención (nunca un id del JSON) y el resto va a la organización; si lo asignado es menor al bruto, el motor agrega un resto a `ORG`.
- Las dos formas no coinciden entre sí (el motor lee `beneficiary/type/value`, la UI escribe `role/percentage/beneficiaryType`): es una inconsistencia previa, fuera del alcance. Se documenta y la validación acepta ambas por elemento.

Validación (`backend/src/application/features/fee-engine/fee-rule-splits.ts`, `validateFeeRuleSplits`), aplicada en `CreateFeeRuleCommandHandler` después del chequeo de permiso y antes de cualquier escritura, tanto para crear como para editar la regla existente. Respuesta 400 con el mensaje genérico `Invalid splits definition`:
- arreglo de 1 a 20 elementos, cada uno un objeto;
- forma UI: solo las claves `role`, `percentage`, `beneficiaryType`; `percentage` número finito entre 0 y 100; `beneficiaryType` en `PROFESSIONAL|ORGANIZATION|ORG`; `role` string de hasta 100 caracteres si viene;
- forma motor: solo `beneficiary`, `type`, `value`, `roleLabel`; `beneficiary` en `PROFESSIONAL|ORG`; `value` finito y no negativo; `PERCENTAGE` hasta 100, `FIXED` hasta 99.999.999,99 (`Decimal(10,2)`); `type` obligatorio y del enum;
- la suma de todos los porcentajes no supera 100 (tolerancia 0,01);
- ninguna otra clave: en particular no se aceptan ids de beneficiario (`beneficiaryId`, `professionalId`), así que no se puede apuntar a terceros.

Tests: `fee-rule-splits.spec.ts` (7), 3 en `fee-rule-commands.spec.ts` (crear, editar existente, UI válida) y 3 por HTTP. El fixture `splits` del spec existente ahora incluye `beneficiaryType` (antes faltaba y el esquema lo exige). Efecto conocido: `app/test-suite/page.tsx` (herramienta de desarrollo) manda `splits` como objeto `{ professional, org }` y ahora recibiría 400; no se tocó.

### BAJA-2 - merge sin `targetId`
`patients-controller.ts` usa `body?.targetId` (el cuerpo vacío ya no da `TypeError`) y `MergePatientCommandHandler` responde 400 (`Invalid request`) si `targetId` no es un string no vacío, antes de leer ids o escribir. Tests: unitario (6 valores) y HTTP (`undefined`, `{}`, `null`, número, `''`, arreglo) con 400 y 0 escrituras.

### Opcionales
- m-1: hecho (prettier en `org-controller.ts` y `pro-controller.ts`).
- m-2: hecho. `PayerRulesManager.handleCreatePayer` separa `createPayer` de `createFeeRule`: si falla el alta del pagador se apaga el `loading` y el diálogo sigue abierto; si falla solo la regla, se cierra el diálogo, se refresca y se avisa que el pagador se creó pero no su regla.
- m-3: hecho. En `org/profesionales/page.tsx` un error de `assignStaffCategory` tras un alta o edición exitosa se captura, se cierra el diálogo, se hace `load()` y se muestra "Se guardó el profesional, pero no se pudo asignar la categoría" (un 403 ya avisado no se duplica).

### Calidad
| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit` backend y frontend | 0 errores |
| `npm test` backend | 24 suites, 374 tests en verde (antes 22 y 323) |
| `npm test` frontend | 11 tests en verde |
| `npm run build` frontend | OK (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) |
| `npx eslint` backend (archivos tocados) | 0 errores fuera de `prettier/prettier` legado de archivos que ya lo tenían en `HEAD`; los archivos nuevos y los controladores de `config/` quedan sin errores. No se corrió `npm run lint`. |
| `npx eslint` frontend (`PayerRulesManager.tsx`, `profesionales/page.tsx`) | 10 errores, igual que en `HEAD` (`no-explicit-any` previos); sin errores nuevos |

### Dudas pendientes
- La inconsistencia entre la forma de `splits` que escribe la UI y la que lee el motor (arriba) deberá resolverse en el feature que toque el motor de honorarios; este feature solo la acota.
- `app/test-suite/page.tsx` quedará con 400 al crear la regla de prueba si se usa (herramienta de desarrollo, no usar contra datos reales).
