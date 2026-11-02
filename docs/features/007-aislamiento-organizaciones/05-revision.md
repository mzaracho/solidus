# 05 - Revisión: 007-aislamiento-organizaciones

> Revisor. Entradas: `.claude/CLAUDE.md`, `00-estado.md` (prevalece), `01-spec.md`, `03-diseno-tecnico.md`, `04-implementacion.md`,
> `git status`/`git diff` contra `d698615` y los archivos nuevos. No se editó código. Ignorados por ser ajenos al feature: los 5
> archivos de `infrastructure.bootstrap/config/app/*.ts` y `public-decorator.ts` (solo EOL), `.claude/settings.json`, `.vscode/`,
> `frontend/AGENTS.md`, `docs/features/PLAN-pendientes.md`.

## 1. Resultados de comandos

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` backend | 0 errores |
| `npx tsc --noEmit` frontend | 0 errores |
| `npm test` backend | 22 suites, 322 tests, todo en verde (incluye `test/org-isolation.spec.ts`). Hay ruido de `console.error` del filtro HTTP por las 4xx esperadas; no es falla |
| `npm test` frontend | 10 tests en verde (7 `session` + 3 `api-routes`) |
| `npx eslint` sobre los 46 `.ts` tocados o nuevos del backend (sin `--fix`; no se corrió `npm run lint`) | Comparado con una copia de `HEAD` con la misma configuración: ninguna regla distinta de `prettier/prettier` aumenta en ningún archivo, y los archivos nuevos no tienen errores ni diferencias de Prettier. Solo hay 40 warnings nuevos de "Unused eslint-disable directive" en specs y helpers (ver M-1). Los `no-unsafe-*`, `no-unused-vars` y similares que quedan en los archivos legados ya estaban en `HEAD` (por ejemplo `CreateCategoryDto` sin usar, `hasUser` sin usar en `staff-commands.ts` antes) |
| `npx eslint` frontend | No se re-corrió; el desarrollador informa los mismos errores que en `HEAD` y el diff del front es pequeño, sin `any` nuevos relevantes |
| `npm run build` frontend | No se re-corrió (lo informa el desarrollador; `tsc` limpio) |

## 2. Cumplimiento de los 14 criterios

| # | Criterio | Estado |
|---|---|---|
| 1 | Relevamiento | Cumple. El test estructural fija las 19 rutas con `:param` del `AppModule` y falla si aparece una nueva (verificado: coincide con el grep de `@Get/@Post/@Put/@Delete(':...')`). Los ids de body/query se clasifican en `security-invariants.spec.ts` |
| 2 | IDOR en lectura | Cumple. `findFirst({ id, ...inScope })`, `requireId` antes de la base, 404 `not-found` idéntico para inexistente, ajeno y no UUID |
| 3 | IDOR en escritura | Cumple. Todos los handlers de escritura verifican con `foundOr404` antes de escribir. Las escrituras múltiples (`createActivity`, merge, baja de staff con usuario) van en `$transaction`. `updateMany` + `delete` del merge dentro de la transacción |
| 4 | Ids referenciados | Cumple. `activityTypeId`, `presetId`, `payerId`, `patientId`, `professionalId`, participantes, `categoryId` (create staff y assign), `targetId` del merge, `payer.connect.id` de fee-rules: todos con `inOrg(T)` o `inScope` |
| 5 | Config solo ADMIN | Cumple. 14 rutas no GET de `OrgController` con `@RequireOrgRole('ADMIN')`; el guard exige ADMIN en todas las organizaciones del request. Test HTTP con MEMBER, profesional y profesional sin permiso de carga |
| 6 | ConfigController | Cumple (migración a `org/*`, controlador eliminado). Front migrado; no quedan referencias a rutas eliminadas en `frontend/src` (grep) |
| 7 | `canLoadActivities` | Cumple. El permiso se evalúa primero y no depende de `x-mode` |
| 8 | Sin `x-mode` | Cumple en permisos. `x-mode` solo queda en `activity-controller.ts` (alta) y afecta montos y la regla de primera carga, no autorización; ownership, update y delete ya no lo reciben |
| 9 | Lookup por CUIT | Cumple. `system/professionals` y `pro/payers/lookup` eliminados; `org/staff/lookup` acotado a la organización, ADMIN, respuesta mínima |
| 10 | Frontend | Cumple en rutas y payloads (ver F-1 por el manejo de errores) |
| 11 | Tests | Cumple en lo pedido (ver sección 5) |
| 12 | Calidad | Cumple (tsc, tests, lint sin regresiones) |
| 13 | En vivo | Pendiente del tester |
| 14 | Sin schema | Cumple. No hay cambios en `prisma/` |

La política de `00-estado.md` está bien implementada en `activity-ownership.ts` (`canModifyActivity(item, scope, 'edit'|'delete')`): ADMIN todo;
MEMBER edita y cobra cualquiera de la organización y borra lo propio o, con `createdByUserId` null, lo de su `Professional`; solo-Professional
lo propio o, con null, lo de su `Professional`. El rol sale de `roleIn(scope, item.organizationId)` (base de datos), no de headers. Las reglas
de fee-rules y de `pro/payers/:id` (ADMIN o dueño del pagador) coinciden con la decisión 3.

## 3. Hallazgos

### BLOQUEANTE
Ninguno.

### MAYOR

**F-1. El front muestra éxito cuando el backend responde 403 o 404 al borrar o editar una atención (criterio 10).**
- Archivos: `frontend/src/components/domain/org/admisiones/AdmisionesTable.tsx:166-167` (`handleDelete`), `frontend/src/components/domain/workload/columns.tsx:76-77`, `frontend/src/components/domain/pro/atenciones/AtencionesTable.tsx:168-169` (`doDelete`) y `:133` (edición); la causa está en `frontend/src/services/data.ts` `deleteWorkItem` (devuelve `false`) y `updateWorkItem` (devuelve `{ success: false }`), que tragan el error.
- Problema: los llamadores esperan una excepción y nunca revisan el valor devuelto. Ante un 403 (ahora normal: un `MEMBER` borrando una atención ajena, o un profesional editando la de un colega) o un 404, la UI muestra "Registro eliminado" / guardado correcto y el registro reaparece al recargar. El criterio 10 pide que el 403/404 nuevo muestre el mensaje de error existente. El §8.1 del informe dice que "la UI muestra el toast existente", pero el toast que aparece es el de éxito. Es un comportamiento previo del front, pero este feature convierte ese camino en alcanzable con un botón visible (el propio §8.1 deja el botón Eliminar visible para el `MEMBER`).
- Sugerencia: en cada llamador revisar el resultado (`const ok = await deleteWorkItem(...); if (!ok) { toast.error('No tenés permiso para eliminar este registro'); return }`; para `updateWorkItem`, `if ('success' in res && res.success === false) toast.error(...)`), o hacer que `deleteWorkItem`/`updateWorkItem` lancen `Error` con un texto según el status (403: sin permiso; 404: no encontrado) para que los `catch` ya existentes muestren el error. Ocultar el botón Eliminar al `MEMBER` en `AdmisionesTable` (pendiente §8.1) es complementario, no sustituto.

### MENOR

**M-1. Directivas `eslint-disable` sobrantes (40 warnings).** Archivos: `application/features/activity/activity-handlers.spec.ts:1`, `config/config-handlers.spec.ts:1`, `fee-engine/fee-rule-commands.spec.ts:1`, `patients/patients-handlers.spec.ts:1`, `config/core/authentication/org-resource.spec.ts`, `config/core/cqrs/dispatcher.spec.ts`, `request-context.spec.ts`, `guards/org-access-guard.spec.ts`, `infrastructure/features/activity/activity.service.spec.ts`, `security-invariants.spec.ts`, `test/helpers/scope.ts:1` (7), `test/helpers/fake-prisma.ts`, `test/org-isolation.spec.ts`. Sugerencia: recortar cada directiva a las reglas que realmente se reportan (`npx eslint --report-unused-disable-directives` las lista).

**M-2. El mensaje del 403 de ownership cambió.** `activity-ownership` + `forbiddenAction()` responden `{ code: 'forbidden', message: 'Forbidden' }`, y antes eran "No tienes permiso para modificar/eliminar esta actividad." (en `update-activity-command.ts` y `delete-activity-command.ts` del `HEAD`). Es consistente con el 005, pero se pierde el texto en español. Si F-1 se corrige mostrando un texto propio del front, no hace falta tocar el backend; si no, conviene una excepción con el mensaje en español para ese caso.

**M-3. Asignaciones muertas en el controlador.** `org-controller.ts:84,115,146,204` y `pro-controller.ts:153` siguen haciendo `command.orgId = orgId` (header) aunque los handlers ya lo ignoran, y `CreateCategoryCommand.orgId`, `CreateStaffCommand.orgId` y `CreatePayerCommand.orgId` siguen declarados. No es una falla (`security-invariants` verifica que los handlers no lean `command.orgId`), pero deja la impresión de que la fuente es el header. Sugerencia: borrarlos en un cambio posterior; si se mantienen por compatibilidad con Swagger, dejar el comentario "se ignora".

**M-4. Alta de atención de un profesional sin membresía no filtra `status`.** `activity.service.ts:62-65`: `professional.findFirst({ where: { userId, organizationId, deletedAt: null } })`. El guard exige un `Professional` `ACTIVE` para dar acceso; si el usuario tuviera más de un `Professional` en la organización (uno inactivo), `findFirst` podría elegir el inactivo y aplicar su `canLoadActivities`. Caso borde improbable. Sugerencia: agregar `status: 'ACTIVE'`, como en `OrgAccessService`.

**M-5. `orgRole` del front sale del JWT (primera membresía), no de la organización de la URL.** `AtencionesTable.tsx:28,202`. El flag `isMember` solo afecta qué botones se habilitan; el backend decide. Con un usuario `ADMIN` en una organización y `MEMBER` en otra, los botones pueden no coincidir. Es solo de presentación.

**M-6. Mezcla de CRLF y LF** en el árbol de trabajo (informado en §8.8). El índice normaliza a LF y no afecta al diff, pero los archivos nuevos y los editados quedan con EOL distinto. Sugerencia: `.gitattributes` con `* text=auto eol=lf` en un cambio aparte (ajeno al feature).

### SUGERENCIA

- **S-1.** El test del front (`api-routes.test.mts`) es un chequeo de texto sobre `data.ts`. Detecta rutas viejas pero no la forma del body. Está compensado por el contrato (g) de `org-isolation.spec.ts`; basta con eso.
- **S-2.** `createActivity` hace unas 8 a 10 lecturas secuenciales antes de la transacción (participantes en serie). Aceptable para el volumen actual; si hubiera quejas de latencia se pueden paralelizar con `Promise.all` las verificaciones de ids independientes.
- **S-3.** Los handlers de lectura de listados (`GetPayersQuery`, `FindFeeRulesQuery`, `GetOrgConfigQuery`, `GetOrganizationQuery`, `GetActivityTypesQuery`, dashboard) siguen recibiendo `orgId`/`userId` del controlador (header validado por `OrgAccessGuard`, `userId` del token). No hay hueco porque el guard valida el header y estos handlers no reciben ids de recursos, pero conviene migrarlos a `RequestContext` cuando se haga el 009 para tener una sola fuente.
- **S-4.** En `loadPayerForWrite` y `CreateFeeRule` la respuesta distingue 404 (otra organización o inexistente) de 403 (de la propia organización, no es dueño). Es correcto: no revela nada de otras organizaciones.

## 4. Conformidad con el diseño

- `RequestContext` por `Dispatcher` (congelado), `requireOrgScope` con 403 `org-access-denied`, `primaryOrgId` en el guard: conforme.
- Helper `org-resource` (`resourceNotFound`, `requireId`, `optionalId`, `inScope`, `inOrg`, `foundOr404`) usado de forma uniforme; `security-invariants` falla si un archivo con `where: { id` no lo importa y no está en la lista blanca (y la lista no acumula obsoletos).
- Verificaciones antes de escribir en todos los handlers revisados; orden 404 > ownership 403 > regla de cobrada en delete.
- Lista blanca en fee-rules: `CreateFeeRuleDto` explícito y `data` de Prisma armado campo por campo; la clave `organization`/`payer.create` del body no llega a Prisma (el front de `PayerRulesManager` manda `organization: { connect }` extra y se ignora sin romper). La regla existente solo actualiza `splits`.
- `ConfigController`, `SystemController`, `ProfessionalCategoryController` y `settlement-queries.ts` eliminados; rutas pasan a 404 de Nest, probado en (f).
- Handler de `PUT v1/patients/:id` registrado (antes daba 500).
- Convenciones: capas y CQRS respetados, errores de negocio con excepciones HTTP en el código nuevo (los `throw new Error` que quedan en `createActivity` y `CreateStaff` ya existían), `@src/*`, Prettier en archivos nuevos.

## 5. Cobertura de tests

- Estructural: las 19 rutas con parámetros (falla si aparece una nueva); clasificación de todos los campos `*Id` e `id` de comandos y queries; solo `ProController` inyecta `PrismaService`.
- Integración con `AppModule` real y base en memoria: recurso ajeno = 404 idéntico byte a byte al inexistente, sin escrituras, y caso legítimo 2xx por ruta; ADMIN/MEMBER/profesional en config; ownership con 3 usuarios x 5 atenciones x edit/delete x `x-mode` org/pro/sin header; `canLoadActivities` true/false y orden permiso vs 404; ids ajenos al crear; rutas eliminadas; contrato del front contra `org/*`.
- Unitarios por handler con el `where` exacto enviado a Prisma.
- Falta (no bloquea): ningún test del front cubre F-1 (el front no tiene framework de componentes); un test de `deleteWorkItem` con respuesta 403 podría hacerse con `node --test` si se corrige el contrato de error.

## 6. Evaluación de los desvíos (§7) y pendientes (§8) del informe

| Ítem | Opinión |
|---|---|
| §7.1 Política opción b | Correcto, según 00-estado |
| §7.2 Lookup por `LookupStaffByCuitQuery` | Mejor que el diseño (el controlador queda sin Prisma) |
| §7.3 CUIT de organización: 400 | Aceptable y alineado con CLAUDE.md |
| §7.4 Búsqueda de regla por `payerId` y `professionalCategory ?? null` | Aceptable. Cierra el caso en que un valor ausente podía actualizar la regla de otro pagador. El front siempre manda `professionalCategory: 'all'` |
| §7.5 `deletedAt: null` en profesionales | Aceptable |
| §7.6 y 7.7 `userId` fuera de los comandos | Correcto; reduce la superficie |
| §7.8 a 7.10 | Sin objeciones |
| §8.1 Botón Eliminar visible para `MEMBER` | No es solo estético por F-1; corregir F-1, y ocultar el botón queda para el PO |
| §8.2 Co-participante sin membresía pierde edición y asistencia | Consecuencia literal de la decisión 1; informar al PO. Si es un flujo real, ampliar `canModifyActivity` con "es participante" solo para `edit` |
| §8.3, §8.4, §8.5, §8.6, §8.7 | Residuales o decisiones del PO; sin objeción técnica. §8.6 (`canLoadActivities` de la organización del paciente) es coherente con crear la atención en esa organización |
| §8.8 EOL | Ver M-6 |

## 7. Conclusión

El aislamiento por organización, la política de ownership, `canLoadActivities` y la eliminación de `ConfigController` están implementados de forma
consistente con el diseño y la decisión del usuario, con una cobertura de tests sólida (322 tests en verde, tsc limpio, lint sin regresiones).
Queda un hallazgo MAYOR en el front (F-1): los 403/404 al borrar o editar se muestran como éxito, lo que incumple el criterio 10. El arreglo es
chico y local.

Veredicto de la primera revisión: RECHAZADO (por F-1).


---

## Re-revisión (vuelta 1)

> Alcance: `04-implementacion.md` sección "Vuelta de corrección 1", `00-estado.md` (decisión 1), `git diff` contra `d698615`. No se editó código.
> Resumen de la primera revisión: 0 bloqueantes, 1 mayor (F-1: el front mostraba éxito ante 403/404 al borrar o editar) y menores M-1 a M-6.

### Resultados de comandos

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` backend | 0 errores |
| `npx tsc --noEmit` frontend | 0 errores |
| `npm test` backend | 22 suites, 323 tests en verde (+1: M-4) |
| `npm test` frontend | 11 tests en verde (+1: "las escrituras no tragan el error") |
| `npm run build` frontend (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK; `/test-suite` sigue en el build |
| `npx eslint` frontend, 13 archivos tocados, contra `HEAD` (`git show HEAD:... \| eslint --stdin`) | Igual o mejor en todos (errores idénticos; `PatientDirectory` 4 warnings vs 6, `PayerRulesManager` 1 vs 2, `ReferenceValuesManager` 1 vs 3). Sin lint nuevo. `api-routes.test.mts`: 0/0 |
| `npx eslint` backend (`activity.service.ts`, su spec, `org-controller.ts`, `pro-controller.ts`, `org-isolation.spec.ts`) | Sin reglas de TypeScript nuevas (`activity.service.ts` mejora: `no-unsafe-assignment` 8 a 4). Solo `prettier/prettier` sube en los controladores (ver m-1). No se corrió `npm run lint` |

### 1. F-1 - resuelto

Verificación en `frontend/src/services/data.ts`: todas las funciones de escritura (`createWorkItem`, `updateWorkItem`, `deleteWorkItem`, `createPatient`, `updatePatient`, `mergePatient`, `createStaff`, `updateStaff`, `deleteStaff`, `assignStaffCategory`, `createPayer`, `createFeeRule`, `createCategory`, `updateCategory`, `deleteCategory`, `createOrgPreset`, `updateOrgPreset`, `deleteOrgPreset`, `updateProfessionalProfile`, `updateOrgSettings` y las 3 de tipos de actividad) lanzan ante `!res.ok`. Ya no queda ningún `return null/false/{ success: false }` en el `catch` de una escritura (los `return null/[]` que quedan son de lecturas, sin cambio). `createWorkItem` además evita mostrar el cuerpo de un 404.

Llamadores (grep de todos los usos, incluidos los que pasan la función como referencia: no hay ninguno):

| Llamador | Manejo |
|---|---|
| `AdmisionesTable` handleSave | Sin `try`; propaga a `WorkItemForm`, que muestra el error (salvo 403 ya avisado) y no cierra el modal. Correcto |
| `AdmisionesTable` handleDelete y cobro | `try/catch` + `isHandledApiError` + `toast.error`; sin éxito ni refresh ante fallo |
| `AtencionesTable` handleSave, doDelete, asistencia, cobro | Ídem. En el cobro y la asistencia el modal queda abierto ante fallo |
| `DeudoresTable` eliminar y cobrar | Ídem (`return` antes del toast de éxito y del `load()`) |
| `workload/columns.tsx` (estado, borrar, retroactivo) | Ídem |
| `PacientesTable` | `createWorkItem` ya lanzaba; sin cambio |
| `PatientDirectory` crear, editar, combinar | Ídem |
| `PayerRulesManager` saveRule y crear pagador | Ídem |
| `CategoryManager` | Ídem; conserva `if (!x) throw` inocuo |
| `ReferenceValuesManager` | Ídem; las ramas `else` por `res` falsy quedan como código muerto inocuo |
| `ProfessionalManager` categoría, alta, switch | Revierten el cambio optimista con `loadData()` ante fallo |
| `org/profesionales/page.tsx` | Ídem |
| `settings/general/page.tsx` | `updateProfessionalProfile`/`updateOrgSettings` ya lanzaban; sin cambio |

Ningún llamador quedó sin actualizar salvo `app/test-suite/page.tsx`.

**Impacto en `app/test-suite/page.tsx` (herramienta de desarrollo).** `createPatient` y `createFeeRule` (pasos 3 y 4) y `createWorkItem` (paso 5) no están en `try/catch` propio: un 4xx ahora salta al `catch` externo y la suite imprime "CRITICAL ERROR" y se corta, en vez de seguir con "Failed to ..." por paso. Solo cambia el log; el `if (patient && patient.id) ... else` queda como rama muerta. No rompe el build (`tsc` y `build` en verde) ni el flujo de producción. Aceptable hasta que se elimine del build en el feature posterior.

### 2. M-4, M-3 y pendiente 8.1

- **M-4 - resuelto.** `activity.service.ts:63` filtra `status: 'ACTIVE'` junto a `userId`, organización y `deletedAt: null`. Test nuevo en `activity.service.spec.ts` y `org-isolation.spec.ts` ajustado (los `Professional` en memoria llevan `status`).
- **M-3 - resuelto.** Ya no hay `command.orgId = orgId` en `org-controller.ts` ni `pro-controller.ts`; los `@Headers('x-org-id')` que quedan (líneas 54, 62, 68, 187 y 41, 112, 139) son de lecturas que sí usan `orgId`. `OrgAccessGuard` sigue validando el header. Los campos `orgId` de los comandos se conservan y `security-invariants` verifica que los handlers no los lean.
- **Pendiente 8.1 - cumple la decisión 1.** `AdmisionesTable` deshabilita Eliminar (con tooltip) para `MEMBER` si `createdByUserId` existe y no es el usuario, o si es null y `professionalId` no es el del token. ADMIN o rol desconocido: sin restricción. Coincide con `canModifyActivity(..., 'delete')` del backend (MEMBER: lo propio, o con autor null lo de su `Professional`). Editar y cobrar quedan habilitados para todo `MEMBER`, como pide la decisión. `createdByUserId` y `professionalId` salen del listado (`find-all-activities-query.ts:200`) y `professionalId` está en el JWT. Es solo presentación; el backend responde 403.

### 3. Regresiones en el backend

Ninguna. Los 323 tests pasan, `tsc` limpio. El diff de la vuelta en backend se limita a `activity.service.ts` (un filtro), los dos controladores (asignaciones muertas) y tests.

### Hallazgos de la re-revisión

**BLOQUEANTE:** ninguno.
**MAYOR:** ninguno.

**MENOR**
- **m-1. `prettier/prettier` nuevo en los controladores.** `org-controller.ts` pasa de 1 a 5 diferencias (líneas 18, 80, 109, 138, 194) y `pro-controller.ts` de 1 a 2: al quitar `@Headers` las firmas caben en una línea y Prettier pide colapsarlas (`@Body() command: CreateCategoryCommand` sin coma final ni saltos), más el `import { OrgRoleGuard, RequireOrgRole }`. Sugerencia: formatear solo esos dos archivos con `npx prettier --write` y revisar el diff (según el EOL puede reescribirlos enteros).
- **m-2. `PayerRulesManager.handleCreatePayer` (`:128-158`) deja la pantalla en "Cargando reglas...".** `setLoading(true)` no se revierte en el `catch`; ante cualquier fallo (ahora un 403/404 es más probable) el componente queda bloqueado hasta recargar. Es anterior al 007, pero ahora es alcanzable. Además, si `createPayer` sale bien y `createFeeRule` falla, se muestra error pero no se refresca la lista. Sugerencia: `finally { setLoading(false) }` y, ante el fallo parcial, `fetchData()`.
- **m-3. `org/profesionales/page.tsx:91-110`.** Si `createStaff`/`updateStaff` salen bien y `assignStaffCategory` falla, se muestra error y el diálogo queda abierto sin `load()`; reintentar el alta chocaría con el CUIT ya creado. Sugerencia: ante fallo de la asignación, llamar `load()` y avisar "creado, pero no se pudo asignar la categoría".
- **m-4. Mensaje técnico en inglés con JSON en el toast.** `updateWorkItem`/`deleteWorkItem` lanzan `Failed to ...: {cuerpo}`; `AtencionesTable.handleSave` (`:149`), `AdmisionesTable.handleDelete` (`:194`) y `WorkItemForm` (`:456`) lo muestran tal cual para un 404 (el 403 está cubierto por el toast de acceso). En `AtencionesTable` además salen dos toasts (padre y formulario; anterior). Retoma M-2 de la primera revisión. Sugerencia: en `data.ts` mapear 404 a "El registro no existe o no está disponible" (como ya hace `createWorkItem`).
- Pendientes de la primera revisión, sin cambios y fuera del alcance de la vuelta: M-1 (directivas `eslint-disable` sobrantes), M-2, M-5 y M-6.

**SUGERENCIA**
- En `ReferenceValuesManager` y `CategoryManager`, quitar las ramas `if (!res) throw` / `else toast.error` ahora inalcanzables.
- Un test de `deleteWorkItem` con respuesta 403/404 simulada (`node --test` con `fetch` falso) cubriría F-1 mejor que el chequeo de texto sobre `data.ts`.

### Conclusión

F-1 queda corregido de raíz: ninguna escritura reporta éxito ante 403/404, los llamadores manejan el error con el patrón pedido y revierten lo optimista. M-3, M-4 y el pendiente 8.1 cumplen lo pedido y la decisión 1. No hay regresiones en el backend. Quedan solo menores.

Veredicto de la re-revisión de la vuelta 1 (historial): APROBADO.


---

## Re-revisión (vuelta 2)

Alcance: respuesta a `06-seguridad.md` (ALTA-1, MEDIA-1, BAJA-2) y opcionales m-1, m-2, m-3. Se leyeron `00-estado.md`, `01-spec.md`, `03-diseno-tecnico.md`, `04-implementacion.md` (vuelta 2), `06-seguridad.md`, el diff y los archivos nuevos. No se modificó código ni se tocaron los archivos ajenos.

### Resultados de los chequeos

| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit` backend | 0 errores |
| `npx tsc --noEmit` frontend | 0 errores |
| `npm test` backend | 24 suites, 374 tests en verde (coincide con lo informado) |
| `npm test` frontend | 11 tests en verde |
| `npm run build` frontend (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK |
| `npx eslint` backend sobre los archivos de la vuelta | Los archivos nuevos de producción (`current-org-decorator.ts`, `request-context.ts`, `fee-rule-splits.ts`) quedan sin errores. Lo restante es legado de `HEAD` o EOL: `prettier/prettier` por CRLF, `no-unused-vars` de `CreatePayerDto`, `ActivityResponseDto` y `DashboardKpiQueryDto`, `no-unsafe-*` de `payer-commands.ts`, `no-unnecessary-type-assertion` de `dashboard.service.ts`, y dos `no-unsafe-assignment` en `fee-rule-commands.ts` (líneas 65 y 71, ver m-3). Se corrió solo `npx eslint`, nunca `npm run lint`. |
| `npx eslint` frontend (`PayerRulesManager.tsx`, `profesionales/page.tsx`) | 10 errores y 2 avisos, iguales a `HEAD` (`no-explicit-any`, `exhaustive-deps`); nada nuevo |

### ALTA-1 - cerrado

- **Decorador `@CurrentOrgId()`** (`current-org-decorator.ts`): lee `request.orgAccess.primaryOrgId`, que llena `OrgAccessGuard` después de validar cada fuente, y responde 403 `org-access-denied` si no hay organización. Es correcto y mínimo. Como el guard normaliza (trim y minúsculas) antes de validar, el valor que llega al controlador es el validado, no el crudo del header.
- **Los 6 controladores migrados** (`activity`, `org`, `pro`, `dashboard`, `fee-rules`, `patients`): no queda ningún `@Headers('x-org-id')` en `src/` (el único lector es el guard). `findAll` de actividades ya no cae a `query.organizationId`.
- **Falla cerrada**: `requireOrgId` (`request-context.ts`) rechaza vacío, no string y solo espacios con el mismo 403. Se aplica en `GetPayersQueryHandler` (`payer-commands.ts`) y en `DashboardService.getChart` y `getPayerDistribution` antes de cualquier consulta. `getKpis` ya devolvía ceros. Las rutas `@OrgOptional()` (`pro/memberships`, `auth/logout`) no usan el decorador; el resto ya exigía organización en el guard, así que `pro/context` y `pro/profile` no pierden nada al lanzar 403 en vez de devolver `null`.
- **`POST activity` y `body.organizationId`**: el destino sigue siendo `command.organizationId || orgId`. Está cubierto en dos capas: el guard valida `body.organizationId` como una de las cinco fuentes (si no es string o no es UUID, 403) y `ActivityService.createActivity` exige `scope.orgIds.includes(orgId)` (`activity.service.ts:49-50`). Un UUID en mayúsculas pasa el guard (se normaliza) pero falla `includes` en el servicio: falla cerrada, sin impacto real porque la UI manda minúsculas. Hay test HTTP (organización ajena en el body: 403 `org-access-denied`).
- **Invariantes estáticos**: razonables, no frágiles en exceso. El de `x-org-id` compara contra una lista blanca exacta de 4 archivos (cualquier mención nueva, hasta en un comentario, hace fallar el test, lo que es deseable) y no depende de la sintaxis de lectura. Falsos negativos conocidos y aceptables: una organización leída de un DTO `@Query()` o `@Body()` completo solo la controla la tabla `ID_FIELDS`, y el nombre del header armado por concatenación evadiría el grep. Ver m-2 y S-1.
- **Tests HTTP (sección (i))**: miden lo correcto. `dashboard/chart` afirma bruto 50 (con el bug serían 60 por la atención de B), `pro/payers` afirma que todos los ítems son de A y que no está `payerB`, y se cubren las dos formas de query (`orgId`, `organizationId`), el 403 sin organización en 10 rutas, el 403 con organización ajena y el 403 con header propio más query ajena. `PUT org` sin header cambia solo A. La limitación de `GET v1/patients` (filtros de relación que `fake-prisma` no soporta) está documentada y compensada con el alta y el invariante estático.
- **`fake-prisma`**: el único cambio es `groupBy` mínimo (aditivo). Conserva el `throw` ante operadores de `where` no soportados y no relaja aserciones previas. El test existente de `organization.connect` ahora busca la regla por nombre porque el seed tiene reglas de ambas organizaciones; sigue afirmando que no se escribe una regla de otra organización.

### MEDIA-1 - cerrado

`validateFeeRuleSplits` (`fee-rule-splits.ts`) corre en `CreateFeeRuleCommandHandler` después del permiso y del 404 del pagador y antes de cualquier escritura, tanto al crear como al actualizar la regla existente (el `update` de `splits` es el camino de edición de la UI).
- **Correctitud**: arreglo de 1 a 20 objetos; dos formas excluyentes según haya `percentage`; claves exactas por forma (rechaza `beneficiaryId`, `professionalId` y `__proto__`, porque `Object.keys` lista una clave propia `__proto__` de un JSON parseado); `percentage` finito en [0, 100]; `value` finito no negativo, con tope 100 para `PERCENTAGE` y 99.999.999,99 para `FIXED` (coincide con `Decimal(10,2)`); `type` obligatorio y del enum; suma de porcentajes menor o igual a 100 con tolerancia 0,01. Rechaza strings numéricos y el objeto `{ professional, org }`.
- **Compatibilidad con la UI**: `PayerRulesManager.saveRule` y `handleCreatePayer` arman `[{ role, percentage, beneficiaryType }, { role, percentage, beneficiaryType }]` con `percentage` numérico (slider entero y `100 - x`), suma 100, y `role` y `beneficiaryType` dentro de los conjuntos aceptados. Pasa. El resto del payload de la UI (`organization.connect`, `professionalCategory: 'all'`, `name`) queda fuera de `splits` y la lista blanca del handler lo ignora. Hay test HTTP con el payload de la UI (201).
- **Mensajes**: 400 genérico `Invalid splits definition`, sin eco del contenido; coherente con el resto del feature.
- **Observación**: no exige suma 100 ni una entrada `PROFESSIONAL`; el motor completa el resto a la organización. Es correcto y la política de la decisión 3 no cambia.

### BAJA-2 - cerrado (primer punto)

`patients-controller.ts` usa `body?.targetId` y `MergePatientCommandHandler` responde 400 `Invalid request` antes de leer ids o escribir, para `undefined`, `{}`, `null`, número, `''` y arreglo. Hay test unitario y HTTP con 0 escrituras. El segundo punto (DTOs con `class-validator` en `UpdatePatientCommand`, `UpdateActivityCommand` y `UpdateStaffCommand`) era un "conviene" y no se abordó; ver S-2.

### Opcionales

- **m-1 (prettier)**: hecho en `org-controller.ts` y `pro-controller.ts`; sin errores `prettier/prettier` nuevos.
- **m-2 (`PayerRulesManager`)**: hecho. Si `createPayer` falla se apaga `loading` y el diálogo queda abierto con los datos (el estado vive en el padre, así que sobrevive al desmontaje del bloque "Cargando"); si solo falla la regla se cierra el diálogo, se refresca con `fetchData()` y se avisa que el pagador se creó pero no su regla. El 403 ya avisado no duplica el toast.
- **m-3 (`profesionales/page.tsx`)**: hecho. El fallo de `assignStaffCategory` tras un alta o edición exitosa se captura, se cierra el diálogo, se hace `load()` y se muestra el aviso; se evita el falso "creado exitosamente" y un reintento ya no choca con el CUIT creado.

### Regresiones

Ninguna sobre lo aprobado en la vuelta 1: los 323 tests previos siguen dentro de los 374 y pasan, el contrato del front (`data.ts`, 17 escrituras que relanzan) no cambió, y los cambios de la vuelta se limitan a los 6 controladores, `payer-commands.ts`, `dashboard.service.ts`, `fee-rule-commands.ts`, `merge-patient-command.ts`, el decorador, el validador y tests.

### Hallazgos de la vuelta 2

**BLOQUEANTE:** ninguno.
**MAYOR:** ninguno.

**MENOR**
- **m-1. Avisos `Unused eslint-disable directive` en 7 archivos nuevos** (`config-handlers.spec.ts`, `fee-rule-commands.spec.ts`, `fee-rule-splits.spec.ts`, `patients-handlers.spec.ts`, `dashboard.service.spec.ts`, `security-invariants.spec.ts`, `test/helpers/fake-prisma.ts`; línea 1 en todos). La cabecera desactiva reglas que no se reportan. Sugerencia: recortarla a las reglas que sí disparan (es el M-1 de la primera revisión, ahora con más archivos).
- **m-2. `ID_FIELDS` rotula `CalculateSettlementsQuery.organizationId` como `controller`** (`security-invariants.spec.ts`), pero `settlements-controller.ts` no lo asigna: viaja en el query y lo valida el guard como fuente. El control es real (el campo es `@IsString()` obligatorio y el guard exige una organización propia); solo la etiqueta es inexacta. Sugerencia: comentarlo, o migrar la ruta a `@CurrentOrgId()` cuando se trate `settlements/calculate` (ya figura como pendiente en seguridad).
- **m-3. `fee-rule-commands.ts` líneas 65 y 71**: `splits: Prisma.InputJsonValue` produce dos `no-unsafe-assignment`. No es un defecto funcional. Sugerencia: tipar `splits` como `unknown`, ahora que `validateFeeRuleSplits` lo valida, o dejarlo.

**SUGERENCIA**
- **S-1.** Reforzar el invariante de organización con un chequeo de `req.query`/`req.body` con `orgId` u `organizationId` en `api/` (el regex de `@Query/@Body('orgId')` no cubre `@Req()`).
- **S-2.** Registrar para el 013 los DTOs con `class-validator` de `UpdatePatientCommand`, `UpdateActivityCommand` y `UpdateStaffCommand` (segundo punto de BAJA-2) y la inconsistencia de forma de `splits` entre la UI (`role/percentage/beneficiaryType`) y el motor (`beneficiary/type/value`), que el validador acota pero no resuelve.
- **S-3.** `app/test-suite/page.tsx` recibirá 400 al crear la regla de prueba (manda `splits` como objeto). Ya está declarado; conviene sacar esa página del build en el feature que corresponda.

### Conclusión

ALTA-1 queda cerrado de raíz: la organización sale solo del contexto validado por el guard, los puntos de fuga fallan cerrado y los tests HTTP reproducen el escenario original (sin header, con query propio) y afirman que no se mezclan datos de B. MEDIA-1 y el primer punto de BAJA-2 están bien resueltos y son compatibles con lo que manda la UI. No hay regresiones y los chequeos están en verde. Quedan solo menores y sugerencias.

VEREDICTO: APROBADO
