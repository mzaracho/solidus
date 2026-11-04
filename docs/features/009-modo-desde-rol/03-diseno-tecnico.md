# 03 — Diseño técnico: 009-modo-desde-rol

> Autor: arquitecto. Entradas: `01-spec.md` (política del PO y 12 criterios), `.claude/CLAUDE.md`, del 007 el
> `00-estado.md`, el `03-diseno-tecnico.md` (§3.1 `RequestContext`, §3.2 `org-resource`) y el `06-seguridad.md` (INFO-1
> y MENOR-1), el §3.3 y el §3.4 del 03 del 005, `docs/auditoria/BACKLOG.md` (#2 y #41) y `docs/auditoria/RIESGOS.md`
> (local; S3, M-2 e INFO-1).
>
> Solo lectura: no se ejecutó `dev.ps1`, no se levantaron contenedores, no hubo SQL y no se modificó código. Del `.env`
> no se leyó nada. Línea base: `npx tsc --noEmit` del backend con 0 errores.
>
> Regla para este documento y los siguientes: sin tokens, secretos, URLs con credenciales ni datos reales. Los ids son
> genéricos (`<X>`, `<T>`), y las IPs, si hicieran falta, van en `192.0.2.x`.
>
> **Dependencia con el 008:** el 008 se está commiteando en paralelo y toca `work-items/page.tsx`, `workload/*` y
> `AdmisionesTable.tsx`. El desarrollador del 009 empieza **después** de ese commit (ver §10, riesgo R-1).

## 1. Estado actual verificado

| Pieza | Hallazgo |
|---|---|
| Guards globales | Dos `APP_GUARD` en orden (`guard-provider.ts`): `AuthenticationGuard` (JWT verificado, `request.auth.userId`) y `OrgAccessGuard` (valida las cinco fuentes de organización y deja `request.orgAccess = { organizationIds, primaryOrgId, roles }`, con el rol de la base o `null` si el vínculo es solo de `Professional`). `OrgRoleGuard` es de método (`@UseGuards`) y exige el rol en **todas** las organizaciones del request. `guard-chain.spec.ts` afirma que hay exactamente dos `APP_GUARD`. |
| `OrgAccessService.getAccess` | Una consulta por organización: membresía, o `Professional` `ACTIVE` con `deletedAt = null`, siempre con el `User` no dado de baja. Devuelve `{ allowed, memberRole }`. **No informa** si además hay un `Professional`, ni el tipo de organización. |
| Contexto | `Dispatcher` pasa `buildRequestContext(req)` a cada handler: `{ userId, org: { userId, primaryOrgId, orgIds, roles } }`, congelado. `requireOrgScope`, `requireOrgId` y `roleIn` en `request-context.ts`. |
| Modo | El cliente lo manda de **dos formas**: query `?mode=ORGANIZATION|PROFESSIONAL` (listados y dashboard) y header `x-mode: org|pro` (solo `POST /activity`). Lo leen dos controladores directamente (`ActivityController`, `PatientsController`) y en el dashboard llega por el `@Query()` del DTO, sin que el controlador lo nombre. Cualquier valor que no sea `PROFESSIONAL`/`pro` se trata como organización. Nadie lo valida contra los vínculos. |
| Vista pro multi-organización | En modo pro los servicios buscan **todos** los `Professional` del usuario con `{ userId, status: 'ACTIVE' }` (**sin** `deletedAt: null`) y listan por `professionalId` o participante, **sin filtro de organización**. Esa consulta se repite en tres archivos (y tres veces por carga del dashboard). |
| Financieros de la organización | `GET dashboard/{kpis,chart,payers}` en modo org y `GET settlements/calculate` responden a cualquier vínculo (INFO-1 del 007). `settlements/calculate` toma `organizationId` del `@Query()` sin `@CurrentOrgId()` (MENOR-1). El front solo oculta el menú al `MEMBER`. |
| Invariantes | `security-invariants.spec.ts` (007) exige que `x-mode` solo aparezca en `activity-controller.ts`, una vez. `ID_FIELDS` clasifica `CalculateSettlementsQuery.organizationId` como `controller`, pero **ningún controlador lo asigna**: la clasificación es incorrecta y el test no lo detecta. |
| Tests | Jest: 24 suites (incluye `test/org-isolation.spec.ts` con `AppModule` real, `fake-prisma` y un stub de `OrgAccessService`). `fake-prisma` **no** soporta filtros de relación (`some`), así que hoy ningún test HTTP ejercita el modo pro de los listados. Frontend: `node --test` con 4 archivos. |
| Rol en el front | `orgRole` sale del token y es el de la **primera** membresía (`login-query-handler.ts`); `null` solo si el usuario no tiene ninguna membresía. `availableRoles` son los códigos globales `User.userRoles` (`ORGANIZATION`, `PROFESSIONAL`), no vínculos por organización. |

## 2. Relevamiento completo (criterio 1)

### 2.1 Backend: cada lectura de `mode` / `x-mode`

| # | Archivo y línea | Qué lee | Qué decide hoy | Cómo queda |
|---|---|---|---|---|
| B1 | `api/controllers/v1/activity/activity-controller.ts:41,46` | `@Query('mode')` en `GET /activity` | Lo copia a `query.mode` | Se elimina. La ruta lleva `@UsesViewMode()` |
| B2 | `activity-controller.ts:53,56` | `@Headers('x-mode')` en `POST /activity` | Lo copia a `command.mode` | Se elimina. La ruta lleva `@UsesViewMode()` |
| B3 | `application/features/activity/queries/find-all-activities-query.ts:77` | Campo `mode` del query | — | Se elimina el campo |
| B4 | `find-all-activities-query.ts:109-129` | `isProfessionalMode(query.mode)` | Pro: busca los `Professional` del usuario y lista cross-org por profesional o participante. Org: filtra por la organización | Igual, pero el modo y los `Professional` salen de `ctx.view` (§3.5) |
| B5 | `find-all-activities-query.ts:204-212` | Ídem | `netAmount`: pro = splits cuyo `beneficiaryId` es un `Professional` propio; org = suma de splits `PROFESSIONAL` | Sin cambios de fórmula (criterio 7) |
| B6 | `find-all-activities-query.ts:220-229` | Ídem | `role` del profesional en la atención (solo pro) | Sin cambios de fórmula |
| B7 | `application/features/dashboard/queries/get-dashboard-kpis-query.ts:28`, `get-dashboard-chart-query.ts:30,58`, `get-dashboard-payer-dist-query.ts:25,45`, `Dtos/dashboard-kpi-query.dto.ts:7` | Campo `mode` que llena el `ValidationPipe` desde `?mode=` | Lo pasan al servicio | Se eliminan los campos `mode` (y `userId`, que solo servía para buscar los `Professional`). Las tres rutas llevan `@UsesViewMode({ orgRole: 'ADMIN' })` |
| B8 | `infrastructure/features/dashboard/dashboard.service.ts:58-78,91,127,143` (`getKpis`) | `isProfessionalMode(query.mode)` | Pro: cross-org propio; neto, pendiente y cobrado neto = splits propios. Org: la organización; neto = splits `ORG` o el remanente; pendiente = bruto impago | Igual, con `view` como parámetro (§3.5) |
| B9 | `dashboard.service.ts:177,206,243` (`getChart`) | Parámetro `mode` | Ídem, por día | Ídem |
| B10 | `dashboard.service.ts:273,289` (`getPayerDistribution`) | Parámetro `mode` | Pro: ids de atenciones propias y `groupBy`. Org: la organización | Ídem |
| B11 | `dashboard.service.ts:13-32` | — | `resolveProfessionalId` (sin uso) y `resolveAllProfessionalIds` (sin `deletedAt`) | Se eliminan los dos |
| B12 | `api/controllers/v1/patients/patients-controller.ts:46,51` | `@Query('mode')` en `GET v1/patients` | Lo copia a `query.mode` | Se elimina. La ruta lleva `@UsesViewMode()` |
| B13 | `application/features/patients/queries/find-all-patients-query.ts:27`, `domain/features/patients/find-all-patients-filter.ts:7` | Campo `mode` | — | Se elimina el campo |
| B14 | `infrastructure/features/patients/patients.service.ts:36-73` | `isProfessionalMode(query.mode)` | Pro: pacientes con atenciones propias (cross-org) **más todos los pacientes de la organización de la URL** más los de prácticas `SOLO_PRACTICE` donde es miembro | Modo y `Professional` desde `view`; los pacientes de la organización de la URL solo si corresponde (§3.6, Aclaración 5) |
| B15 | `application/features/activity/commands/create-activity-command.ts:118,152`, `Dtos/create-activity.dto.ts:123` | Campo `mode` (`?? 'org'`) | Lo pasa al servicio | Se eliminan los campos. El handler pasa `requireViewScope(ctx).mode` |
| B16 | `infrastructure/features/activity/activity.service.ts:42,135,144,187,230,321` | Parámetro `mode` | Pro: profesional propio si no vino uno; regla de primera carga; montos manuales; `Professional` automático en `SOLO_PRACTICE`; split privado en `SOLO_PRACTICE`. Org: valores del tipo de actividad o preset | Igual con `mode: ViewModeValue` del contexto, más: modo org exige membresía en la organización destino (§3.7) |
| B17 | `domain/constants/app.constants.ts:4-21` | `USER_MODE`, `isProfessionalMode` | Normaliza los dos valores | `USER_MODE` se reutiliza para normalizar en el guard. `isProfessionalMode` queda solo para el login (B18) |
| B18 | `application/features/auth/login-query-handler.ts:145` | `isProfessionalMode(initialRole)` sobre el **código de rol** global, no sobre un dato del cliente | `type: 'pro'|'org'` de la respuesta del login | Sin cambios (no es entrada del cliente) |
| B19 | `infrastructure.bootstrap/config/app/cors-config.ts:23` | `x-mode` en `CORS_ALLOWED_HEADERS` | Permite el header | Sin cambios (el front lo sigue mandando como preferencia) |
| B20 | `security-invariants.spec.ts:92-112` | Invariante del 007 | `x-mode` solo en `activity-controller.ts`, una vez | Se reemplaza por los invariantes de §3.9 |
| B21 | `application/features/fee-engine/commands/fee-rule-commands.ts` (`FindFeeRulesQuery`) | **No** lee `mode` (el front manda `?mode=` y se ignora) | Filtra por la categoría del `Professional` del usuario en la organización, en cualquier vista | Sin cambios (Aclaración 9); el front deja de mandar `?mode=` |
| B22 | `api/controllers/v1/settlements/settlements-controller.ts:13` y `calculate-settlements-query.ts` | No lee modo; `organizationId` del `@Query()` crudo | Liquidación de todos los profesionales, a cualquier vínculo | `@CurrentOrgId()`, `@RequireOrgRole('ADMIN')` (§3.8) |

Los controladores `ProductionController` y `ReportingController` no leen el modo y no están registrados (011). `PUT` y `DELETE
activity/:id` ya no dependen del modo desde el 007.

### 2.2 Frontend: quién manda o usa el modo

| # | Archivo y línea | Qué hace | Cómo queda |
|---|---|---|---|
| F1 | `services/data.ts:180,230-232` (`getDashboardStats`) | `?mode=ORGANIZATION|PROFESSIONAL` en kpis, chart y payers | Se sigue mandando como **preferencia** |
| F2 | `data.ts:268-271` (`getWorkItems`) | `?mode=` | Preferencia |
| F3 | `data.ts:323,329` (`getPatients`) | `?mode=` si viene | Preferencia |
| F4 | `data.ts:357-359` (`getFeeRules`) | `?mode=` (el backend lo ignora) | Deja de mandarlo; se quita el parámetro y se ajustan sus 3 llamadas |
| F5 | `data.ts:375-387` (`createWorkItem`) | `x-mode` desde `data.mode`; además manda `mode` en el body | Header como preferencia; `mode` se quita del body |
| F6 | `data.ts:966-999` (`calculateSettlements`) | `?organizationId=` y dos `getOrgDetails` previos | Sin `organizationId` en la query y sin las llamadas previas (el backend usa el header validado) |
| F7 | `store/useStore.ts:9,16,21,34,40,46` | `viewMode` persistido (default `ORGANIZATION`) | Sin cambios de forma; lo corrige el Sidebar (F8) |
| F8 | `components/layout/Sidebar.tsx:67,83,88-106,113,155-172` | Menú por `viewMode`; oculta `restricted` si `orgRole === 'MEMBER'`; cambio de vista por `availableRoles`; auto-cambio si hay un solo código | Usa `allowedViewModes()` (nuevo, §3.10): sin membresía no se ofrece "Organización"; los `restricted` se ocultan a todo no `ADMIN` |
| F9 | `components/providers.tsx:14-41` | Hidrata `availableRoles` y `orgRole` del token | Sin cambios |
| F10 | `app/page.tsx:20-33` | Ruta inicial por `orgRole` y códigos de rol | Sin cambios |
| F11 | `app/(dashboard)/[orgSlug]/dashboard/page.tsx:23,37,62` | `getDashboardStats(viewMode)` y textos por modo | Sin cambios: un 403 ya muestra el toast existente y la página queda vacía |
| F12 | `app/(dashboard)/[orgSlug]/work-items/page.tsx:11` (Server Component) | `getWorkItems('ORGANIZATION')` | Un 403 `forbidden` (no de organización) se muestra como tabla vacía en lugar de romper la página (§3.10) |
| F13 | `components/domain/patients/PatientDirectory.tsx:43,72,148,179,220` | Pacientes e historial con `viewMode`; oculta "fusionar" en pro | Sin cambios |
| F14 | `components/domain/pro/deudores/DeudoresTable.tsx:61` | `getWorkItems('PROFESSIONAL')` | Sin cambios |
| F15 | `components/domain/pro/settings/PayerRulesManager.tsx:59`, `pro/atenciones/AtencionesTable.tsx:77-78,274`, `org/pacientes/PacientesTable.tsx:45-46,157` | `getWorkItems`/`getFeeRules` con modo fijo y `mode=` del formulario | Solo cambia la firma de `getFeeRules` (F4) |
| F16 | `components/domain/org/admisiones/AdmisionesTable.tsx:91,146,429` | `getWorkItems('ORGANIZATION')`, `createWorkItem({ ..., mode: 'org' })` | Sin cambios |
| F17 | `components/domain/workload/form/WorkItemForm.tsx:88,127-129,201-217,296,311,396-435,492,762` | Lógica de formulario por vista; arma `mode: 'org'|'pro'` | Sin cambios |
| F18 | `components/domain/shared/SmartFilterBar.tsx:24,111,133`, `app/(dashboard)/[orgSlug]/settings/general/page.tsx:17-167` | Solo presentación | Sin cambios |
| F19 | `app/test-suite/page.tsx:31,78` | Herramienta de desarrollo (`mode: 'PROFESSIONAL'`) | Sin cambios (regla 9: no usar contra datos reales) |

## 3. Uso real por rol (relevado en el código)

Rutas de menú en `Sidebar.tsx`. "Org" y "Pro" son la vista del store.

| Rol (vínculos en la organización de la URL) | Ruta inicial (`app/page.tsx`) | Pantallas | Endpoints que dependen del modo | Modo que manda hoy |
|---|---|---|---|---|
| **ADMIN** | `dashboard` | Org: Dashboard, Carga & Seguimiento, Liquidaciones, Profesionales, Pacientes, Reglas de Honorarios, Ajustes | `dashboard/*` (org), `GET activity` (org), `GET v1/patients` (org), `POST activity` (`org`), `settlements/calculate` | `ORGANIZATION` / `org` |
| **MEMBER** (recepción) | `org/admisiones`; si además tiene el código `PROFESSIONAL`, `pro/atenciones` | Org: Carga & Seguimiento, Profesionales (solo lectura útil: las escrituras dan 403), Pacientes. Dashboard, Liquidaciones y ajustes ocultos y con redirección | `GET activity` (org), `GET v1/patients` (org), `POST activity` (`org`) | `ORGANIZATION` / `org` |
| **Solo `Professional`** (sin membresía) | `dashboard` (el auto-cambio lo deja en Pro si su único código es `PROFESSIONAL`) | Pro: Dashboard, Carga & Seguimiento, Pacientes, Reglas de Honorarios, Ajustes | `dashboard/*` (pro), `GET activity` (pro), `GET v1/patients` (pro), `POST activity` (`pro`) | `PROFESSIONAL` / `pro`. **Si el store persistió `ORGANIZATION` y tiene los dos códigos, hoy ve los KPIs de toda la organización** |
| **Professional + miembro** (típico: profesional independiente, `ADMIN` de su práctica `SOLO_PRACTICE` y `Professional` en clínicas) | Según `orgRole` | Las dos vistas, con el selector "Ver como" | Todos, en los dos modos | Los dos |

**¿El `MEMBER` ve montos de la organización?** No ve **agregados** (KPIs, gráficos, distribución por pagador ni
liquidaciones): el menú los oculta y no hay otra pantalla que los use. **Sí ve montos por atención** al operar:
- "Carga & Seguimiento": columna "Valor" (bruto) de cada atención y, en el detalle (`GET activity/:id`,
  `ActivityDetailDialog`), la **distribución**: splits de la organización y de cada profesional, con nombre;
- "Gestión de Pacientes": deuda por paciente e historial con montos;
- `work-items` (sin enlace en el menú, arreglada en el 008): "Monto Total" y "Neto Prof." por atención;
- "Gestión de Profesionales" (`GET org/config`): categorías con su porcentaje.

Ver Aclaración 1.

**Vista pro multi-organización, cómo funciona hoy:** el front manda `x-org-id` = organización de la URL (para el
profesional independiente, su práctica). El backend junta todos los `Professional` del usuario y lista las atenciones
de **cualquier** organización donde es profesional o participante (`isExternal`/`isReadOnly` marcan las ajenas a la URL).
Los KPIs pro suman solo los splits propios. Al cargar, el formulario manda `organizationId` = organización del paciente,
y el guard valida las dos. Lo que se ve de otras organizaciones son **las atenciones del propio `Professional`**, más los
pacientes de la organización de la URL (B14).

## 4. Decisiones

### 4.1 Dónde se resuelve el modo: `ViewModeGuard`, un tercer `APP_GUARD` con metadata por ruta (criterio 2)

**Decisión.** Un guard global nuevo, `guards/view-mode-guard.ts`, registrado **después** de `OrgAccessGuard`. Solo actúa en
las rutas marcadas con un decorador nuevo, `@UsesViewMode(options?)` (`config/core/authentication/view-mode-decorator.ts`),
igual que `@Public()` y `@OrgOptional()` gobiernan los otros dos guards. En el resto de las rutas no lee nada ni consulta la
base.

En una ruta marcada:
1. Lee la preferencia **una sola vez**, de `request.headers['x-mode']` y `request.query['mode']`, y la normaliza con
   `parseRequestedMode` (§4.2).
2. Toma el rol de la organización principal X de `request.orgAccess.roles[primaryOrgId]` (ya viene de la base).
3. Consulta los `Professional` del usuario **solo si hace falta** (se pidió `pro`, o no se pidió modo y no hay
   membresía): `OrgAccessService.getActiveProfessionals(userId)`.
4. Consulta el tipo de X **solo** en el caso de la excepción `SOLO_PRACTICE` (§4.2): `OrgAccessService.getOrgType(X)`.
5. Calcula el modo efectivo con la función pura `resolveViewMode` y deja `request.viewAccess`. Si no corresponde, 403.

**Exposición en el contexto** (`request-context.ts`):

```ts
export type ViewModeValue = 'org' | 'pro';
export interface OwnProfessional {
  readonly id: string;
  readonly organizationId: string;
  readonly canLoadActivities: boolean;
}
export interface ViewScope {
  readonly mode: ViewModeValue;
  readonly requested: ViewModeValue | null;
  /** Solo en pro: Professional ACTIVE, deletedAt null, de cualquier organización, tomados de la base. En org: []. */
  readonly professionals: readonly OwnProfessional[];
}
export interface RequestContext {
  readonly userId: string | null;
  readonly org: OrgScope | null;
  readonly view: ViewScope | null; // null en rutas sin @UsesViewMode
}
export function requireViewScope(ctx: RequestContext | undefined): ViewScope; // null → 403 forbidden
export const professionalIdsOf = (view: ViewScope) => view.professionals.map((p) => p.id);
```

`buildRequestContext` copia y congela `request.viewAccess` (nuevo campo opcional de `AuthenticatedRequest` en
`auth-context.ts`). Los handlers toman el modo **solo** de `requireViewScope(ctx)`: si alguien saca el decorador de una
ruta, el handler falla cerrado con 403.

**Por qué un guard global y no otra cosa:**
- *Dentro de `OrgAccessGuard`:* mezclaría dos responsabilidades en el guard que más tests tiene. Además ese guard corre en
  todas las rutas.
- *`@UseGuards(ViewModeGuard)` por ruta:* el invariante del 005 solo permite `@UseGuards(OrgRoleGuard)` en controladores, y
  una ruta sin el guard quedaría sin modo. Con metadata y el guard global, la ausencia falla cerrado y el conjunto de rutas
  marcadas se verifica por metadata (§8.1).
- *Un servicio que llaman los handlers con el modo que les pasa el controlador:* los controladores seguirían leyendo
  `x-mode` (contradice el criterio 2) y cada handler tendría que acordarse de llamarlo: falla abierto.
- *Interceptor:* corre después de los guards de método. Un guard corre antes que los pipes, así que un 403 nunca llega a
  validar el body. Es el mismo criterio del 005 (§3.3).

**`OrgAccessService` gana dos métodos** (mismo servicio, ya registrado en `AppModule`; sin módulo nuevo):

```ts
/** Professional del usuario con vínculo activo (status ACTIVE, deletedAt null, User no dado de baja), en cualquier organización. */
getActiveProfessionals(userId: string): Promise<OwnProfessional[]>;
// professional.findMany({ where: { userId, status: 'ACTIVE', deletedAt: null, user: { deletedAt: null } },
//                         select: { id: true, organizationId: true, canLoadActivities: true } })
getOrgType(orgId: string): Promise<OrgType | null>;
```

### 4.2 Regla exacta del modo efectivo

**Preferencia pedida** (`parseRequestedMode(header, query)`, en `config/core/authentication/view-mode.ts`):
- `undefined`, `null` o `''` (tras `trim`) cuentan como ausentes;
- `org` u `organization` → `org`; `pro` o `professional` → `pro`. Sin distinguir mayúsculas. Así sirven los dos valores que
  manda el front hoy (`ORGANIZATION`/`PROFESSIONAL` en la query y `org`/`pro` en el header), con las constantes `USER_MODE`;
- un valor que no es string (header o query repetidos llegan como arreglo), un valor desconocido, o header y query
  presentes con valores distintos → **400** `{ code: 'invalid-mode', message: 'Bad Request' }`. Falla cerrado: hoy un valor
  desconocido se trataba como organización.

**Vínculos** (en la organización principal X; el guard ya garantizó que existe alguno):
- `r` = rol de membresía en X (`ADMIN`, `MEMBER` o `null`);
- `P` = el usuario tiene al menos un `Professional` activo, en cualquier organización;
- `S` = `r === 'ADMIN'` y X es `SOLO_PRACTICE` (práctica propia que todavía no tiene su `Professional`: se crea solo en la
  primera carga en modo pro, ver `activity.service.ts:230`).

**Resolución** (`resolveViewMode(requested, links, options)`), con `options.orgRole` de la ruta (`'ADMIN'` en el dashboard):

```
canOrg = r !== null && (options.orgRole === undefined || r === options.orgRole)
canPro = P || S
pedido 'org'  → canOrg ? 'org' : 403
pedido 'pro'  → canPro ? 'pro' : 403
sin pedido    → canOrg ? 'org' : (canPro ? 'pro' : 403)
```

403 = `{ code: 'forbidden', message: 'Forbidden' }` (el mismo cuerpo que un rol insuficiente). En pro,
`view.professionals` = los `Professional` activos; en org, `[]`.

**Matriz** (ruta común / ruta financiera con `orgRole: 'ADMIN'`):

| Vínculos en X | Pide `org` | Pide `pro` | Sin pedido |
|---|---|---|---|
| `ADMIN` | org / org | 403 / 403 | org / org |
| `MEMBER` | org / **403** | 403 / 403 | org / **403** |
| Solo `Professional` | **403** / 403 | pro / pro | pro / pro |
| `ADMIN` + `Professional` | org / org | pro / pro | org / org |
| `MEMBER` + `Professional` | org / **403** | pro / pro | org / **pro** |
| `ADMIN` de `SOLO_PRACTICE` sin ningún `Professional` | org / org | pro (lista vacía) / pro | org / org |
| `MEMBER` de X con `Professional` solo en otra organización Y | org / 403 | pro (solo lo propio de Y) / pro | org / pro |
| Ninguno | 403 `org-access-denied` del `OrgAccessGuard`, antes de este guard |

**403 y no degradación** (como pide la política): la UI siempre manda el modo de la pantalla que muestra. Degradar
mostraría, por ejemplo, el neto del profesional bajo el título "Retenciones estimadas" del dashboard de organización, o
un listado propio en una pantalla de recepción. El front evita los 403 previsibles con §4.10. La única "elección" del
servidor es el caso **sin pedido**, que es determinístico y nunca da más de lo que dan los vínculos.

**"En alguna de las organizaciones de su contexto"** (política, vista pro multi-organización): el diseño lo lee como
"alguna organización con la que el usuario tiene vínculo activo", y por eso `P` mira todos sus `Professional` y no solo
los de X. No reabre el aislamiento del 007:
- en pro **solo** se leen filas atadas a `Professional` propios (`userId = sub`, de la base), nunca ids del cliente;
- cada uno de esos `Professional` es, por definición del 005, un vínculo activo con su organización: la misma regla que
  `OrgAccessService.getAccess`;
- la diferencia con hoy es que se excluyen los `Professional` dados de baja (`deletedAt`), que hoy siguen sumando
  (Aclaración 4).

Ver Aclaración 2 para la alternativa estricta ("`Professional` en X").

### 4.3 Financieros de la organización: solo `ADMIN` (criterio 5)

| Ruta | Mecanismo | Por qué |
|---|---|---|
| `GET dashboard/kpis`, `chart`, `payers` | `@UsesViewMode({ orgRole: 'ADMIN' })` | La misma ruta sirve la vista org (financiera) y la pro (montos propios, legítima para un `MEMBER`+`Professional`). `@RequireOrgRole('ADMIN')` rompería el dashboard pro. El rol se exige solo cuando el modo efectivo es org |
| `GET settlements/calculate` | `@RequireOrgRole('ADMIN')` + `@UseGuards(OrgRoleGuard)` (patrón existente de `OrgController`) | No depende del modo: siempre son pagos de la organización a todos los profesionales |

- El rol sale de la base (`OrgAccessGuard`), nunca del token.
- El `MEMBER` conserva lo que usa para operar (`GET activity`, `GET v1/patients`, `POST activity` en org, ver §3): esas
  rutas llevan `@UsesViewMode()` sin `orgRole`.
- **Por qué metadata y no un chequeo en el servicio:** es declarativo, se verifica por metadata en el test de integración
  (como la sección (c) del 007) y no depende de que cada servicio lo recuerde.

### 4.4 Organización y pertenencia

- El modo **no** cambia qué organizaciones valida `OrgAccessGuard` ni el scope de `RequestContext.org`.
- En org, todo sigue filtrado por `primaryOrgId`.
- En pro, los filtros son `professionalId ∈ view.professionals` o participante (ya hoy), más los filtros de la query (que
  acotan: un `professionalId` ajeno da lista vacía, fila 31 del 007).

### 4.5 Listados y dashboard: el modo y los `Professional` salen de `ctx.view`

- **`FindAllActivitiesQueryHandler.execute(query, ctx)`:** `const view = requireViewScope(ctx)`. En pro,
  `proIds = professionalIdsOf(view)`; vacío → página vacía (igual que hoy). Se borra la consulta propia de
  `professional.findMany`. `netAmount`, `commission`, `role`, `isExternal` e `isReadOnly`, sin cambios.
- **Dashboard:** los handlers pasan `requireViewScope(ctx)` al servicio:
  - `getKpis(query, view)`;
  - `getChart(orgId, start, end, groupBy, view, basis)`;
  - `getPayerDistribution(orgId, start, end, view)`.

  Se mantienen `requireOrgId` y el `getKpis` con ceros sin organización. Fórmulas sin cambios.
- **Montos (criterio 7):** las fórmulas no se tocan. Solo cambia de dónde salen el modo y los `proIds`. Los tests de
  §8.1 se escriben **antes** del cambio con valores conocidos y tienen que seguir dando lo mismo.

### 4.6 Pacientes en modo pro (B14)

`FindAllPatientsQueryHandler.execute(query, ctx)` calcula y le pasa al servicio:
- `view` (modo y `Professional`);
- `includeCurrentOrg = roleIn(scope, X) !== null || view.professionals.some(p => p.organizationId === X && p.canLoadActivities)`.

`PatientsService.findAll(filter, view, { includeCurrentOrg })`:
- org: como hoy;
- pro: pacientes con atenciones de los `Professional` propios (como hoy), más los de X **solo si `includeCurrentOrg`**,
  más los de las prácticas `SOLO_PRACTICE` donde es miembro (como hoy).

**Por qué:** hoy un profesional externo sin `canLoadActivities` ve en modo pro **todos** los pacientes de la clínica de la
URL (nombre, email, teléfono y deuda). Con `canLoadActivities` necesita esa lista para cargar (puede cargar para
cualquier paciente de la organización, 007). Sin el permiso no puede cargar nada (403 en `POST /activity`), así que la
lista no le sirve para operar. El miembro y el profesional con permiso de carga no pierden nada. Ver Aclaración 5.

`IPatientService.findAll` cambia de firma (la implementa solo `PatientsService`).

### 4.7 `POST /activity`

- `CreateActivityCommandHandler`: `createActivity(dto, requireViewScope(ctx).mode, scope)`. `ActivityService` recibe
  `mode: ViewModeValue` y reemplaza `isProfessionalMode(mode)` por `mode === 'pro'`. El comportamiento de los dos modos
  queda igual (B16).
- **Regla nueva, en el paso 2 (antes de las lecturas):** si `mode === 'org'` y `roleIn(scope, T) === null` → 403 `forbidden`.
  T es la organización destino del body. El guard resolvió el modo contra X. Sin esta regla, un profesional sin membresía
  en T podría usar la rama org (valores del tipo de actividad, sin regla de primera carga) mandando un X donde sí es
  miembro.
- La excepción `S` mantiene el caso del 007 (`activity.service.spec.ts:344`): un `ADMIN` de su práctica `SOLO_PRACTICE` sin
  `Professional` carga en pro y el `Professional` se crea dentro de la transacción.
- Cambio de comportamiento intencional: el caso de `org-isolation.spec.ts` sección (e) "profesional con
  `canLoadActivities=true` carga con cualquier `x-mode`" pasa a **403 con `x-mode: org`** y 201 con `pro` o sin header
  (criterio 3). Ver Aclaración 6.

### 4.8 `settlements/calculate` (criterio 6)

- **Controlador:** `calculate(@Query() query, @CurrentOrgId() orgId)` con `query.organizationId = orgId`, más
  `@RequireOrgRole('ADMIN')` y `@UseGuards(OrgRoleGuard)`.
- **DTO:** `organizationId` pasa a `@IsOptional() @IsString()` con `@ApiHideProperty()`. Si el front lo sigue mandando, el
  guard lo valida como fuente y `OrgRoleGuard` exige `ADMIN` en él. El valor que usa el handler es siempre el del contexto.
- **Handler:** `const organizationId = requireOrgId(query.organizationId)`. Falla cerrado como el dashboard (007). Cálculo
  sin cambios.
- **`ID_FIELDS`:** `CalculateSettlementsQuery.organizationId: 'controller'` pasa a ser **verdad**, y un invariante nuevo lo
  vigila (§4.9).
- **`WHERE_ID_ALLOWLIST`:** la justificación de `calculate-settlements-query.ts` cambia a "el id es `@CurrentOrgId()` y la
  ruta exige ADMIN".
- `settlements-controller.ts` se suma a la lista de controladores que usan `@CurrentOrgId()`.

### 4.9 Invariantes estáticos (criterio 2 y 6)

En `security-invariants.spec.ts`. Reemplazan el del 007 sobre `x-mode`.

1. `x-mode` aparece solo en `infrastructure.bootstrap/guards/view-mode-guard.ts`, `cors-config.ts` (header permitido) y
   comentarios de `app.constants.ts` y `view-mode.ts` (lista blanca justificada, como `X_ORG_ID_ALLOWLIST`).
2. Ningún archivo de `api/`, `application/` ni `infrastructure/`:
   - contiene `@Query('mode')` ni `@Headers('x-mode')`;
   - lee `headers[...'x-mode']` ni `query[...'mode']`;
   - accede a `query.mode`, `command.mode`, `dto.mode`, `data.mode` ni `q.mode` (regex `\b(query|command|dto|data|q)\.mode\b`).

   Así no se confunde con el `mode: 'insensitive'` de Prisma.
3. Ninguna clase `implements IRequest` declara un campo `mode` (mismo escáner que `ID_FIELDS`). Tampoco
   `DashboardKpiQueryDto`, `CreateActivityDto` ni `FindAllPatientsFilter`.
4. `isProfessionalMode` solo aparece en `app.constants.ts` y `login-query-handler.ts`.
5. **Nuevo, cubre MENOR-1:** para cada entrada `controller` de `ID_FIELDS` cuya clase aparezca en un archivo de
   `api/controllers/`, ese archivo asigna el campo (`.<campo> =`). Las clases que no se despachan desde ningún controlador
   registrado (por ejemplo, las de `ReportingController`, 011) van en una lista blanca justificada que no acumula
   entradas obsoletas. Con este invariante, el MENOR-1 del 007 habría fallado.
6. Los controladores con `@CurrentOrgId()` incluyen `settlements-controller.ts`.

El conjunto exacto de rutas con `@UsesViewMode` (y su `orgRole`) se verifica por metadata en la integración (§8.1).

### 4.10 Frontend (criterio 8)

**El front sigue mandando el modo como preferencia.** No lo deja de mandar porque el usuario con los dos vínculos
necesita elegir la vista. El servidor decide.

1. **`services/data.ts`:**
   - F1 a F3 y F5 sin cambios de URL;
   - `createWorkItem` quita `mode` del body (`const { mode, ...body } = data`) y lo manda solo en `x-mode`;
   - `getFeeRules(slug, ctx?)` sin `mode` (F4); se ajustan `PacientesTable`, `AtencionesTable` y `PayerRulesManager`;
   - `calculateSettlements` sin `organizationId` en la query y sin los dos `getOrgDetails` (F6).
2. **`src/lib/view-mode.ts` (nuevo, puro, con `view-mode.test.mts`):**

   ```ts
   allowedViewModes({ orgRole, roles, professionalId }): ViewMode[]
   pickViewMode(current, allowed): ViewMode
   ```
   - `ORGANIZATION` se permite si `orgRole` es `ADMIN` o `MEMBER`, es decir, si el usuario tiene alguna membresía (es
     `null` solo sin membresías);
   - `PROFESSIONAL` se permite si `roles` incluye el código `PROFESSIONAL` o el token trae `professionalId`;
   - si la lista queda vacía, se devuelve la vista actual y decide el backend.
   - Constantes nuevas en `lib/constants.ts`: `VIEW_MODE`, `ORG_ROLE` y `APP_ROLE_CODE`.
3. **`Sidebar.tsx`:**
   - el selector "Ver como" ofrece solo `allowedViewModes`;
   - el auto-cambio usa `pickViewMode`, en lugar de "si hay un solo código". Así un profesional sin membresía con el store
     persistido en `ORGANIZATION` pasa a Pro y no recibe 403;
   - los enlaces `restricted` (Dashboard org, Liquidaciones y ajustes) se ocultan y redirigen para todo `orgRole` distinto
     de `ADMIN` (hoy solo para `MEMBER`), con el mismo destino.
4. **Mensaje ante 403:** `apiFetch` ya muestra el toast existente (`SESSION_MESSAGES.forbiddenAction`, un solo toast por
   `id`) en un GET con `forbidden`, y las funciones devuelven su valor por defecto. Dashboard y Liquidaciones quedan
   vacíos con el toast. No hay pantallas nuevas.
5. **`work-items/page.tsx`** (Server Component): dentro de `withServerSession`, un `ApiForbiddenError` con
   `orgDenied = false` devuelve `{ items: [], total: 0 }`. Hoy se relanzaría y rompería la página. Un 403 de organización
   sigue yendo a `/sin-acceso`.
6. **Sin cambio visible** más allá de ocultar opciones y menús: no hace falta UX/UI.

## 5. Aclaraciones para el PO

Conflictos entre la política y el uso real. El diseño toma la opción indicada por defecto. **Las 1, 2 y 5 conviene
confirmarlas antes del paso 5 del plan.**

1. **El `MEMBER` ve montos por atención de la organización** (no agregados):
   - el "Valor" de cada atención;
   - en el detalle, la **distribución** con los splits de la organización y de cada profesional;
   - la deuda por paciente;
   - en `work-items`, el "Neto Prof.".
   - **Opción A (por defecto):** se mantiene. Es lo que usa para cobrar y operar, y la política solo pide restringir los
     agregados.
   - **Opción B:** para quien no es `ADMIN`, el backend omite `commission`, `netAmount` y los splits en `GET activity` y
     `GET activity/:id` (el bruto se mantiene) y el front oculta esas filas. Es otro feature chico (cambia lo que ve
     recepción).
   - **Recomendación:** A ahora, y B al backlog si el PO quiere ocultar los honorarios a recepción.
2. **Vista pro: `Professional` activo en cualquier organización, más la excepción `SOLO_PRACTICE`** (§4.2). La política
   dice "`Professional` activo en la organización", y "en alguna de las organizaciones de su contexto" para la vista
   multi-organización.
   - La lectura estricta ("`Professional` en X") rompe dos casos reales:
     - el profesional independiente en su práctica antes de su primera carga, sin `Professional` en X: hoy ve su vista pro
       vacía y desde ahí carga;
     - un `MEMBER` de X que es profesional en otra clínica Y: `app/page.tsx` lo manda a `pro/atenciones` de X, y la UI no
       tiene selector de organización.
   - **Recomendación:** la regla del diseño. No muestra nada que no sea del propio usuario.
3. **403 y no degradación.**
   - Con el modo explícito no corresponde, el resultado es 403 con el toast existente.
   - El front evita los casos previsibles (§4.10, punto 3).
   - Quedan los usuarios de varias organizaciones: el `orgRole` del token es el de la primera membresía y puede no
     coincidir con la organización de la URL (punto 8).
   - **Alternativa:** degradar en silencio al modo permitido. Se descarta por los títulos y montos equivocados de §4.2.
4. **`Professional` dados de baja dejan de contar en la vista pro.** Hoy, a un usuario dado de baja como staff de una
   clínica (`deletedAt`, con `status` todavía `ACTIVE`) le siguen apareciendo en su vista pro las atenciones y montos de
   esa clínica.
   - El diseño usa `deletedAt: null`, como el 005, el 006 y el 007: la baja corta el acceso.
   - Para esos usuarios cambian los totales pro. Es la única excepción al criterio 7.
   - El tester cuenta por `SELECT` cuántas filas hay en esa situación.
   - **Alternativa:** mantener el criterio de hoy (solo `status`). Reabre lectura después de una baja.
5. **Pacientes en modo pro** (§4.6). Un profesional sin membresía y **sin** `canLoadActivities` deja de ver todos los
   pacientes de la clínica de la URL. Ve solo los que atendió. Es un cambio visible para ese perfil, y la base de
   desarrollo no tiene profesionales sin membresía (007).
   - **Alternativa:** dejarlo como hoy y anotarlo como residual.
   - **Recomendación:** el diseño (datos de salud de pacientes ajenos).
6. **`POST /activity` con `x-mode: org` de un profesional sin membresía en la organización destino:** pasa de 201 a 403.
   La UI solo manda `org` desde pantallas de miembro (Carga & Seguimiento de org).
7. **Lecturas por id de un profesional sin membresía.** `GET activity/:id`, `GET v1/patients/:id/summary` y `/debt` no
   dependen del modo. Siguen abiertas a cualquier vínculo dentro de la organización: el residual del 007 que se había
   asignado al 009, aunque no figura en sus criterios.
   - **Opción A (por defecto):** queda fuera de este feature y se registra en el backlog.
   - **Opción B:** incluirlo. Con `roleIn = null`, solo atenciones propias (profesional o participante) y pacientes que
     atendió, con 404 genérico. Son dos handlers más y sus tests.
8. **Rol del front por organización.** El front oculta menús con el `orgRole` del token, que es de la primera
   membresía. El backend es la autoridad (403 y toast).
   - Mostrar el rol de la organización de la URL requiere un dato nuevo del servidor (por ejemplo, el rol en `GET org`).
     Queda al backlog.
9. **`GET fee-rules`** filtra por la categoría del `Professional` del usuario en X también en la vista de organización (un
   `ADMIN` que además es profesional ve reglas filtradas en `org/pacientes`, que no tiene enlace en el menú). Es
   preexistente y no depende del modo: residual.
10. **Un `MEMBER` (no `ADMIN`) de una práctica `SOLO_PRACTICE` sin `Professional`** que pide `pro` recibe 403. Hoy, en la
    primera carga pro, se le crearía un `Professional` propio en la práctica de otro. La excepción `S` es solo para el
    `ADMIN`.
11. **`GET org/config`** (emails y CUIT del staff, porcentajes de categorías) sigue abierto a cualquier vínculo: INFO-1
    del 007, fuera de alcance.

## 6. Archivos

### Crear
| Archivo | Contenido |
|---|---|
| `backend/src/infrastructure.bootstrap/config/core/authentication/view-mode.ts` (+ `.spec.ts`) | `parseRequestedMode`, `resolveViewMode`, `ViewLinks`, `VIEW_MODE_ERROR_CODE` (§4.2) |
| `backend/src/infrastructure.bootstrap/config/core/authentication/view-mode-decorator.ts` | `VIEW_MODE_KEY`, `UsesViewMode(options?: { orgRole?: 'ADMIN' })` |
| `backend/src/infrastructure.bootstrap/guards/view-mode-guard.ts` (+ `.spec.ts`) | Guard de §4.1 |
| `backend/src/infrastructure/features/auth/services/org-access.service.spec.ts` | Forma de las consultas nuevas |
| `backend/src/application/features/activity/find-all-activities.spec.ts` | Montos con valores conocidos en org y pro, sin consulta propia de `Professional` |
| `backend/src/application/features/settlements/calculate-settlements.spec.ts` | `requireOrgId`, organización del contexto |
| `frontend/src/lib/view-mode.ts` (+ `view-mode.test.mts`) | §4.10, punto 2 |

### Modificar
| Archivo | Cambio |
|---|---|
| `backend/src/infrastructure.bootstrap/config/core/authentication/auth-context.ts` | `ViewModeValue`, `OwnProfessional`, `ViewAccessContext`, `AuthenticatedRequest.viewAccess?`; `AUTH_ERROR_CODE.INVALID_MODE` |
| `backend/src/infrastructure.bootstrap/config/core/cqrs/request-context.ts` (+ spec) | `ViewScope`, `RequestContext.view`, `requireViewScope`, `professionalIdsOf` |
| `backend/src/infrastructure.bootstrap/config/providers/guard-provider.ts` | `ViewModeGuardProvider` |
| `backend/src/infrastructure.bootstrap/modules/app-module.ts` | Registra el tercer `APP_GUARD` después de `OrgAccessGuardProvider` |
| `backend/src/infrastructure.bootstrap/guards/guard-chain.spec.ts` | Tres `APP_GUARD` en orden; stub con los métodos nuevos |
| `backend/src/infrastructure/features/auth/services/org-access.service.ts` | `getActiveProfessionals`, `getOrgType` |
| `backend/src/api/controllers/v1/activity/activity-controller.ts` | Sin `@Query('mode')` ni `@Headers('x-mode')`; `@UsesViewMode()` en `findAll` y `create` |
| `backend/src/api/controllers/v1/dashboard/dashboard-controller.ts` | `@UsesViewMode({ orgRole: 'ADMIN' })` en las tres; sin `userId` |
| `backend/src/api/controllers/v1/patients/patients-controller.ts` | Sin `@Query('mode')`; `@UsesViewMode()` en `findAll` |
| `backend/src/api/controllers/v1/settlements/settlements-controller.ts` | §4.8 |
| `backend/src/application/features/activity/queries/find-all-activities-query.ts` | Sin `mode`; §4.5 |
| `backend/src/application/features/activity/commands/create-activity-command.ts`, `Dtos/create-activity.dto.ts` | Sin `mode`; §4.7 |
| `backend/src/application/features/dashboard/queries/get-dashboard-{kpis,chart,payer-dist}-query.ts`, `Dtos/dashboard-kpi-query.dto.ts` | Sin `mode` ni `userId`; pasan `view` |
| `backend/src/infrastructure/features/dashboard/dashboard.service.ts` (+ spec) | Recibe `view`; sin `resolveProfessionalId` ni `resolveAllProfessionalIds` |
| `backend/src/application/features/patients/queries/find-all-patients-query.ts`, `domain/features/patients/find-all-patients-filter.ts`, `domain/features/patients/service/i-patient-service.ts`, `infrastructure/features/patients/patients.service.ts` | §4.6 |
| `backend/src/infrastructure/features/activity/activity.service.ts` (+ spec) | `mode: ViewModeValue`; regla org en T |
| `backend/src/application/features/settlements/queries/calculate-settlements-query.ts` | DTO opcional y `requireOrgId` |
| `backend/src/domain/constants/app.constants.ts` | Comentario: el modo efectivo sale de `ctx.view`; `isProfessionalMode` solo para el código de rol del login |
| `backend/src/security-invariants.spec.ts` | §4.9; `ID_FIELDS` sin `GetDashboard*.userId` |
| `backend/test/helpers/fake-prisma.ts` | Filtro de relación `some` para relaciones `many` declaradas (`workItem.participants`, `patient.workItems`); relaciones `patient.workItems` y `workItem.organization` |
| `backend/test/org-isolation.spec.ts` | Stub con los métodos nuevos derivados del seed; usuarios y datos de §8.1; sección (e) ajustada; secciones (j) a (m) |
| `frontend/src/services/data.ts` | §4.10, punto 1 |
| `frontend/src/services/api-routes.test.mts` | §8.2 |
| `frontend/src/lib/constants.ts` | `VIEW_MODE`, `ORG_ROLE`, `APP_ROLE_CODE` |
| `frontend/src/components/layout/Sidebar.tsx` | §4.10, punto 3 |
| `frontend/src/app/(dashboard)/[orgSlug]/work-items/page.tsx` | §4.10, punto 5 (después del commit del 008) |
| `frontend/src/components/domain/org/pacientes/PacientesTable.tsx`, `pro/atenciones/AtencionesTable.tsx`, `pro/settings/PayerRulesManager.tsx` | Llamada a `getFeeRules` sin modo |
| `frontend/package.json` | `test` suma `src/lib/view-mode.test.mts` |

### Eliminar
Nada. **Sin schema nuevo ni migración** (criterio 12): todo se resuelve con `OrganizationMember`, `Professional`
(`status`, `deletedAt`, `canLoadActivities`) y `Organization.type`.

## 7. Contratos, errores, rendimiento y compatibilidad

### 7.1 Errores
| Caso | Status | `code` |
|---|---|---|
| Modo con valor desconocido, repetido (arreglo), o header y query distintos | 400 | `invalid-mode` |
| Modo pedido que los vínculos no permiten; dashboard org sin `ADMIN`; sin pedido y ningún modo permitido | 403 | `forbidden` |
| `POST /activity` en org sin membresía en la organización destino | 403 | `forbidden` |
| `settlements/calculate` sin `ADMIN` | 403 | `forbidden` (`OrgRoleGuard`) |
| Ruta con `@UsesViewMode` sin `orgAccess` (no debería ocurrir: no son `@OrgOptional`) | 403 | `org-access-denied` |
| Handler que pide `requireViewScope` en una ruta sin el decorador | 403 | `forbidden` |

Cuerpos generados por `HttpFilter`, sin cambios en el filtro, y sin detalle de vínculos ni de la organización.

### 7.2 Cambios de contrato
- `GET dashboard/*` en org: 403 para `MEMBER` y profesionales (antes 200).
- `GET settlements/calculate`: 403 para quien no es `ADMIN`; acepta la query sin `organizationId` (antes 400).
- `GET activity`, `GET v1/patients` y `GET dashboard/*`: 403 con un modo no permitido (antes, datos de otro modo o
  vacíos); 400 con un valor inválido (antes se trataba como org).
- `POST /activity` con `x-mode: org` sin membresía en el destino: 403 (antes 201).
- `mode` en el body de `POST /activity` se ignora (antes lo pisaba el header).
- `GET v1/patients` en pro: menos filas para profesionales sin membresía ni permiso de carga (§4.6).
- Vista pro: sin `Professional` con `deletedAt` (Aclaración 4).
- Interno: `IPatientService.findAll`, `DashboardService.*`, `ActivityService.createActivity` y `RequestContext.view`.

### 7.3 Rendimiento
- **Org:** cero consultas nuevas (el rol ya viene de `orgAccess`).
- **Pro:** una consulta por request (`professional.findMany` por `userId`). Reemplaza la idéntica que ya hacía cada
  handler, así que el total por pantalla queda igual, y el dashboard sigue haciendo tres, una por request.
  - La tabla es chica y la consulta ya existía; no se agrega índice (criterio 12).
  - La excepción `SOLO_PRACTICE` suma una lectura por PK, solo para un `ADMIN` sin ningún `Professional`.
- Rutas sin `@UsesViewMode`: el guard solo lee metadata.

### 7.4 Compatibilidad
- Front y backend se despliegan juntos.
- Un front viejo sigue funcionando: los dos formatos de modo se aceptan y el `organizationId` de settlements es opcional.
- Tokens vigentes: sin cambios.
- `CORS` sin cambios.

## 8. Estrategia de tests

### 8.1 Backend (Jest; convenciones del 005 y 007: secreto armado en ejecución, sin `.env`, ids `randomUUID()`, correos `example.test`, ningún spec toca la base)

| Spec | Casos |
|---|---|
| `view-mode.spec.ts` | `parseRequestedMode`: ausentes (`undefined`, `null`, `''`, `'  '`); los cuatro valores válidos en mayúsculas y minúsculas; header y query iguales (ok) y distintos (400); arreglo en header o query (400); desconocido (400). `resolveViewMode`: **la matriz completa de §4.2** con `it.each`, los 7 perfiles × 3 pedidos × 2 tipos de ruta, más "ninguno" (403) |
| `view-mode-guard.spec.ts` | Sin metadata: `true` sin consultas y sin `viewAccess`. Con metadata: org de un miembro **sin** llamar a `getActiveProfessionals`; pro con una sola llamada; `getOrgType` solo en el caso `S`; 403 y 400 sin `viewAccess`; sin `orgAccess`: 403 `org-access-denied`; `orgRole: 'ADMIN'` con `MEMBER` en org: 403 |
| `request-context.spec.ts` (ampliado) | `view` congelado (también `professionals`); `requireViewScope(null)` da 403 `forbidden` |
| `org-access.service.spec.ts` | `where` exacto de `getActiveProfessionals` (`status: 'ACTIVE'`, `deletedAt: null`, `user: { deletedAt: null }`) y `select` mínimo |
| `find-all-activities.spec.ts` | **Montos conocidos** (escritos en el paso 1 contra el código actual, con `mode`, y adaptados al contexto en el paso 4 sin tocar las expectativas). Atención A1 de bruto 100 con splits `ORG` 30, `PROFESSIONAL` 50 (propio) y `PROFESSIONAL` 20 (otro): org `netAmount` 70 y `commission` 30; pro `netAmount` 50 y `role` del participante. `isExternal` en pro para la de otra organización. Pro con `professionals: []` da página vacía. Nunca llama a `professional.findMany` |
| `dashboard.service.spec.ts` (ampliado) | Valores conocidos de `getKpis` (`accruedGross`, `accruedNet` con split `ORG`, con remanente y sin splits; `pending`; `cashGross`; `cashNet`) en org y pro; `getChart` por día en los dos; `getPayerDistribution` en los dos. Escritos en el paso 1, mismas expectativas después. Los casos de falla cerrada existentes siguen |
| `patients-handlers.spec.ts` (ampliado) | `includeCurrentOrg`: miembro (true), profesional con permiso (true), sin permiso (false), con `Professional` con permiso solo en otra organización (false). El `where` en pro contiene o no `organizationId: X`. Sin `professional.findMany` |
| `activity.service.spec.ts` (ajustado) | Los casos del 007 con `mode` del contexto. Nuevo: org con T sin membresía da 403 **sin** escrituras ni `$transaction`. Se mantienen el `Professional` automático en `SOLO_PRACTICE` y el split privado en pro |
| `calculate-settlements.spec.ts` | Organización vacía: 403 sin consultas; usa la del query asignada por el controlador |
| `guard-chain.spec.ts` | `AppModule` registra **tres** `APP_GUARD` en orden: autenticación, pertenencia y modo |
| `security-invariants.spec.ts` | §4.9, puntos 1 a 6 |
| `test/org-isolation.spec.ts` (integración, `AppModule` real) | Ver abajo |

**Integración (`test/org-isolation.spec.ts`).** El stub de `OrgAccessService` gana `getActiveProfessionals` y `getOrgType`,
derivados del seed (`professional` y `organization`), para que la regla corra igual que con la base.

*Seed nuevo:* usuarios `adminPro` (`ADMIN` de A, con `Professional` en A), `memberPro` (`MEMBER` de A, con `Professional`
en A), `soloAdmin` (`ADMIN` de una organización C `SOLO_PRACTICE`, sin `Professional`) y `proDeleted` (con un
`Professional` en A con `deletedAt`). Además, splits con montos conocidos en atenciones de A y una atención de B donde
participa el `Professional` de `adminPro` en B (vista multi-organización).

- **(j) Matriz por HTTP.**
  - Para `GET activity`, `GET dashboard/kpis` y `GET v1/patients`, con `?mode=ORGANIZATION`, `?mode=PROFESSIONAL` y sin
    `mode`;
  - para `POST /activity`, con `x-mode` `org`, `pro` y sin header;
  - por usuario: `admin`, `member`, `pro`, `adminPro`, `memberPro`, `soloAdmin`;
  - **el status esperado sale de la misma tabla de §4.2** (el test la importa del spec unitario o la duplica con un
    comentario);
  - en todo 403, ningún espía de escritura de `fake-prisma` se llamó;
  - en todo 200 pro, la respuesta no contiene ids de atenciones ni pacientes ajenos al usuario (salvo los de A cuando
    `includeCurrentOrg`).
- **(k) Financieros por rol.**
  - `GET dashboard/{kpis,chart,payers}?mode=ORGANIZATION`: `admin` y `adminPro` 200 con los **valores conocidos**;
    `member`, `memberPro` y `pro` 403;
  - `GET settlements/calculate?month=...`: `admin` 200, `member` y `pro` 403;
  - sin `organizationId` en la query, `admin` 200;
  - con `organizationId` de B, 403 del guard.
- **(l) Estructural.**
  - El conjunto de rutas con `VIEW_MODE_KEY` es **exactamente** `get /api/activity`, `post /api/activity`,
    `get /api/dashboard/kpis`, `get /api/dashboard/chart`, `get /api/dashboard/payers` y `get /api/v1/patients`;
  - las tres de dashboard llevan `orgRole: 'ADMIN'`;
  - `settlements/calculate` tiene `REQUIRED_ORG_ROLE_KEY = 'ADMIN'`.
- **(m) Valores de modo.**
  - `?mode=xyz`, `?mode=a&mode=b`, y header `pro` con query `ORGANIZATION`: 400 `invalid-mode`;
  - `?mode=org` en `GET fee-rules` (ruta sin decorador): 200, se ignora.
- **(e) ajustada:** profesional con `canLoadActivities=true` y `x-mode: org` da 403; con `pro` o sin header, 201.
- **(d) sin cambios:** ownership con cualquier `x-mode` (PUT y DELETE no usan modo).
- **Vista pro multi-organización:** `adminPro` en pro con `x-org-id` A ve su atención de B (`isExternal: true`) y no las de
  B de otros. `proDeleted` en pro no ve las atenciones de su `Professional` dado de baja.

### 8.2 Frontend (`node --test`, sin dependencias)
- `src/lib/view-mode.test.mts`: `allowedViewModes` para:
  - `ADMIN` con los dos códigos;
  - `MEMBER` sin `PROFESSIONAL`;
  - sin membresía con `PROFESSIONAL`;
  - sin membresía y con `professionalId`;
  - sin datos.

  `pickViewMode` mantiene la vista actual si está permitida y si no elige la primera.
- `src/services/api-routes.test.mts` (ampliado):
  - `x-mode` solo aparece en `createWorkItem`;
  - `getFeeRules` no contiene `mode=`;
  - `calculateSettlements` no contiene `organizationId=`;
  - `createWorkItem` no manda `JSON.stringify(data)` con `mode` (manda el body sin él).
- `npm test` con los cinco archivos, `npx tsc --noEmit`, `npm run lint` sin errores nuevos en los archivos tocados y
  `npm run build`.

### 8.3 Plan del tester en vivo (criterio 11), sin escrituras

**Salvaguardas:**
- solo `SELECT` para ids y conteos;
- sin seeds, sin `down -v` y sin escrituras HTTP con ids reales;
- puertos 3000 y 3001 sin tocar;
- no se imprimen valores del `.env`, tokens, ids ni datos personales.

**Herramienta:** el script Node del 005 (§9.5 de su 03), que firma tokens HS256 en memoria con `iss`, `aud` y `exp` de 15
minutos, escribe solo "caso, esperado, obtenido, OK/FALLO" y totales numéricos, y se borra al terminar.

**Usuarios** (por `SELECT`):
- **A:** `ADMIN` de X;
- **M:** `MEMBER` de X;
- **P:** un usuario con `Professional` activo (miembro y profesional; la base no tiene profesionales sin membresía, 007).

Además, el conteo de `Professional` con `userId`, `status = 'ACTIVE'` y `deletedAt` no nulo (Aclaración 4).

**Captura previa (paso 0):** con el código de `main` corriendo en desarrollo, **antes** de que el desarrollador empiece el
paso 4 del plan, el tester o el desarrollador corre el script en modo lectura. Guarda en el scratchpad (fuera del repo)
**solo números**, para un rango de fechas fijo:
- los cinco KPIs, la suma de `gross` y `net` del chart y la suma de `value` de payers, de A en org;
- los mismos de P en pro;
- `total` y la suma de `grossAmount` y `netAmount` de la primera página de `GET activity` en los dos.

Si no se pudo capturar, se comparan `accruedGross`, `pending` y `cashGross` de A con agregados por `SELECT` sobre
`WorkItem` del mismo rango, y el resto queda cubierto por los tests de montos de Jest.

**Pasos:**
0. `git status`, conteos 9 / 3 / 72 / 324 / 1483 y la captura previa.
1. **ADMIN:**
   - A con `mode=ORGANIZATION` en `dashboard/kpis|chart|payers`: 200 y números **iguales** a la captura;
   - `settlements/calculate?month=<mes>` sin `organizationId`: 200;
   - `GET activity` y `GET v1/patients` en org: 200.
2. **MEMBER:**
   - M en `dashboard/*` con `mode=ORGANIZATION`: 403 `forbidden`;
   - `settlements/calculate`: 403;
   - `GET activity` y `GET v1/patients` en org: 200;
   - si M no tiene `Professional`, `GET activity?mode=PROFESSIONAL`: 403.
3. **Profesional:**
   - P con `mode=PROFESSIONAL` en `dashboard/*` y `GET activity`: 200 y números iguales a la captura (salvo lo explicado
     por la Aclaración 4, si el conteo dio más de 0 para P);
   - P sin modo: el que corresponde por §4.2.
4. **Valores inválidos:** `?mode=xyz` en `GET activity`: 400 `invalid-mode`.
5. **Escrituras:** ninguna con datos reales.
   - `POST /activity` con `x-mode: org` para un profesional sin membresía queda cubierto solo en Jest (no existe ese
     usuario).
   - Si se quiere una prueba HTTP de 403 sin escritura: M con `x-mode: pro` y sin `Professional`, body de forma válida y
     `patientId` al azar → 403 antes de cualquier lectura de ids.
6. **Navegador** (lectura, opción A o B del 005, sin guardar nada):
   - como A: el Dashboard org muestra los mismos números y Liquidaciones carga;
   - como M: el menú no muestra Dashboard ni Liquidaciones, y Carga & Seguimiento y Pacientes cargan;
   - como P en Pro: Dashboard y Carga & Seguimiento cargan;
   - si P tiene los dos vínculos, el selector ofrece las dos vistas.
7. `-Smoke` OK. Conteos finales iguales. `git status` solo con lo esperado. `git diff .claude/settings.json` sin cambios
   para el commit (regla 12).

## 9. Plan de implementación (pasos chicos)

Cada paso termina con `npx tsc --noEmit` y los specs del área en verde. Se empieza después del commit del 008.

1. **Tests de caracterización (sin cambiar código de producción):** `find-all-activities.spec.ts` y los casos de montos de
   `dashboard.service.spec.ts`, con valores conocidos contra el código actual (con `mode`). Línea base del criterio 7.
2. **Pieza pura:** `view-mode.ts` y su spec (matriz completa). Constantes y tipos en `auth-context.ts`.
3. **Contexto y guard:**
   - `OrgAccessService.getActiveProfessionals` y `getOrgType`, con su spec;
   - `view-mode-decorator.ts`, `view-mode-guard.ts` y su spec;
   - `RequestContext.view` y `requireViewScope`;
   - el tercer `APP_GUARD`, con `guard-chain.spec.ts`;
   - stubs de `org-isolation.spec.ts`.

   Ninguna ruta está marcada todavía, así que no hay cambio de comportamiento. *Antes del paso 4: captura previa del
   tester (§8.3, paso 0).*
4. **Listados de atenciones:** `@UsesViewMode()` en `GET activity`; el handler usa `ctx.view`; sin `@Query('mode')`. Los specs
   del paso 1 siguen iguales.
5. **Dashboard:** `@UsesViewMode({ orgRole: 'ADMIN' })` y servicio con `view`. *Aclaraciones 1 y 2.*
6. **Pacientes:** §4.6. *Aclaración 5.*
7. **Carga:** `POST /activity` con `@UsesViewMode()`; `createActivity(dto, mode, scope)` y la regla org en T; sin
   `@Headers('x-mode')`. Ajustar `activity.service.spec.ts` y la sección (e). *Aclaración 6.*
8. **Liquidaciones:** §4.8.
9. **Invariantes:** §4.9; `ID_FIELDS` y las listas blancas actualizadas.
10. **Integración:** `some` en `fake-prisma`, seed nuevo y secciones (j) a (m).
11. **Frontend:** constantes, `view-mode.ts` y su test, `data.ts`, Sidebar, `work-items/page.tsx`, llamadas a
    `getFeeRules`, `api-routes.test.mts` y `package.json`.
12. **Calidad (criterio 10):**
    - `tsc` en los dos proyectos;
    - `npx eslint` sobre los archivos tocados del backend (nunca `npm run lint` del backend);
    - `npm run lint` del front;
    - `npm test` en los dos;
    - `npm run build` del front.
13. **Documentador:**
    - BACKLOG #2 y #41 resueltos; anotar en el backlog las opciones B de las Aclaraciones 1 y 7 y los puntos 8 y 9, si el
      PO no los incluye;
    - RIESGOS (local): S3, M-2 e INFO-1;
    - `CLAUDE.md`: la convención "usar `isProfessionalMode()`" pasa a "el modo efectivo sale de `ctx.view`
      (`ViewModeGuard` y `@UsesViewMode`); `isProfessionalMode` solo para el código de rol del login";
    - `ARQUITECTURA.md`, líneas 96-97 y 200.

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| R-1. Choque con el commit en curso del 008 (`work-items/page.tsx`, `workload/*`) | Empezar después del commit. El 009 solo toca la página en el manejo del 403 |
| R-2. Romper la vista de recepción | El `MEMBER` no usa agregados (§3). Las rutas que usa quedan sin `orgRole`. Matriz (j) y navegador como M |
| R-3. Romper al profesional independiente (práctica propia sin `Professional` todavía) | Excepción `S` y su fila en la matriz; el caso del 007 (`activity.service.spec.ts:344`) se mantiene |
| R-4. Cambiar montos sin querer | Tests de caracterización escritos **antes** del cambio (paso 1) y captura previa en vivo. La única diferencia esperada es la de la Aclaración 4 |
| R-5. Una ruta que depende del modo queda sin decorador | `requireViewScope` falla cerrado (403) y el test estructural (l) fija el conjunto |
| R-6. Alguien vuelve a leer `x-mode` o `?mode=` en un handler | Invariantes 1 a 4 de §4.9 |
| R-7. `fake-prisma` con `some` da un falso verde | Los specs unitarios afirman el `where` exacto enviado a Prisma. `some` solo para relaciones declaradas; cualquier otro operador sigue lanzando |
| R-8. Toasts de 403 en usuarios de varias organizaciones | Previsto (Aclaración 8); el backend es la autoridad y el front mitiga con `allowedViewModes` |
| R-9. Pacientes en pro con menos filas para un perfil que la base de desarrollo no tiene | Jest con los cuatro perfiles de `includeCurrentOrg`; Aclaración 5 |
| R-10. El stub de `OrgAccessService` diverge de la consulta real | El stub deriva de las mismas columnas del seed (`status`, `deletedAt`) y `org-access.service.spec.ts` afirma el `where` real |

**Residuales para seguridad y el backlog:**
- Aclaraciones 1 (montos por atención para recepción), 7 (lecturas por id de profesionales sin membresía), 8 (rol del
  front por organización), 9 (`fee-rules` por categoría) y 11 (`org/config`).
- MEDIA-2 del 007 (`FIXED` sin acotar), en el 016.

## 11. Trazabilidad

| Criterio | Decisión |
|---|---|
| 1 Relevamiento | §2.1 (B1 a B22), §2.2 (F1 a F19), §3 |
| 2 Modo resuelto en el servidor | §4.1 (`ViewModeGuard` y `RequestContext.view`), §4.2, §4.9 |
| 3 `mode=org` sin membresía | §4.2 (matriz), §4.7 (regla org en T), §4.6; §8.1 (j) y (e) |
| 4 `mode=pro` sin `Professional` | §4.2 (403; excepción `S` justificada); Aclaraciones 2 y 10 |
| 5 Financieros solo `ADMIN` | §4.3; §8.1 (k) y (l) |
| 6 `settlements/calculate` | §4.8, §4.9 (punto 5) |
| 7 Montos coherentes | §4.5; §8.1 (paso 1 y valores conocidos); §8.3 (captura previa); Aclaración 4 |
| 8 Frontend | §4.10 |
| 9 Tests | §8.1 y §8.2 |
| 10 Calidad | §9, paso 12 |
| 11 Verificación en vivo | §8.3 |
| 12 Sin schema | §6 (sin migración) |

VEREDICTO: APROBADO
