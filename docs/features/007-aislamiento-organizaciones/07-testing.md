# 07 — Testing: 007-aislamiento-organizaciones

> Autor: tester. Fecha: 2026-11-02. No se modificó código de producción ni se agregaron tests (no encontré huecos frente a los
> criterios 2 a 9 y 11: ver sección 2). Sin seeds, sin SQL de escritura, sin commit ni push, sin tocar los puertos 3000
> (coach-claudio) y 3001 (otro proyecto) ni `.env`, `backend/.env` ni `.claude/`. Tokens firmados en memoria con el `JWT_SECRET`
> local (HS256, issuer y audience del 005); no se imprimieron ni se escribieron tokens, secretos, emails, nombres, CUIT ni ids.
> Los scripts auxiliares están en el scratchpad, fuera del repo.

## 1. Resultados de los comandos

| Comando | Resultado |
|---|---|
| `backend: npx tsc --noEmit` | Sin errores |
| `frontend: npx tsc --noEmit` | Sin errores |
| `backend: npm test` | **24 suites, 374 tests, todo en verde** |
| `frontend: npm test` | **11 de 11 en verde** |
| `frontend: npm run build` (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK |
| `.\dev.ps1` (modo desarrollo) | Código 0; backend y frontend (3002) responden; migraciones sin pendientes |
| `.\dev.ps1 -Smoke` | `Backend OK - Frontend OK - Login OK` |
| `.\dev.ps1 -Stop` | OK (2 procesos y los contenedores detenidos; datos conservados) |

## 2. Cobertura Jest frente a los criterios (revisión de huecos)

Revisé `04-implementacion.md` §5 y los specs: `org-isolation.spec.ts` (AppModule real; las 19 rutas con `:param` del módulo contra
`ID_ROUTE_CASES`, cada una con ataque 404 byte a byte igual al de un id inexistente, cero escrituras y caso legítimo; rol en las 14 rutas de
escritura de `org/*`; ownership por HTTP con 3 usuarios x 5 atenciones x edit/delete x `x-mode` org, pro y sin header; ALTA-1 sin header),
`activity-handlers.spec`, `activity.service.spec` (`canLoadActivities` true y false, ids referenciados de otra organización),
`patients-handlers.spec` (merge), `config-handlers.spec`, `fee-rule-commands.spec`, `fee-rule-splits.spec`, `dashboard.service.spec` y
`security-invariants.spec` (estructural). No encontré un caso de la lista del criterio 11 sin cubrir, así que no agregué tests.

## 3. Verificación en vivo (HTTP, modo desarrollo, 206 comprobaciones, 0 fallos)

### 3.1 Roles y datos que existen en la base (solo `SELECT`)

| Caso | Existe | Detalle |
|---|---|---|
| ADMIN de una organización | Sí | 4 membresías ADMIN. Usé un ADMIN con una sola membresía en la organización con datos (X) y otro ADMIN con una sola membresía en una organización vacía (Z) |
| MEMBER | Sí | 4 membresías MEMBER, todas en X. Usé uno con una sola membresía |
| Profesional sin membresía (solo vínculo de `Professional`) | **No** | Ningún `Professional` activo con `userId` carece de membresía en su organización. `canLoadActivities` y ownership de profesional quedan solo en Jest |
| Organizaciones | 3 | Solo X tiene datos (324 atenciones, 72 pacientes, 11 profesionales); las otras dos no tienen atenciones ni pacientes |
| Atenciones con `createdByUserId` null | 324 de 324 | Todas son datos viejos; el caso "null" solo se prueba en Jest |

Como solo X tiene datos, no hay recursos reales en una "organización ajena" de la que lea un ADMIN de X. Invertí el cruce: un ADMIN de Z
(organización vacía) lee con su propio `x-org-id` ids **reales de X**. Es equivalente para el aislamiento y no escribe nada.

### 3.2 Lecturas por id (criterio 2)

| Caso | Esperado | Obtenido |
|---|---|---|
| ADMIN de X: `GET activity/<propia>`, `patients/<propio>/debt`, `/summary` | 200 | 200 |
| MEMBER de X: `GET activity/<propia>`, `patients/<propio>/summary` | 200 | 200 |
| ADMIN de Z: `GET activity/<real de X>`, `patients/<real de X>/debt` y `/summary` | 404 | 404 |
| Los mismos con UUID al azar, y con `abc` (no UUID) | 404 | 404 |
| Comparación de cuerpos | idénticos | **Idénticos** (mismo hash) entre recurso real de X, UUID al azar, `abc`, y entre `activity` y `patients` |
| ADMIN de X con `x-org-id` de Z; ADMIN de Z con `x-org-id` de X | 403 | 403 `org-access-denied` (mismo cuerpo) |
| Sin token | 401 | 401 |

### 3.3 ALTA-1: sin `x-org-id` (ADMIN de X)

Endpoints: `pro/payers`, `dashboard/chart`, `dashboard/payers`, `dashboard/kpis`, `org`, `org/config`, `org/activity-types`, `fee-rules`,
`pro/context`, `activity`. Para cada uno:

| Variante | Esperado | Obtenido |
|---|---|---|
| Con header de X (referencia) | 200 | 200 |
| Sin header, `?orgId=X` y `?organizationId=X` | 200 con el mismo cuerpo que la referencia, o 403 | 200 con **cuerpo idéntico** a la referencia en los 10 endpoints |
| Sin header, `?orgId=Z` y `?organizationId=Z` (ajena) | 403 | 403 |
| Header X + `?orgId=Z` / `?organizationId=Z` | 403 | 403 |
| Sin header ni query | 403 | 403 (ya no hay datos de una organización `undefined`) |

Nota: `pro/context` para el ADMIN devuelve cuerpo vacío en las cuatro formas por igual (no tiene `Professional`); no es una diferencia.

### 3.4 Roles (criterio 5), MEMBER de X, con `x-mode` org, pro y sin header

Solo con payloads que no pueden escribir: ids inexistentes al azar, y `POST org/categories` con `{}` (el nombre es obligatorio).

| Caso | Esperado | Obtenido |
|---|---|---|
| `POST org/categories {}` | 403 | 403 (x3 modos) |
| `PUT` y `DELETE org/{categories,presets,staff,activity-types}/<azar>` | 403 | 403 (x3 modos) |
| `PUT org/staff/<azar>/category` | 403 | 403 (x3 modos) |
| `GET org/staff/lookup?cuit=1` | 403 | 403 (x3 modos) |
| Lecturas de formularios: `org`, `org/config`, `org/activity-types`, `pro/context`, `fee-rules`, `pro/payers` | 200 | 200 |
| Contraste: ADMIN `PUT org/categories/<azar>` | 404 (el rol pasa; no existe) | 404 |

Cambiar `x-mode` no altera ningún resultado (criterio 8, además de Jest).

### 3.5 Escrituras cruzadas, solo con UUID inexistentes (criterio 3)

ADMIN de X, 17 casos: `PUT/DELETE activity/<azar>` y `activity/abc`; `PUT/DELETE org/{categories,presets,staff,activity-types}/<azar>`;
`PUT org/staff/<azar>/category`; `PUT/DELETE pro/payers/<azar>`; `PUT v1/patients/<azar>`; `POST v1/patients/<azar>/merge` con `targetId`
al azar. **Todos 404 con cuerpo idéntico entre sí** (y al de las lecturas). `DELETE activity/<azar>` con `x-mode` org y pro, para ADMIN y
MEMBER: 404 en todos. Conteos sin cambios (sección 4). Las escrituras con ids reales de otra organización quedan en Jest, como indica la spec.

### 3.6 `POST activity` con paciente inexistente (la FK impide cualquier escritura)

| Caso | Esperado | Obtenido |
|---|---|---|
| ADMIN de X, `patientId` al azar | 404 | 404 (mismo cuerpo genérico) |
| MEMBER de X, `patientId` al azar | 404 (el permiso pasa; no existe el paciente) | 404 |
| ADMIN de X con header X y `organizationId` del body = Z | 403 | 403 `org-access-denied` |

`canLoadActivities` en `false` no se pudo ejercer en vivo (sección 6).

### 3.7 Rutas eliminadas y lookup (criterios 6 y 9)

| Caso | Esperado | Obtenido |
|---|---|---|
| `GET config/activity-types`, `GET/POST config/categories`, `GET config/dictionaries`, `config/org-rules`, `config/pro-rules`, `PUT config/categories/<azar>`, `DELETE config/activity-types/<azar>` | 404 | 404 |
| `GET system/professionals?cuit=1`, `GET pro/payers/lookup?cuit=1` | 404 | 404 |
| `GET settlements`, `GET settlements/<azar>/details`, `DELETE fee-engine/professional-categories/<azar>` | 404 | 404 |
| `GET settlements/calculate` sin parámetros (sigue existiendo) | 200 o 400 | 400 (validación) |
| `GET org/staff/lookup?cuit=<CUIT de un profesional de X>` como ADMIN de X | encuentra | `PROFESSIONAL` |
| El mismo CUIT como ADMIN de Z | `NOT_FOUND` sin datos | `NOT_FOUND`, sin id |

### 3.8 Frontend por HTTP (puerto 3002, sin navegador)

| Caso | Esperado | Obtenido |
|---|---|---|
| Cookie de ADMIN: `/<X>/work-items`, `/<X>/dashboard`, `/<X>/settings/categories` | 200 | 200 |
| Cookie de MEMBER: `/<X>/work-items` | 200 | 200 |
| ADMIN de X en `/<Z>/work-items` (organización ajena) | redirige a `/sin-acceso` | 307 a `/sin-acceso` |
| Sin cookie | redirige a login | 307 a `/login?from=...` |
| `grep` en `src/` y en `.next/` (build) de `/config/categories`, `/config/activity-types`, `system/professionals`, `payers/lookup` | sin llamadas | Solo un comentario en `data.ts:355`; el bundle no contiene ninguna |

## 4. Conteos (solo `SELECT`)

| Momento | User | Organization | Patient | WorkItem | Total `public` (sin `_prisma_migrations`) |
|---|---|---|---|---|---|
| Antes | 9 | 3 | 72 | 324 | 1483 |
| Después | 9 | 3 | 72 | 324 | 1483 |

Idénticos.

## 5. Criterio por criterio

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Relevamiento completo | `03-diseno-tecnico.md` §2 lista 40 filas (ruta, body/query, lookups, rutas a eliminar). El test estructural de `org-isolation.spec` exige que las rutas con `:param` del AppModule sean exactamente las 19 relevadas, y `security-invariants` clasifica todos los campos `*Id` e `id` de comandos y queries | **Cumple** |
| 2 | IDOR en lectura | En vivo: 404 idéntico (hash) para recurso real de otra organización, UUID al azar y no UUID, en `activity/:id`, `patients/:id/debt` y `/summary`; lecturas legítimas 200. Jest: las 19 rutas | **Cumple** |
| 3 | IDOR en escritura | En vivo solo con UUID inexistentes: 17 casos, 404 idéntico, conteos intactos. Jest: ataque con recurso de otra organización en cada ruta, 404 sin escritura, y merge/`createActivity` en `$transaction` | **Cumple** (cruce con ids reales: Jest) |
| 4 | Ids referenciados | Jest: `activity.service.spec` (paciente, profesional, participante, tipo, preset, pagador de otra organización = 404 sin escritura), `patients-handlers.spec` (destino del merge), `config-handlers.spec` (categoría ajena), `fee-rule-commands.spec`. En vivo: `POST activity` con paciente inexistente 404 y `organizationId` ajeno 403 | **Cumple** |
| 5 | Escrituras de configuración solo `ADMIN` | En vivo: MEMBER 403 en todas las escrituras de `org/*` y en el lookup, en los tres modos; lecturas de formularios 200. Jest: las 14 rutas no GET de `OrgController` con `@RequireOrgRole('ADMIN')`, MEMBER y profesional 403 sin escrituras. El caso "profesional sin membresía" no existe en la base | **Cumple** (profesional: solo Jest) |
| 6 | `ConfigController` | Se eliminó y el frontend migró a `org/*`: rutas `config/*` 404 en vivo; el frontend no las llama (código y bundle); `settings/categories` carga 200; `api-routes.test.mts` | **Cumple** (guardado desde la UI: ver sección 7) |
| 7 | `canLoadActivities` | Jest: `activity.service.spec` con `true` (con `x-mode` org y pro) y `false` (403 sin escrituras); ADMIN y MEMBER crean. En vivo: MEMBER y ADMIN llegan al chequeo del paciente (404). No hay usuario solo-`Professional` en la base | **Cumple** (Jest; sin prueba en vivo del 403) |
| 8 | Ownership sin `x-mode` | Jest: matriz de `canModifyActivity` y ownership por HTTP con `x-mode` org, pro y sin header; `security-invariants`: `x-mode` solo en `activity-controller.ts` (una vez) y sin `mode` en update/delete. En vivo: `x-mode` no cambia ningún resultado de rol ni de 404 | **Cumple** |
| 9 | Lookup por CUIT | En vivo: el CUIT de un profesional de X buscado desde otra organización da `NOT_FOUND` sin datos; propio da `PROFESSIONAL`; MEMBER 403; `system/professionals` y `pro/payers/lookup` 404 | **Cumple** |
| 10 | Frontend | HTTP: dashboard, work-items y settings 200 para ADMIN y MEMBER; organización ajena a `/sin-acceso`. `api-routes.test.mts` verifica que las 17 escrituras relanzan el error (un 403/404 no se ve como éxito). El resto requiere navegador | **No verificable** en navegador (lista en sección 8) |
| 11 | Tests Jest | 24 suites, 374 tests en verde; cubren cada punto del criterio (sección 2) | **Cumple** |
| 12 | Calidad | `tsc` backend y frontend sin errores; `npm test` backend (374) y frontend (11) en verde; `npm run build` OK. ESLint: no lo corrí; confío en la comparación contra `HEAD` de `04` §6 y de `05-revision.md` (no uso `npm run lint`, aplica `--fix`) | **Cumple** (ESLint por el informe del desarrollador y el revisor) |
| 13 | Verificación en vivo | `-Smoke` OK; lecturas cruzadas 404; escrituras solo con ids inexistentes; conteos 9 / 3 / 72 / 324 / 1483 iguales | **Cumple** |
| 14 | Sin schema nuevo | "No pending migrations to apply" al levantar; `git status` no muestra cambios en `backend/prisma/` (solo `??` de código y tests) | **Cumple** |

## 6. Lo que no pude verificar

- **Profesional sin membresía** (`canLoadActivities` en `true` o `false`, ownership de profesional, "profesional recibe 403 en `org/*`"): la base
  no tiene ese caso. Solo Jest.
- **Ownership real** (MEMBER borra una ajena, `createdByUserId` null con dueño del `Professional`): las 324 atenciones tienen
  `createdByUserId` null y las escrituras reales no se hacen en vivo. Solo Jest.
- **Escrituras con ids reales de otra organización**: por la salvaguarda, solo Jest.
- **Lecturas cruzadas con recurso real en una organización "B" con datos**: solo X tiene datos; se hizo el cruce inverso (ver 3.1).
- **`GET v1/patients` (lista) sin header**: `fake-prisma` no lo ejercita (limitación documentada en 04) y en vivo solo ejecuté los diez endpoints
  de la sección 3.3; la lista de pacientes quedó cubierta por el invariante estático y por el alta.
- **Navegador**: criterio 10 completo (sección 7).
- **ESLint** sobre los archivos tocados: no lo medí por mi cuenta.

## 7. Hallazgos

Sin bugs. Observaciones, ninguna bloquea un criterio:

- **O-1:** `PUT org/presets/:id` y `PUT org/staff/:id` con id inexistente y body incompleto dan 400 por el `ValidationPipe`
  antes del 404; es la validación previa a los handlers, no una fuga entre organizaciones (con body válido el 404 es idéntico).
- **O-2 (consecuencia de la política, ya aceptada en 00-estado):** 324 de 324 atenciones tienen `createdByUserId` null. Con la decisión 1,
  esos registros los borran solo el ADMIN o el dueño del `Professional`. Un MEMBER sin `Professional` no podrá borrar ninguna atención existente.
- **O-3:** `settlements/calculate` sin parámetros responde 400 (validación), no 403/404; no es un problema de aislamiento.

## 8. Lista para la prueba manual en el navegador (criterio 10)

Con un usuario ADMIN y uno MEMBER de la organización con datos, y un profesional si el usuario tiene uno.
**Escribir solo en datos de prueba**; los guardados de configuración no los ejercité en vivo.

1. **Dashboard** (modo organización y modo profesional): cargan KPIs, gráfico y distribución por pagador.
2. **Atenciones / Carga & Seguimiento:** lista y detalle; crear una atención (ADMIN y MEMBER); editar; marcar cobrada; cargar asistencia; borrar:
   como ADMIN cualquiera; como MEMBER solo las propias.
3. **Admisiones, botón Eliminar:** como MEMBER debe verse deshabilitado (con tooltip) en atenciones ajenas (o con autor null sin ser dueño del
   `Professional`); como ADMIN, habilitado.
4. **Pacientes:** lista, detalle, crear, editar (`PUT` ya registrado) y merge (origen y destino de la misma organización; mismo paciente = error).
5. **Profesionales (staff):** alta (con y sin categoría), editar, cambiar categoría, baja. Verificar que dar de baja no deja sin acceso a un
   usuario que tiene otros vínculos.
6. **Configuración:** categorías, tipos de actividad y presets (`settings/categories`, `settings/fees`, `settings/general`): listar, crear, editar y
   borrar (las llamadas ahora van a `org/*`); como MEMBER, las escrituras deben dar error de permiso.
7. **Pagadores y reglas de honorarios:** alta de pagador, alta y edición de reglas (ADMIN; profesional solo en un pagador propio).
8. **Liquidaciones:** cálculo (`settlements/calculate`) y su pantalla.
9. **Errores:** forzar un 403 (MEMBER en una escritura de configuración) y un 404 (recurso inexistente o de otra organización). Debe verse el
   toast/mensaje de error existente, **sin** mensaje de éxito, sin refrescar como si hubiera guardado y sin pantalla rota.
10. **Cambio de organización** por URL: una organización ajena lleva a `/sin-acceso`.

## 9. Estado del entorno al terminar

- `.\dev.ps1 -Stop` ejecutado: backend y frontend detenidos; contenedores `healthops-gem-db-1` y `healthops-gem-backend-1` detenidos (no
  corrían antes de mi sesión); volumen de datos intacto (sin `down -v`).
- Puertos 3002, 8080 y 5433 libres. El 3000 (coach-claudio) y el 3001 (otro proyecto) siguen como estaban.
- `.env`, `backend/.env` y `.claude/` sin modificar. Solo escribí este archivo dentro del repo. Los scripts de prueba están en el
  scratchpad de la sesión y no contienen secretos. `npm run build` regeneró `frontend/.next` (ignorado por git).

VEREDICTO: APROBADO
