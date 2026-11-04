# 07 — Testing: 009-modo-desde-rol

> Autor: tester. Fecha: 2026-11-04. No se modificó código de producción ni se agregaron tests (no encontré huecos frente a los
> 12 criterios; ver sección 2). Sin seeds, sin SQL de escritura, sin commit, push, stash, reset ni checkout. No se tocaron los puertos
> 3000 (coach-claudio) ni 3001, ni `.env`, `backend/.env` ni `.claude/`. Tokens HS256 firmados en memoria (issuer `solidus-api`,
> audience `solidus-web`, 15 min) con el secreto leído del entorno en tiempo de ejecución; no se imprimió ni se escribió ningún token,
> secreto, email, nombre ni dato personal. Scripts auxiliares en el scratchpad, fuera del repo.

## 1. Resultados automáticos

| Comando | Resultado |
|---|---|
| `backend: npx tsc --noEmit` | Sin errores |
| `frontend: npx tsc --noEmit` | Sin errores |
| `backend: npx jest` | **30 suites, 525 tests, todo en verde** |
| `frontend: npm test` | **35 de 35 en verde** |
| `frontend: npm run build` (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK |
| `.\dev.ps1` (desarrollo, `FRONTEND_PORT=3002`, sin `-Docker`) | Código 0 (hubo que iniciar Docker Desktop, que estaba apagado) |
| `.\dev.ps1 -Smoke` | `Backend OK - Frontend OK - Login OK` |
| `.\dev.ps1 -Stop` | OK (2 procesos y el contenedor de la base detenidos; datos conservados) |

## 2. Perfiles de la base usados (solo ids truncados y conteos)

Organización X = clínica `30000000…` (CLINIC, 324 atenciones, 72 pacientes, 12 `Professional` en total, 3 con `userId`).
Las otras dos organizaciones (`0effc249…` y `bb000001…`) son SOLO_PRACTICE sin atenciones.

| Alias | Vínculos reales | Se usó en |
|---|---|---|
| A | ADMIN de X, sin `Professional`, una sola membresía | X |
| M | MEMBER de X, sin `Professional`, una sola membresía | X |
| MP | MEMBER de X + `Professional` activo en X (53 atenciones propias) | X |
| MIX | MEMBER de X + ADMIN de `0effc249…` + `Professional` activo en X (159 atenciones) | X (como MEMBER) y `0effc249…` (como ADMIN) |
| AP | ADMIN de `bb000001…` + `Professional` activo en esa misma organización (ADMIN y profesional a la vez) | `bb000001…` |

No existe en la base: profesional **sin** membresía; ADMIN de una clínica con `Professional` propio; ADMIN de SOLO_PRACTICE **sin**
`Professional`. Esos casos quedan cubiertos solo por Jest (sección 7).

## 3. Verificación en vivo

### 3.1 Matriz de modo (criterios 3, 4, 5 y 11): 540 comprobaciones, 0 fallos

6 combinaciones perfil/organización x 15 variantes de pedido x 5 rutas dependientes del modo (`GET activity`, `GET v1/patients`,
`GET dashboard/kpis|chart|payers`) + `GET settlements/calculate` con las mismas 15 variantes. El esperado se calculó con la matriz
del diseño §4.2 (ruta común y ruta financiera con `orgRole: ADMIN`).

Variantes de pedido: `x-mode` org / pro / sin modo; `?mode=ORGANIZATION` / `PROFESSIONAL`; header y query coincidentes; mayúsculas
(`ORG`); `?mode=` vacío (cuenta como ausente); header y query en conflicto; `xyz` en header y en query; `?mode=` repetido
(`ORGANIZATION&mode=PROFESSIONAL`); `x-mode: org, pro`; `?mode=admin`.

| Perfil | Pide org | Pide pro | Sin pedido | Inválido / conflicto / repetido | Resultado |
|---|---|---|---|---|---|
| A (ADMIN) | 200 en común y financiera | 403 | 200 (org) | 400 | 90/90 |
| M (MEMBER, sin Prof) | común 200, financiera 403 | 403 | común 200, financiera 403 | 400 | 90/90 |
| MP (MEMBER + Prof) | común 200, financiera 403 | 200 | común 200, dashboard 200 (pro) | 400 | 90/90 |
| MIX en X (MEMBER + Prof) | igual que MP | igual | igual | 400 | 90/90 |
| MIX en `0effc249…` (ADMIN + Prof en X) | 200 | 200 (pro) | 200 (org) | 400 | 90/90 |
| AP (ADMIN + Prof) | 200 | 200 (pro) | 200 (org) | 400 | 90/90 |

- `settlements/calculate`: 200 para ADMIN (A, MIX en su org, AP) y 403 para M, MP y MIX en X, con cualquier valor de modo (la ruta no
  depende del modo).
- Cuerpos: el 403 de dashboard, de settlements y de `activity` en modo pro es el mismo
  `{"code":"forbidden", … "message":"Forbidden"}`. El 400 de valor inválido es `invalid-mode`.
- Sin token: 401. A sin `x-org-id`: 403 `org-access-denied`. A con `x-org-id` de otra organización: 403 `org-access-denied`.

### 3.2 Criterio 5 y 6: financieros y `settlements/calculate`

| Caso | Esperado | Obtenido |
|---|---|---|
| ADMIN: `dashboard/kpis`, `chart`, `payers` en org | 200 | 200 |
| MEMBER (M, MP, MIX en X) en org | 403 | 403 |
| ADMIN: `settlements/calculate?month=2026-05` | 200 (5 profesionales con detalle) | 200 |
| MEMBER: `settlements/calculate` (también con `organizationId` propio en la query) | 403 | 403 |
| ADMIN: `settlements/calculate` con `organizationId=<X>` en la query | mismo cuerpo que sin parámetro | 200, cuerpo idéntico |
| ADMIN de X: `settlements/calculate?organizationId=<otra org>` | 403 del guard, sin datos | 403 `org-access-denied` |

### 3.3 Criterio 7: montos del ADMIN en org contra SELECT independiente

La captura previa al cambio no se hizo (lo dijo el desarrollador). Se capturó el código actual y se comparó contra agregados por
`SELECT` de solo lectura sobre la base (rango 2025-01-01 a 2026-12-31, que abarca todo; la fecha de las atenciones va de 2025-01 a
2026-05). Solo totales.

| Magnitud (A, org) | API | SELECT independiente | Igual |
|---|---|---|---|
| `kpis.accruedGross` | 10.750.900 | 10.750.900 | sí |
| `kpis.accruedNet` (splits ORG, o resto, o bruto) | 3.176.900 | 3.176.900 | sí |
| `kpis.pending` | 0 | 0 | sí |
| `kpis.cashGross` | 10.750.900 | 10.750.900 | sí |
| `kpis.cashNet` | 3.176.900 | 3.176.900 | sí |
| `chart` devengado: días / suma bruto / suma neto | 111 / 10.750.900 / 3.176.900 | 111 días / 10.750.900 / 3.176.900 | sí |
| `chart` caja: días / suma bruto | 108 / 9.452.100 | 108 días / 9.452.100 | sí |
| `payers`: grupos / suma | 1 / 10.750.900 | 1 grupo / 10.750.900 | sí |
| `GET activity` (org): total / bruto / `netAmount` | 324 / 10.750.900 / 7.574.000 | 324 / 10.750.900 / suma de splits PROFESSIONAL 7.574.000 (más splits ORG 3.176.900 = bruto) | sí |

Vista pro de MP (control adicional): atenciones 53, bruto 1.854.300, neto 1.228.150 en `activity`, `kpis`, `chart` y `payers`; el
SELECT da 53 atenciones, bruto 1.854.300 y neto (splits del `Professional` propio) 1.228.150. MIX en pro: 159 atenciones, bruto
5.099.500, neto 3.007.360, consistente entre `activity`, `kpis`, `chart` y `payers`.

M (MEMBER) en `activity` org conserva los montos por atención: 324 / 10.750.900 / 7.574.000 (decisión 1, sin cambio).

### 3.4 Lecturas por id (decisión 7 y MEDIA-1)

No existe en la base un profesional sin membresía, así que el acotamiento por `Professional` propio de quien no es miembro queda en
Jest (`patient-read-access`, `patients-handlers.spec`, `patients.service.spec`, `org-isolation (n)`). En vivo:

| Caso | Esperado | Obtenido |
|---|---|---|
| A, M, MP y MIX: `GET activity/<propia>`, `patients/<propio>/summary`, `/debt`, con `x-mode` org, pro o sin modo | 200 | 200 en las 18 combinaciones |
| Mismos perfiles y modos con UUID al azar (`activity`, `summary`, `debt`) | 404 genérico | 404, y los tres cuerpos son idénticos (hash) |

Nota: en esta base el `Professional` de MP es participante o titular de todos los pacientes de X, así que no hay una atención o
paciente "ajeno" real contra el cual probar el recorte; por eso se apoya en Jest.

### 3.5 Escrituras (sin efecto)

`POST activity` con id inexistente y `x-mode: pro`: M (MEMBER sin Professional) 403 y A (ADMIN de clínica sin Professional) 403, antes
de leer o escribir nada. No se probaron otras escrituras. Conteos finales iguales (sección 5).

### 3.6 Decisión 4: `Professional` dados de baja

`Professional` con `deletedAt` no nulo: **0**. Atenciones de esos `Professional` (`WorkItem`): **0**; participaciones: **0**.
La decisión 4 no cambia ningún monto ni lista en esta base.

### 3.7 Frontend por HTTP (puerto 3002)

| Caso | Esperado | Obtenido |
|---|---|---|
| Cookie de A, M y MP: `/<X>/dashboard`, `org/liquidaciones`, `work-items`, `patients`, `org/pacientes`, `org/admisiones`, `org/profesionales`, `pro/resumen`, `pro/atenciones` | 200 | 200 en todas, con contenido |
| `/<X>/settings` | 404 (no existe esa ruta) | 404 |
| Sin cookie | redirige a login | 307 a `/login?from=…` |
| `grep` de `createWorkItem` | `mode` fuera del body, solo `x-mode` | `const { mode, ...body } = data` y `x-mode` solo si hay modo |
| `getFeeRules` | sin `?mode=` | `GET /fee-rules` sin query; 0 coincidencias de `fee-rules?mode` en `.next/` |
| `calculateSettlements` | sin `organizationId` | el bundle solo contiene `settlements/calculate?month` |

Límite: dashboard, liquidaciones y pacientes son páginas cuyo contenido llega por fetch del cliente; el HTML es el mismo para los tres
roles (mismo largo), así que por HTTP solo se comprueba que cargan sin error y que no redirigen. El comportamiento por rol de la UI (menús,
selector, redirecciones del Sidebar) se verifica en el navegador (sección 6). El respaldo de datos por rol es la matriz de 3.1.

## 4. Criterio por criterio

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Relevamiento | `03-diseno-tecnico.md` §2.1 (backend) y §2.2 (frontend). El test (l) de `org-isolation` fija el conjunto de rutas con `@UsesViewMode` | Cumple |
| 2 | Modo resuelto en el servidor, una sola función, invariante estático | `resolveViewMode`/`ViewModeGuard` (`view-mode.ts`, `view-mode-guard.ts`); `grep` de producción: `x-mode` solo en `view-mode-guard.ts`, `cors-config.ts` y un comentario de `auth-context.ts`; `security-invariants` (4 casos 009: x-mode, sin campo `mode`, `isProfessionalMode` acotado, rutas con `@UsesViewMode`) en verde; `view-mode.spec`, `view-mode-guard.spec`, `guard-chain.spec` en verde | Cumple |
| 3 | `org` sin membresía: 403 | En vivo no hay profesional sin membresía. En vivo: A con `x-org-id` de una organización donde no es miembro da 403 `org-access-denied`. Jest: matriz "solo Professional" pide org = 403 (`view-mode.spec`, `org-isolation (j)`) | Cumple (Jest + vivo parcial) |
| 4 | `pro` sin `Professional`: 403 | En vivo: A y M piden pro por header y por query en `activity`, `patients` y `dashboard`: 403 en todas las rutas; `POST activity` con `x-mode: pro` de M y A: 403 | Cumple |
| 5 | Financieros solo ADMIN | En vivo 3.1 y 3.2: ADMIN 200, MEMBER y profesional (MP, MIX en X) 403 en `dashboard/*` org y en `settlements/calculate` | Cumple |
| 6 | `settlements/calculate` | `@CurrentOrgId()` y `@RequireOrgRole('ADMIN')`; `CalculateSettlementsQuery.organizationId` clasificado `'controller'` en `ID_FIELDS`; el invariante de organización lo cubre; `org-isolation (k)` y vivo 3.2 (la query ajena da 403, la propia es igual a no mandarla) | Cumple |
| 7 | Montos coherentes | 3.3: totales de ADMIN en org iguales a los SELECT independientes (kpis, chart devengado y caja, payers, activity); vista pro de MP igual al SELECT. Tests de valores conocidos: `find-all-activities.spec`, `dashboard.service.spec`, `calculate-settlements.spec`. **Limitación:** no hubo captura previa al cambio; la comparación es contra la base, no contra el mismo código de `main` | Cumple (con la limitación indicada) |
| 8 | Frontend | `data.ts`: `createWorkItem` sin `mode` en el body, `getFeeRules` sin `?mode=`, `calculateSettlements` sin `organizationId`; `Sidebar.tsx` con `allowedViewModes`/`pickViewMode`/`canSeeRestrictedLinks`; `work-items/page.tsx` muestra tabla vacía ante 403 de modo y `/sin-acceso` ante 403 de organización; 35 tests `node --test` verdes; páginas 200 por HTTP. **Falta confirmar en navegador** (sección 6) | Cumple por código y tests; pendiente la revisión visual del usuario |
| 9 | Tests | Jest 30 suites / 525 verdes; `node --test` 35 verdes; matriz por vínculos x modo en `view-mode.spec`; financieros por rol en `org-isolation (k)`; invariante estático en `security-invariants`; integración con `AppModule` real en `org-isolation` (j a n) | Cumple |
| 10 | Calidad | `tsc` backend y frontend sin errores; Jest y `node --test` verdes; `npm run build` OK. ESLint: no se volvió a correr (`--fix` prohibido); el revisor ya lo evaluó en 05 | Cumple (ESLint según 05-revision) |
| 11 | Verificación en vivo | Secciones 3.1 a 3.7: 540 comprobaciones de matriz sin fallos, 200/403/400 según la política, montos del ADMIN iguales a los SELECT, `-Smoke` OK, conteos sin cambios | Cumple |
| 12 | Sin schema nuevo | `git status`: sin cambios en `backend/prisma/` ni migraciones nuevas; `dev.ps1` informó "Migraciones aplicadas" sin pendientes | Cumple |

## 5. Conteos (solo `SELECT count`)

| Momento | User | Organization | Patient | WorkItem | Total filas de `public` (sin `_prisma_migrations`) |
|---|---|---|---|---|---|
| Antes | 9 | 3 | 72 | 324 | 1483 |
| Después | 9 | 3 | 72 | 324 | 1483 |

Idénticos.

## 6. Lista de verificación manual en navegador (para el usuario)

Entrar con un ADMIN de la clínica, un MEMBER (recepción) y, si se quiere, con el usuario que es MEMBER y profesional a la vez.

1. Selector "Ver como":
   - ADMIN de clínica sin `Professional`: solo ofrece la vista de organización.
   - MEMBER sin `Professional`: solo organización.
   - Usuario con rol `PROFESSIONAL`: ofrece las vistas que le corresponden. Si la vista guardada ya no le corresponde, se corrige sola.
2. Menús visibles por rol:
   - MEMBER: no ve Dashboard de organización, Liquidaciones, Reglas ni Ajustes de organización. Si escribe esas URLs a mano, lo redirigen.
   - ADMIN: ve todos.
3. Dashboard ADMIN en org (rango "todo"): debe mostrar los mismos montos de siempre. Devengado bruto 10.750.900 y retención/neto de la
   organización 3.176.900, pendiente 0.
4. Vista pro del usuario MEMBER + profesional: dashboard con bruto 1.854.300 y neto 1.228.150 (usuario MP del estado actual de la base).
5. Liquidaciones como ADMIN: carga el mes con datos (mayo 2026 tiene 5 profesionales).
6. Carga & Seguimiento como MEMBER: lista de atenciones de toda la clínica y alta de una atención sin errores. Ojo: esto sí escribe datos, usar una
   base de prueba.
7. Un 403 (por ejemplo, forzar `?mode=` en la URL de la API, o probar un MEMBER en Dashboard pidiendo la vista de organización): se
   muestra el mensaje existente ("sin permisos") y no una pantalla en blanco ni un error de aplicación.
8. Con un usuario de una sola organización, abrir la URL de otra organización: redirige a `/sin-acceso` (comportamiento del 007, sin cambios).

## 7. Qué no pude verificar

- **Profesional sin membresía** (decisiones 5, 6 y 7, criterios 3 y MEDIA-1): no existe en la base. Cubierto por Jest (`org-isolation (j), (n)`,
  `patient-read-access`, `patients.service.spec`). Incluye el recorte de resumen, deuda, última visita y listado de pacientes a lo
  propio, y `POST activity` con `x-mode: org` hacia una organización donde no es miembro.
- **ADMIN de SOLO_PRACTICE sin `Professional`** pidiendo pro (`pro` vacío): no existe en la base. Jest.
- **ADMIN de clínica con `Professional` propio**: no existe. Jest (matriz "ADMIN + Professional").
- **Recorte contra atenciones ajenas reales**: en esta base MP participa o es titular de todos los pacientes de X, así que no hay un
  paciente ajeno real para MP. Jest.
- **Captura previa de montos con el código de `main`**: no existe. Se verificó contra SELECT independientes y Jest con valores
  conocidos, que es el plan alternativo de la §8.3 del diseño.
- **Comportamiento visual por rol en la UI** (selector, menús, mensaje del 403): sin navegador; lista en la sección 6.
- **ESLint**: no lo corrí (`npm run lint` usa `--fix` y `npx eslint` tiene ruido preexistente); queda lo informado en 04 y 05.
- **Escrituras reales** (`POST/PUT/DELETE` con ids reales): fuera de las salvaguardas; cubiertas por Jest.

## 8. Estado del entorno

- `.\dev.ps1 -Stop` ejecutado: backend y frontend detenidos, contenedor de la base detenido; volumen intacto (sin `down -v`). Puertos
  3002, 8080 y 5433 libres. El 3000 (coach-claudio) sigue ocupado por su proceso, como al empezar. El 3001 no estaba en uso y no lo
  toqué.
- **Docker Desktop estaba apagado y lo inicié yo** para poder correr la base; sigue abierto.
- `scripts/dev-lib.tests.ps1`: **existe en disco**, pero `git status` lo marca `M` (modificado), no `D`. Al inicio de mi sesión
  ya estaba así; el desarrollador lo había visto como borrado. Alguien lo restauró o regeneró con contenido distinto al del
  índice. Conviene revisar `git diff scripts/dev-lib.tests.ps1` antes del commit. No lo toqué.
- `.env`, `backend/.env` y `.claude/` sin modificar por mí (`.claude/settings.json` ya figuraba modificado antes de mi sesión). Solo
  escribí este archivo dentro del repo. `npm run build` regeneró `frontend/.next` (ignorado). Scripts y perfiles en el scratchpad
  (`profiles.env` solo tiene UUID de la base local).

## 9. Bugs

Ninguno de severidad que afecte a los criterios. Observaciones menores, no bloqueantes:
1. `settlements/calculate?organizationId=<otra org>` responde 403 `org-access-denied` (lo da el guard de organización, coherente con
   el 007) y no se ignora; esto no es una fuga y coincide con la spec.
2. `GET /v1/patients` y `GET /activity` en vista org siguen mostrando montos por atención al MEMBER (decisión 1 del PO, intencional).

VEREDICTO: APROBADO
