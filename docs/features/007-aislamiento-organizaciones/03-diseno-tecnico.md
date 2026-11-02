# 03 — Diseño técnico: 007-aislamiento-organizaciones

> Autor: arquitecto. Entrada: `01-spec.md` (política del PO y 14 criterios), `.claude/CLAUDE.md`, el 03 y el 06 del
> feature 005 (§2, §3.1 a §3.6, §11 y M-2), el 09 del 006, `docs/auditoria/BACKLOG.md` (#3, #4, #5, #16, #28) y
> `docs/auditoria/RIESGOS.md` (local; S2, S3, S4 y M-2).
> Solo lectura: no se ejecutó `dev.ps1`, no se levantaron contenedores, no hubo SQL y no se modificó código. Del `.env`
> no se leyó nada. Se corrió `npx tsc --noEmit` en el backend como línea base: 0 errores.
>
> Regla para este documento y los siguientes del feature: sin tokens, secretos, URLs con credenciales ni datos reales.
> Los ids de los ejemplos son genéricos (`<idB>`), y las IPs, si hicieran falta, van en `192.0.2.x`.

## 1. Estado actual verificado

| Pieza | Hallazgo |
|---|---|
| Guards globales (005/006) | `AuthenticationGuard` verifica el JWT y deja `request.auth.userId`. `OrgAccessGuard` junta las organizaciones de cinco fuentes (header `x-org-id`, query `organizationId` y `orgId`, body `organizationId` y `orgId`), valida **todas** contra la base y deja `request.orgAccess = { organizationIds, roles }`. `OrgRoleGuard` exige el rol en **todas** esas organizaciones. No existe una "organización principal": los controladores vuelven a leer `@Headers('x-org-id')`. |
| CQRS | `Dispatcher` (por request, porque inyecta `REQUEST`) resuelve el handler y llama `handler.execute(request)`. Los handlers no reciben el contexto del request: solo lo que el controlador copió en el comando. |
| Operaciones por `:id` | Ningún handler filtra por organización: todos usan `findUnique({ where: { id } })`, `update({ where: { id } })` o `delete({ where: { id } })`. Un id de otra organización se lee o se modifica. Un id que no es UUID termina en 500 (error de Prisma). |
| Ids referenciados | `ActivityService.createActivity` hace `findUnique` de `activityTypeId` y `presetId` sin mirar la organización, y conecta `patientId`, `professionalId`, `payerId` y `participants[].professionalId` sin verificarlos. `AssignStaffCategory` y `CreateStaff` aceptan cualquier `categoryId`. `POST fee-rules` pasa el body (`Prisma.FeeRuleCreateInput`) casi tal cual a Prisma: un `payer: { create: { ..., organization: { connect: ... } } }` anidado podría crear un pagador en otra organización. |
| `canLoadActivities` | El backend **no** lo exige para crear. Solo lo usa en modo pro para eximir de la regla "la primera carga de un paciente la hace la organización" (`isActiveMember`). Un profesional sin el permiso hoy puede cargar atenciones de pacientes que ya atendió, o de cualquiera con `x-mode: org`. |
| Ownership | `update-activity-command` y `delete-activity-command` solo controlan al dueño si `x-mode` es `PROFESSIONAL` o `pro`. **El frontend nunca manda `x-mode` en `PUT` ni en `DELETE`** (solo en `POST /activity`), así que hoy nadie pasa por ese control. `createdByUserId = null` queda libre para todos. La regla "no se borra una atención cobrada con fecha de pago" sí se aplica siempre. |
| Respuesta del listado | `GET /activity` **no** devuelve `createdByUserId`. El front de modo pro (`pro/atenciones/columns.tsx`) calcula `isOwner = !createdByUserId || createdByUserId === currentUserId`, así que hoy muestra editar y borrar en todas las filas no externas. |
| `ConfigController` | Sin `@RequireOrgRole`. Sus bodies no se validan (tipos literales, no DTO). `dictionaries`, `org-rules` (GET y PUT) y `pro-rules` despachan requests cuyos handlers no están registrados (500). El front usa `POST/PUT/DELETE config/categories` y `GET/POST/PUT/DELETE config/activity-types`. |
| `OrgController` | Todas sus escrituras ya exigen `ADMIN` (desde el 005, rol de la base). `POST org/categories` valida el body con `CreateCategoryCommand`, cuyo `orgId` es `@IsString()` **obligatorio**: el body del front (`{ name, percentage }`) daría 400 si se migra sin ajustar el DTO. `lookupStaffByCuit` usa `PrismaService` en el controlador. |
| Pacientes | `UpdatePatientCommandHandler` no tiene `@RequestHandler` ni `@Injectable`: `PUT v1/patients/:id` hoy responde 500 ("Handler not found"). El front lo llama desde Gestión de Pacientes. `MergePatientCommand` hace dos escrituras sin transacción, no exige que los dos pacientes sean de la misma organización y no impide fusionar un paciente consigo mismo (lo borraría). |
| Staff | `DeleteStaffCommand` con usuario vinculado da de baja al **`User` global** (`deletedAt`). Desde el 006 eso le quita el login y el acceso a **todas** sus organizaciones, aunque el `ADMIN` que borra solo administra una. |
| Tipos de actividad | `ActivityType.organizationId` admite `null` (defaults del sistema). La lista (`GetActivityTypesQuery`) solo devuelve los de la organización, pero `PUT/DELETE org/activity-types/:id` hoy dejan a cualquier `ADMIN` editar o borrar un default. `DELETE` cuenta los usos **antes** de cualquier control y lo informa en el mensaje (revela datos de otra organización). |
| Lookups por CUIT | `GET org/staff/lookup` devuelve id y nombre de una `Organization` de cualquier tenant, o id, nombre, email y teléfono de un `Professional` de cualquier tenant. `GET pro/payers/lookup` devuelve id y nombre de cualquier `Organization`. `GET system/professionals` devuelve filas completas de `Professional` de todas las organizaciones (CUIT, email, teléfono, `userId`). **Ninguno de los tres lo usa el frontend.** `CreatePayerCommand` rechaza un CUIT de organización registrada con un mensaje que incluye el **nombre** de esa organización. |
| Rutas muertas | `GET settlements`, `GET settlements/:id/details` y todo `fee-engine/professional-categories` despachan handlers no registrados (500) y el front no los usa. |
| Transacciones | `createActivity` escribe hasta cinco tablas (pagador por defecto, `Professional` en `SOLO_PRACTICE`, `WorkItem`, participantes y splits) sin `$transaction`. `FeeResolutionService.calculateSplits` solo lee, pero lee el pagador y el profesional, que pueden haberse creado en el mismo request. |
| Modo pro en el front | `x-org-id` es la organización de la URL. En modo pro, la lista de pacientes y la de atenciones son **cross-org** (pacientes y atenciones de otras organizaciones del profesional). `WorkItemForm` manda `organizationId = patientOrganizationId` en el body: el guard valida las dos. Los pagadores propios, presets y tipos de actividad del formulario salen de la organización de la URL. `pro/deudores` no tiene enlace en el menú y opera sobre atenciones de cualquier organización del profesional. |
| Roles en la UI | Un `MEMBER` entra a `org/admisiones` ("Carga & Seguimiento") y desde ahí edita, borra y marca cobros de **cualquier** atención de la organización. Solo `liquidaciones`, `settings/categories` y `settings/general` están ocultos para `MEMBER`. En modo pro, "Reglas de Honorarios" (`PayerRulesManager`) crea pagadores propios y **reglas de honorarios** (`POST fee-rules`) con cualquier rol. |
| Tests | Jest con 13 suites (`src/**` y `test/**`). `test/all-routes-auth.spec.ts` ya arranca el `AppModule` real con Prisma mockeado y recorre todas las rutas por metadata: es la base del test estructural. `src/security-invariants.spec.ts` hace los chequeos estáticos. El front tiene `node --test` sobre `src/lib/session.test.mts`. |

## 2. Relevamiento completo (criterio 1)

Prefijo `/api`. "Scope" es el conjunto de organizaciones validadas por `OrgAccessGuard` para ese request (§3.1). "404"
es siempre el cuerpo genérico de §3.3. Todas las rutas, salvo `login`, `health` y las dos `@OrgOptional`, ya exigen JWT y
vínculo activo con cada organización indicada (005/006); eso no cambia.

### 2.1 Id en la ruta

| # | Endpoint | Entidad | Organización del recurso | Hoy | Después | Rol | Respuesta |
|---|---|---|---|---|---|---|---|
| 1 | `GET activity/:id` | `WorkItem` | Directa (`organizationId`) | Devuelve la atención de cualquier organización. Inexistente: 404 con texto propio. No UUID: 500 | `findFirst({ id, organizationId ∈ scope })` | Cualquier vínculo | 200 / 404 |
| 2 | `PUT activity/:id` | `WorkItem` | Directa | Actualiza cualquiera. Ownership solo con `x-mode` pro, que el front no manda | 404 si no está en el scope; después, ownership de §3.5 sin `x-mode` | §3.5 | 200 / 403 `forbidden` / 404 |
| 3 | `DELETE activity/:id` | `WorkItem` | Directa | Borra cualquiera. Inexistente: 200 con `null` | 404; ownership de §3.5; regla de cobrada con fecha (403, sin cambios) | §3.5 | 200 / 403 / 404 |
| 4 | `GET v1/patients/:id/debt` | `Patient` | Directa | Suma la deuda de cualquier paciente (sin uso en el front) | Paciente en el scope antes de calcular | Cualquier vínculo | 200 / 404 |
| 5 | `GET v1/patients/:id/summary` | `Patient` | Directa | Lista los ítems pendientes de cualquier paciente | Paciente en el scope | Cualquier vínculo | 200 / 404 |
| 6 | `PUT v1/patients/:id` | `Patient` | Directa | **500** (handler sin registrar) | Se registra el handler; paciente en el scope antes de escribir | Cualquier vínculo (como el resto de pacientes) | 200 / 404 |
| 7 | `POST v1/patients/:id/merge` (+ `targetId` del body) | `Patient` × 2 | Directa | Fusiona cualquier par, incluso de organizaciones distintas, sin transacción | Origen y destino en el scope **y en la misma organización**; iguales: 400; las dos escrituras en `$transaction` | Cualquier vínculo (la UI lo ofrece solo en modo organización) | 200 / 400 / 404 |
| 8 | `PUT org/categories/:id` | `ProfessionalCategory` | Directa | Actualiza la de cualquier organización | Categoría en el scope | `ADMIN` | 200 / 403 / 404 |
| 9 | `DELETE org/categories/:id` | `ProfessionalCategory` | Directa | Borra cualquiera | Ídem | `ADMIN` | 200 / 403 / 404 |
| 10 | `PUT org/presets/:id`, `DELETE org/presets/:id` | `FeePreset` | Directa | Cualquiera | Ídem | `ADMIN` | 200 / 403 / 404 |
| 11 | `PUT org/staff/:id` | `Professional` | Directa | Cualquiera | Ídem | `ADMIN` | 200 / 403 / 404 |
| 12 | `DELETE org/staff/:id` | `Professional` (+ `User`, `OrganizationMember`) | Directa | Cualquiera; da de baja al `User` global | Profesional en el scope; el `User` se da de baja solo si no le quedan otros vínculos activos (§3.8) | `ADMIN` | 200 / 403 / 404 |
| 13 | `PUT org/staff/:id/category` (+ `categoryId`) | `Professional` + `ProfessionalCategory` | Directa los dos | Cualquier par | Profesional en el scope; categoría de **la misma organización que el profesional** | `ADMIN` | 200 / 403 / 404 |
| 14 | `PUT org/activity-types/:id`, `DELETE org/activity-types/:id` | `ActivityType` | Directa, `null` = default del sistema | Cualquiera, incluidos los defaults. `DELETE` revela el conteo de usos | En el scope (un default con `null` da 404); el conteo, después del control | `ADMIN` | 200 / 400 / 403 / 404 |
| 15 | `PUT/DELETE config/categories/:id`, `PUT/DELETE config/activity-types/:id` | Las mismas | Directa | Sin `ADMIN` ni pertenencia | **Se eliminan** (el front migra a `org/*`, §3.7) | — | 404 de Nest |
| 16 | `PUT pro/payers/:id`, `DELETE pro/payers/:id` | `Payer` | Directa; dueño por `Payer.professionalId → Professional.userId` | Cualquiera (sin uso en el front) | En el scope; después, `ADMIN` o dueño del pagador (§3.6) | §3.6 | 200 / 403 / 404 |
| 17 | `GET settlements/:id/details` | `Settlement` | Directa | 500 (handler sin registrar) | **Se elimina** la ruta (y `GET settlements`) | — | 404 de Nest |
| 18 | `DELETE fee-engine/professional-categories/:id` | `ProfessionalCategory` | Directa | 500 (handlers sin registrar) | **Se elimina** el controlador (duplica `org/categories`) | — | 404 de Nest |

### 2.2 Ids en el body o la query (criterio 4)

| # | Endpoint | Campo | Entidad | Hoy | Después | Respuesta si no pertenece |
|---|---|---|---|---|---|---|
| 19 | `POST activity` | `organizationId` (body) | `Organization` | Manda sobre el header; el guard lo valida | Es la **organización destino** T. Se exige que esté en el scope (ya lo garantiza el guard; el handler lo reafirma) | 403 `org-access-denied` |
| 20 | `POST activity` | `patientId` | `Patient` | Sin verificar | Paciente de T. `''` cuenta como ausente (hoy crea la atención sin paciente) | 404 |
| 21 | `POST activity` | `professionalId` | `Professional` | Sin verificar | Profesional de T. Si el usuario solo tiene vínculo de profesional, tiene que ser **el suyo** (§3.4) | 404 / 403 |
| 22 | `POST activity` | `participants[].professionalId` | `Professional` | Sin verificar | Cada uno, profesional de T | 404 |
| 23 | `POST activity` | `activityTypeId` | `ActivityType` | `findUnique` sin organización: valores y roles de otra | De T (los defaults con `null` no se aceptan: la UI nunca los ofrece) | 404 |
| 24 | `POST activity` | `presetId` | `FeePreset` | `findUnique` sin organización: valor de otra | De T | 404 |
| 25 | `POST activity` | `payerId` | `Payer` | Sin verificar | De T. `''` o `null`: pagador por defecto de T, como hoy | 404 |
| 26 | `POST org/staff` | `categoryId` | `ProfessionalCategory` | Sin verificar | De la organización del request; `''` cuenta como ausente | 404 |
| 27 | `POST org/staff` | `email` | `User` (global) | Vincula por email a cualquier usuario no dado de baja | Sin cambios: es el vínculo de un profesional existente que define el alta de staff; ya exige `ADMIN` (ver §3.9 y residuales) | — |
| 28 | `POST fee-rules` | `payer.connect.id` o `payerId` | `Payer` | Sin verificar; body casi sin filtrar | Pagador de la organización del request; el `data` de Prisma se arma con lista blanca (§3.6) | 404 |
| 29 | `POST org/categories`, `org/presets`, `org/activity-types`, `v1/patients`, `pro/payers` | `orgId` / `organizationId` del body | `Organization` | El guard los valida; el controlador los pisa con el header | Sin cambios | 403 del guard |
| 30 | `GET activity` | `organizationId` (query) | `Organization` | El guard lo valida | Sin cambios | 403 del guard |
| 31 | `GET activity` | `patientId`, `professionalId`, `payerId` (query) | — | Filtros sobre un `where` ya acotado (la organización, o en modo pro los `Professional` propios) | Sin cambios: un id ajeno da una lista vacía, no expone nada | — |
| 32 | `GET settlements/calculate` | `organizationId` (query) | `Organization` | El guard lo valida | Sin cambios | 403 del guard |
| 33 | `GET org/config` | `orgId` (query) | `Organization` | El guard lo valida; el handler usa el header | Sin cambios | 403 del guard |
| 34 | `PUT org`, `GET org` | (header) | `Organization` | Id = header validado | Sin cambios | 403 del guard |
| 35 | `GET dashboard/*`, `GET v1/patients`, `GET/POST fee-rules` (lista), `GET pro/payers`, `GET pro/context`, `PUT pro/profile`, `GET pro/memberships` | — | — | Filtran por la organización validada y por `sub` | Sin cambios (qué datos muestra el modo pro: feature 009) | — |

### 2.3 Lookups por CUIT y rutas de configuración restantes (criterio 9)

| # | Endpoint | Hoy | Después |
|---|---|---|---|
| 36 | `GET org/staff/lookup?cuit=` | `ADMIN`. Busca en **todas** las organizaciones: devuelve una `Organization` (id, nombre) o un `Professional` (id, nombre, email, teléfono, `hasUser`) | `ADMIN`. Solo `Professional` no eliminados **de la organización del request**. Respuesta mínima `{ type: 'PROFESSIONAL', id, name, hasUser }` o `{ type: 'NOT_FOUND' }`. Pasa a un query handler CQRS (BACKLOG 28) |
| 37 | `GET pro/payers/lookup?cuit=` | Devuelve id y nombre de cualquier `Organization` | **Se elimina** (sin uso; ver §3.9) |
| 38 | `GET system/professionals?cuit=` | Filas completas de `Professional` de todas las organizaciones | **Se elimina** junto con `SystemController` y `SearchProfessionalsQuery` (sin uso; duplica el 36) |
| 39 | `POST pro/payers` (CUIT en el body) | Si el CUIT es de una organización registrada, el error trae su nombre | Mismo rechazo, mensaje sin nombre (§3.9) |
| 40 | `GET config/dictionaries`, `GET/PUT config/org-rules`, `GET config/pro-rules`, `GET/POST config/*` | 500 o duplicados de `org/*` | **Se eliminan** con todo `ConfigController` (§3.7) |

Fuera del relevamiento por estar fuera de alcance: `ProductionController` y `ReportingController` (no registrados, feature
011) y `PUT profile` (`ProfileController`, mock sin handler registrado y sin ids).

## 3. Decisiones

### 3.1 Contexto del request para los handlers (sin volver a leer headers)

**`OrgAccessContext` gana `primaryOrgId`** (`config/core/authentication/auth-context.ts` y `org-access-guard.ts`):
- es el `x-org-id` normalizado si vino; si no, la primera fuente presente en el orden actual del guard (query
  `organizationId`, query `orgId`, body `organizationId`, body `orgId`);
- siempre pertenece a `organizationIds`. El resto del guard no cambia.

**El `Dispatcher` pasa el contexto a cada handler** (archivo nuevo `config/core/cqrs/request-context.ts`):

```ts
export interface OrgScope {
  readonly userId: string;
  readonly primaryOrgId: string;
  readonly orgIds: readonly string[];                       // todas las validadas por OrgAccessGuard
  readonly roles: Readonly<Record<string, OrgRoleValue | null>>; // null = solo vínculo de Professional
}
export interface RequestContext {
  readonly userId: string | null;
  readonly org: OrgScope | null;   // null en rutas @Public o @OrgOptional sin organización
}
export function buildRequestContext(req: AuthenticatedRequest | undefined): RequestContext; // congela el objeto
export function requireOrgScope(ctx: RequestContext | undefined): OrgScope; // si falta: 403 org-access-denied
export function roleIn(scope: OrgScope, orgId: string): OrgRoleValue | null;
```

- `IRequestHandler.execute(command, context: RequestContext)`. Los handlers que no lo usan siguen compilando (un método
  con menos parámetros es compatible en TypeScript).
- `Dispatcher.dispatch`: `handler.execute(request, buildRequestContext(this.request as AuthenticatedRequest))`. El
  `Dispatcher` ya es por request (inyecta `REQUEST`) y se ejecuta después de los guards, así que `request.orgAccess` ya
  está.
- Los handlers que este feature toca toman la organización y el usuario **solo** de `requireOrgScope(ctx)`, nunca de
  `command.orgId`, `command.userId` ni de headers.

**Por qué así y no copiando el scope en el comando** (como hoy se hace con `userId`): los comandos se arman con
`@Body()`, y sin `whitelist` (BACKLOG 12) un body con `"scope": {...}` llegaría al handler si un controlador se olvida
de pisarlo: falla abierto. Con el contexto en el `Dispatcher` falla cerrado (`requireOrgScope` lanza 403) y no hay
código repetido en los controladores.

**Alternativas descartadas:**
- *Handlers con `@Inject(REQUEST)`:* los vuelve request-scoped de forma implícita y esconde la dependencia.
- *Un `@CurrentOrg()` en cada controlador:* el mismo riesgo de "olvidarse de asignar" y más superficie.

### 3.2 Helper común de pertenencia (criterios 2 a 4)

Archivo nuevo `config/core/authentication/org-resource.ts`, junto a `auth-context.ts`:

```ts
export const resourceNotFound = () =>
  new NotFoundException({ code: AUTH_ERROR_CODE.NOT_FOUND, message: 'Not Found' });
export const forbiddenAction = () =>
  new ForbiddenException({ code: AUTH_ERROR_CODE.FORBIDDEN, message: 'Forbidden' });

/** Id obligatorio: string UUID (trim + minúsculas) o 404 sin consultar la base. */
export function requireId(value: unknown): string;
/** Id opcional referenciado: undefined, null o '' → null; si no, como requireId. */
export function optionalId(value: unknown): string | null;
/** Fragmento de where para Prisma. */
export const inScope = (scope: OrgScope) => ({ organizationId: { in: [...scope.orgIds] } });
export const inOrg = (orgId: string) => ({ organizationId: orgId });
/** Espera la consulta y lanza el 404 genérico si devolvió null. */
export async function foundOr404<T>(query: Promise<T | null>): Promise<T>;
```

`AUTH_ERROR_CODE` suma `NOT_FOUND: 'not-found'`.

**Uso desde un handler:**

```ts
async execute(command: UpdateCategoryCommand, ctx: RequestContext) {
  const scope = requireOrgScope(ctx);
  const id = requireId(command.id);
  await foundOr404(this.prisma.professionalCategory.findFirst({ where: { id, ...inScope(scope) }, select: { id: true } }));
  return this.prisma.professionalCategory.update({ where: { id }, data: { ... } });
}
```

**Reglas:**
1. **Scope o una organización concreta.** Un recurso operado por id tiene que estar en `inScope(scope)`. Un id
   referenciado al crear o editar tiene que estar en **la organización del recurso principal** (`inOrg(T)`): la
   organización destino de la atención, la del profesional al asignar categoría, la del origen en el merge.
2. **Verificar antes de escribir.** Toda verificación va antes de la primera escritura. Una sola escritura después de
   la verificación queda fuera de transacción: ningún endpoint cambia el `organizationId` de un recurso, así que no hay
   carrera que lo saque del scope. Dos o más escrituras van en `prisma.$transaction` (§3.4, §3.8, regla 5).
3. **Rol para decidir permisos** = `roleIn(scope, recurso.organizationId)`, no el de la organización principal.

**Por qué el scope y no solo `primaryOrgId`:** el guard ya validó cada organización del request, y el usuario podría
mandar cualquiera de ellas en `x-org-id`. Aceptar el conjunto no da más acceso que eso, y evita romper el modo pro, donde
el front edita una atención mandando `organizationId` de la atención en el body.

**Alternativa descartada:** `assertBelongsToOrg(entityName, id, orgId)` genérico con `prisma[entityName]`. Pierde el tipado
de Prisma, obliga a mapear entidades sin `organizationId` y agrega una consulta aparte. El `findFirst` con
`inScope(...)` reemplaza la consulta que el handler ya hacía.

### 3.3 Respuesta: 404 genérico (criterios 2 a 4)

- **Cuerpo** (lo arma `HttpFilter` sin cambios): `{ code: 'not-found', details: "<JSON de la excepción>", errors: [{
  message: 'Not Found' }] }`. Es idéntico para "no existe", "es de otra organización", "es un default del sistema" e "id
  que no es UUID". No incluye el id ni el nombre de la entidad.
- **Tiempo:** los dos primeros casos hacen la misma consulta indexada (PK más filtro), así que no hay diferencia medible.
  El id mal formado responde sin consultar, pero eso solo revela el formato.
- **404 y no 403:** el 403 se reserva para lo que el usuario puede saber que existe: rol insuficiente o ownership
  dentro de su organización (`forbidden`), y organización sin vínculo (`org-access-denied`, 005).
- **Ids referenciados (criterio 4):** también 404 genérico, sin escritura. Un solo código y un solo cuerpo es más simple
  de probar, y no distingue "existe en otra organización".
- Se reemplazan los textos propios que hoy filtran detalles: `'Activity not found'`, `` `Source patient ${id} not found` ``,
  `'Professional not found'` (este último hoy es un `Error`, 500).

### 3.4 `POST /activity`: `canLoadActivities`, ids referenciados y transacción (criterios 4 y 7)

**Comportamiento de hoy:** ver §1. El backend no exige `canLoadActivities`, solo lo usa para eximir de la regla de
primera carga en modo pro.

**Regla nueva** (confirma la política sin ampliar permisos). T = `optionalId(command.organizationId) ?? scope.primaryOrgId`
y `r = roleIn(scope, T)`:

| Vínculo en T | Puede cargar | Profesional de la atención |
|---|---|---|
| `ADMIN` o `MEMBER` | Sí, como hoy | Cualquiera de T (o el propio, por la resolución actual en modo pro) |
| Solo `Professional` (`r = null`) | Solo si su `Professional` en T tiene `canLoadActivities = true` (si no, 403 `forbidden`) | **Solo el propio:** si `professionalId` viene y no es el suyo, 403. Si no viene, se usa el suyo sin importar `x-mode` |

- **No depende de `x-mode`.** El modo sigue decidiendo cómo se calculan los montos (fuera de alcance, 009), pero no da
  permisos.
- **Participantes:** tienen que ser profesionales de T (404 si no). Un profesional solo puede sumar colegas de T como
  co-participantes, como hace hoy el formulario con roles. Ver Aclaraciones, punto 6.
- **Regla de primera carga:** queda igual. Con la regla nueva solo puede alcanzar a miembros en modo pro cuyo
  `Professional` no tenga el permiso.

**Orden en `ActivityService.createActivity(dto, mode, scope)`:**
1. T en `scope.orgIds` (si no, 403 `org-access-denied`; el guard ya lo garantiza).
2. Permiso de carga: `canLoadActivities` (403). Va primero porque no depende de ningún id y así el tester puede
   probarlo en vivo con ids inexistentes (§9.5).
3. **Fase de lecturas, sin escrituras:** `org` de T; `activityTypeId`, `presetId`, `payerId`, `patientId`, `professionalId`
   y cada participante con `findFirst({ where: { id, ...inOrg(T) } })` → 404 si falta. `''` y `null` cuentan como
   ausentes (compatibilidad: el formulario manda `presetId: ''` y `payerId: null`).
4. Profesional propio (403) y regla de primera carga (sin cambios).
5. **Fase de escrituras** en `this.prisma.$transaction(async (tx) => { ... })`: pagador por defecto (buscar o crear),
   `Professional` automático en `SOLO_PRACTICE`, `WorkItem`, honorarios y `createMany` de participantes, splits y su
   `createMany`. Todo con `tx`.
6. `FeeResolutionService.calculateSplits(context, db = this.prisma)` y `calculateParticipantFee(..., db)` reciben un
   cliente opcional para leer dentro de la transacción. Así ven el pagador o el profesional recién creados. Es un
   parámetro opcional: los demás usos no cambian.

**Respuesta del listado:** `FindAllActivitiesQuery` agrega `createdByUserId` a cada ítem (aditivo). Con eso la lógica
`isOwner` que el front de modo pro ya tiene deshabilita editar y borrar en las atenciones de otros, en lugar de mostrar
el botón y recibir un 403.

### 3.5 Ownership de `PUT` y `DELETE activity/:id`, sin `x-mode` (criterio 8)

Una función pura, `canModifyActivity(item, scope)` en `application/features/activity/activity-ownership.ts`, la usan los
dos handlers:

```
item = findFirst({ id, ...inScope(scope) }, select { organizationId, createdByUserId, paymentStatus, paymentDate,
                                                     professional: { select: { userId } } })   → 404
r = roleIn(scope, item.organizationId)
r === 'ADMIN'                      → permitido
item.createdByUserId !== null      → permitido si item.createdByUserId === scope.userId
item.createdByUserId === null      → permitido si item.professional.userId === scope.userId
otro caso                          → 403 forbidden
DELETE además: PAID con paymentDate → 403 (mensaje actual, sin cambios)
```

- `UpdateActivityCommand` y `DeleteActivityCommand` pierden `mode` y `userId`. `ActivityController.update` y `delete` dejan de
  leer `x-mode`. Un test estático (§9.1) impide que vuelvan `isProfessionalMode` o `x-mode` a esos archivos.
- **Orden:** 404, después ownership (403) y después la regla de cobrada. Así quien no es dueño no se entera del estado de
  pago (aunque lo ve en la lista).
- **El conflicto con el uso real** (un `MEMBER` que hoy cobra o edita atenciones de otros) está en Aclaraciones, punto 1.
  La función aísla la regla: si el PO elige la variante B, cambia solo esa función y sus tests.

### 3.6 Pagadores y reglas de honorarios

- **`PUT` y `DELETE pro/payers/:id`:** el pagador tiene que estar en el scope (404). Después, permitido si `roleIn = ADMIN` o
  si `payer.professionalId` apunta a un `Professional` con `userId = sub`. Si no, 403. Un pagador de la organización
  (`professionalId = null`, `isManagedBySystem`) solo lo modifica un `ADMIN`.
- **`POST pro/payers`:** igual que hoy, si el usuario tiene `Professional` en la organización (se agrega `deletedAt: null`
  a esa búsqueda) se crea como pagador propio. Si no lo tiene, el pagador sería de la organización: exige `ADMIN` (403).
  Ver Aclaraciones, punto 5.
- **`POST fee-rules`:**
  - DTO explícito `CreateFeeRuleDto`: `name`, `payerId?`, `payer?: { connect?: { id } }` (forma que manda el front),
    `professionalCategory?`, `serviceType?`, `conditionProfessionalRole?`, `splits`, `validFrom?` y `validTo?`;
  - el handler arma el `data` de Prisma con esos campos, más `organization: { connect: { id: scope.primaryOrgId } }`.
    Cualquier otra clave del body (`payer.create`, `organization`, etc.) se ignora;
  - el pagador referenciado tiene que ser de la organización (404);
  - **permiso:** `ADMIN`, o un usuario que crea la regla **para un pagador propio** (`payer.professionalId` es su
    `Professional`). Sin pagador, o con un pagador ajeno, un no `ADMIN` recibe 403. Ver Aclaraciones, punto 4.

### 3.7 `ConfigController`: se migra el frontend a `org/*` y se elimina (criterios 5, 6 y 10)

**Decisión:** borrar `ConfigController` completo y migrar las siete llamadas del front a `OrgController`.

**Por qué:**
- `org/*` ya tiene las mismas operaciones, con `ADMIN` y DTOs validados. Protegerlo duplicaría guards, tests y la
  verificación por id en dos lugares;
- sus otras rutas (`dictionaries`, `org-rules` y `pro-rules`) responden 500 (handlers sin registrar) y nadie las usa;
- el riesgo de "romper la UI" se cubre con un test de contrato: Jest manda los bodies exactos del front a `org/*` (§9.1).

| Front (`services/data.ts`) | Hoy | Después |
|---|---|---|
| `createCategory` | `POST config/categories` | `POST org/categories` |
| `updateCategory` | `PUT config/categories/:id` | `PUT org/categories/:id` |
| `deleteCategory` | `DELETE config/categories/:id` | `DELETE org/categories/:id` |
| `getActivityTypes` | `GET config/activity-types?orgId=<slug>` | `GET org/activity-types` (sin query: usa el header) |
| `createActivityType` | `POST config/activity-types` | `POST org/activity-types` |
| `updateActivityType` | `PUT config/activity-types/:id` | `PUT org/activity-types/:id` |
| `deleteActivityType` | `DELETE config/activity-types/:id` | `DELETE org/activity-types/:id` |

**Ajustes necesarios:**
- `CreateCategoryCommand.orgId` pasa a `@IsOptional()`, como en presets y staff. Si no, el body del front daría 400;
- los handlers de categorías y tipos de actividad usan `requireOrgScope(ctx).primaryOrgId` al crear y `inScope` al editar o
  borrar.

**Se eliminan:**
- `api/controllers/v1/config/config-controller.ts` y su registro en `config-module.ts`;
- `application/features/config/queries/config-general-queries.ts` (solo lo usaba ese controlador; sus handlers ni
  siquiera estaban registrados).

**Lecturas de configuración** (`GET org`, `GET org/config` y `GET org/activity-types`): siguen abiertas a cualquier
vínculo activo, como hoy y como pide la política.

**Alternativa descartada:** agregar `@RequireOrgRole('ADMIN')` y la verificación por id a `ConfigController`. Mantiene
dos rutas para lo mismo, duplica tests y deja vivas tres rutas que responden 500.

### 3.8 Pacientes, staff y configuración: detalle por handler

| Handler | Cambio |
|---|---|
| `FindActivityByIdQueryHandler` | `findFirst` con `inScope`; 404 genérico |
| `GetDebtQueryHandler`, `GetPatientSummaryQueryHandler` | `foundOr404(patient.findFirst({ id, ...inScope }))` antes de calcular |
| `UpdatePatientCommandHandler` | Se agregan `@RequestHandler(UpdatePatientCommand)` e `@Injectable()` (hoy da 500); paciente en el scope antes de `patientService.update`. Ver Aclaraciones, punto 7 |
| `MergePatientCommandHandler` | `requireId` en origen y destino; iguales: `BadRequestException`; los dos en el scope y con el mismo `organizationId` (si no, 404); `updateMany` y `delete` en `$transaction` |
| Categorías, presets y tipos de actividad (update y delete) | `foundOr404(findFirst({ id, ...inScope }))` y después la escritura. `DeleteActivityType` cuenta los usos después del control |
| Create de categoría, preset y tipo de actividad | Organización = `scope.primaryOrgId` |
| `UpdateStaff`, `AssignStaffCategory` | Profesional en el scope; la categoría, con `inOrg(profesional.organizationId)` |
| `CreateStaff` | `categoryId` con `optionalId` y `inOrg(primaryOrgId)`. Cambiar el `Error` del CUIT duplicado queda para el 013 |
| `DeleteStaff` | Profesional en el scope (404 en lugar del `Error` 500). En la rama con usuario, dentro de la transacción que ya existe: se da de baja el `Professional`, se borra la membresía **de esta organización** y el `User` solo se da de baja si no tiene otros `Professional` con `deletedAt = null` ni membresías en otras organizaciones. Ver Aclaraciones, punto 8 |
| `LookupStaffByCuitQuery` (nuevo) | Reemplaza la lógica del controlador (§2.3, fila 36) |

### 3.9 Lookups por CUIT: qué necesita el alta de staff (criterio 9)

- El alta de staff del front (`org/profesionales` y `ProfessionalManager`) **no llama a ningún lookup**. Vincula al
  usuario por **email** dentro de `CreateStaffCommand`, que ya exige `ADMIN`. No hace falta buscar fuera de la
  organización por CUIT, así que no hay excepción cross-org.
- `org/staff/lookup` se conserva **acotado a la organización** (sirve para avisar "ese CUIT ya está en tu staff") con la
  respuesta mínima de §2.3.
- `pro/payers/lookup` y `system/professionals` se eliminan: no tienen uso, y la pregunta que responden ("¿este CUIT es
  de alguna organización o profesional del sistema?") es cross-org por definición. Ver Aclaraciones, punto 9.
- `CreatePayerCommand` sigue rechazando un CUIT de organización registrada (evita suplantar a una clínica como pagador),
  con el mensaje "Ese CUIT pertenece a una organización registrada: la asociación se gestiona con ella directamente.",
  sin el nombre. Queda un oráculo de un bit (si el CUIT está registrado). Ver residuales.

### 3.10 Frontend (criterio 10)

- `services/data.ts`: las siete URLs de §3.7.
- `createWorkItem`: hoy muestra `errors[0].message` del backend. Con un 404 mostraría "Not Found", así que en ese caso usa
  el texto existente, "Error al guardar la actividad". Las demás funciones ya muestran su texto fijo o su valor por
  defecto ante cualquier status que no sea ok (verificado en `data.ts`).
- `WorkItemForm`: en modo pro, si `patientOrganizationId` existe y es distinto de `orgSlug`, el payload no lleva
  `activityTypeId` ni `presetId`. Salen de la configuración de la organización de la URL y el backend los rechazaría.
  `serviceType` se mantiene. El cambio no es visible. Ver Aclaraciones, punto 3.
- Los 403 nuevos (`canLoadActivities`, ownership, pagadores y reglas) ya los maneja `apiFetch`: toast de UX 3.4 y
  `isHandledApiError`. No hay pantallas nuevas.
- No se toca `pro/deudores` (Aclaraciones, punto 10).

## 4. Aclaraciones para el PO

Conflictos entre la política y el uso real, con la decisión que toma el diseño. **Los puntos 1 y 2 conviene que el PO los
confirme antes del paso 4 del plan** (§7). Si no hay respuesta, se implementa la política tal cual (opción A).

1. **`MEMBER` editando, cobrando o borrando atenciones de otros.**
   - Hoy un `MEMBER` (recepción) entra por defecto a "Carga & Seguimiento" y desde ahí edita, marca cobros, registra
     asistencia y borra **cualquier** atención de su organización.
   - La política le permite solo las suyas (`createdByUserId = sub`). Las de `createdByUserId = null`, probablemente la
     mayoría de los datos cargados por seeds antes de abril de 2026, quedan solo para `ADMIN` o el profesional dueño.
   - **Opción A** (política literal, por defecto): el `MEMBER` recibe 403 y ve el toast existente.
   - **Opción B:** el `MEMBER` puede actualizar datos de cobro y asistencia (`paymentStatus`, `paymentMethod`,
     `paymentDate`, `attendance`) de cualquier atención de su organización. Cambiar la fecha y borrar siguen la regla de
     ownership.
   - B cambia solo `canModifyActivity` y sus tests.
2. **Profesional sin `canLoadActivities`** que hoy carga atenciones de pacientes que ya atendió (regla de primera carga en
   modo pro, o con `x-mode: org`): pasa a 403, como pide la política (criterio 7). Es intencional, pero cambia un camino
   que el backend permitía a propósito.
3. **Modo pro con paciente de otra organización.** Cuando la organización de la URL es la práctica propia y el paciente es
   de una clínica, la atención se crea en la clínica (organización del paciente). Hoy:
   - el formulario puede mandar un tipo de actividad o un preset de la práctica propia. El diseño los omite en el front,
     sin cambio visible;
   - el desplegable de pagadores sigue ofreciendo los **pagadores propios de la práctica**. Elegir uno ahora da 404 ("Error
     al guardar la actividad"), porque un pagador de una organización no puede quedar en una atención de otra.
   - Si el PO prefiere que no aparezcan, ocultarlos es un cambio visible chico en `WorkItemForm` (igual que ya se ocultan
     los pagadores de organización en ese caso).
4. **Reglas de honorarios en modo pro.** La política pide `ADMIN` para "reglas", pero "Reglas de Honorarios" del modo pro
   crea reglas para los pagadores propios del profesional, con cualquier rol. Diseño: `ADMIN`, o el dueño del pagador
   para su pagador. Es menos que hoy (cualquiera creaba cualquier regla) y no rompe esa pantalla. Si el PO quiere
   `ADMIN` estricto, esa pantalla deja de guardar para los profesionales.
5. **`POST pro/payers` sin `Professional`** (un `MEMBER` en modo pro): crearía un pagador de la organización, así que
   ahora exige `ADMIN`. No se encontró un flujo real que lo use.
6. **Participantes:** un profesional sin membresía puede cargar solo a su propio `Professional` como profesional de la
   atención, pero puede sumar colegas de la misma organización como participantes (co-admisor, etc.), como hace hoy el
   formulario con roles. Si el PO quiere prohibirlo, es una línea más.
7. **`PUT v1/patients/:id` hoy no funciona** (500). Se registra el handler: editar pacientes de la organización pasa a
   funcionar. En modo pro, editar un paciente de **otra** organización da 404.
8. **Baja de staff:** se deja de dar de baja al `User` global si tiene otros vínculos activos. Hoy un `ADMIN` de la
   organización A le quita a esa persona el acceso a la B y a su práctica propia. Para un usuario con un solo vínculo, el
   resultado es el del 006.
9. **Se eliminan endpoints sin uso:**
   - `system/professionals`, `pro/payers/lookup` y todo `config/*`;
   - `GET settlements` y `settlements/:id/details`;
   - `fee-engine/professional-categories`.

   Si el PO prefiere conservar `system/professionals`, la alternativa es acotarlo igual que `org/staff/lookup`.
10. **`pro/deudores`** no tiene enlace en el menú. Sus acciones sobre atenciones de **otras** organizaciones (cobrar,
    borrar, ver resumen del paciente) pasan a 404 con el mensaje existente. Arreglarlo requiere que el listado informe la
    organización de cada ítem y que la página la mande: queda para el 009.
11. **Defaults del sistema** (`ActivityType` con `organizationId = null`): ningún `ADMIN` puede editarlos ni borrarlos
    (404). La UI nunca los mostró.

## 5. Archivos

### Crear
| Archivo | Contenido |
|---|---|
| `backend/src/infrastructure.bootstrap/config/core/cqrs/request-context.ts` (+ `.spec.ts`) | `RequestContext`, `OrgScope`, `buildRequestContext`, `requireOrgScope`, `roleIn` (§3.1) |
| `backend/src/infrastructure.bootstrap/config/core/authentication/org-resource.ts` (+ `.spec.ts`) | `resourceNotFound`, `forbiddenAction`, `requireId`, `optionalId`, `inScope`, `inOrg`, `foundOr404` (§3.2) |
| `backend/src/infrastructure.bootstrap/config/core/cqrs/dispatcher.spec.ts` | El handler recibe el contexto armado del request |
| `backend/src/application/features/activity/activity-ownership.ts` | `canModifyActivity` (§3.5) |
| `backend/src/application/features/activity/activity-handlers.spec.ts` | Find, update y delete (§9.1) |
| `backend/src/infrastructure/features/activity/activity.service.spec.ts` | `createActivity` (§9.1) |
| `backend/src/application/features/patients/patients-handlers.spec.ts` | Debt, summary, update y merge |
| `backend/src/application/features/config/config-handlers.spec.ts` | Categorías, presets, staff, tipos de actividad, pagadores y lookup |
| `backend/src/application/features/fee-engine/fee-rule-commands.spec.ts` | `POST fee-rules` |
| `backend/src/application/features/config/queries/lookup-staff-by-cuit-query.ts` | Query y handler del lookup acotado |
| `backend/test/helpers/fake-prisma.ts` | Prisma en memoria para el test de integración: tablas por modelo, `where` simple (`id`, `organizationId` igual o `in`, `userId`, `deletedAt`), espías en toda escritura y `$transaction(fn)` |
| `backend/test/org-isolation.spec.ts` | Integración con el `AppModule` real y el test estructural (§9.1) |
| `frontend/src/services/api-routes.test.mts` | `node:test` estático sobre `data.ts` (§9.2) |

### Modificar
| Archivo | Cambio |
|---|---|
| `backend/src/infrastructure.bootstrap/config/core/authentication/auth-context.ts` | `primaryOrgId` en `OrgAccessContext`; `AUTH_ERROR_CODE.NOT_FOUND` |
| `backend/src/infrastructure.bootstrap/guards/org-access-guard.ts` (+ spec) | Calcula `primaryOrgId` |
| `backend/src/infrastructure.bootstrap/config/core/cqrs/dispatcher.ts` | Pasa el contexto |
| `backend/src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler.ts` | Segundo parámetro `context` |
| `backend/src/api/controllers/v1/activity/activity-controller.ts` | `update` y `delete` sin `x-mode` ni `userId` |
| `backend/src/application/features/activity/commands/{create,update,delete}-activity-command.ts` | §3.4 y §3.5 |
| `backend/src/application/features/activity/queries/find-activity-by-id-query.ts` | Scope y 404 genérico |
| `backend/src/application/features/activity/queries/find-all-activities-query.ts` | `createdByUserId` en los ítems |
| `backend/src/infrastructure/features/activity/activity.service.ts` | Recibe el scope, verificaciones, transacción (§3.4) |
| `backend/src/infrastructure/features/fee-engine/fee-resolution.service.ts` | Cliente `db` opcional en `calculateSplits` |
| `backend/src/application/features/patients/commands/{update,merge}-patient-command.ts`, `queries/{get-debt,get-patient-summary}-query.ts` | §3.8 |
| `backend/src/application/features/config/commands/{category,preset,staff,activity-type,payer}-commands.ts` | §3.6 y §3.8; `CreateCategoryCommand.orgId` opcional; mensaje del CUIT |
| `backend/src/application/features/fee-engine/commands/fee-rule-commands.ts` | DTO y lista blanca (§3.6) |
| `backend/src/api/controllers/v1/config/org-controller.ts` | El lookup despacha la query; sin `PrismaService` |
| `backend/src/api/controllers/v1/config/pro-controller.ts` | Sin `payers/lookup` |
| `backend/src/api/controllers/v1/fee-engine/fee-rules-controller.ts` | `@Body() CreateFeeRuleDto` |
| `backend/src/api/controllers/v1/settlements/settlements-controller.ts` | Queda solo `calculate` |
| `backend/src/infrastructure.bootstrap/config/config-module.ts` | Sin `ConfigController` ni `SystemController`; registra `LookupStaffByCuitQueryHandler` |
| `backend/src/infrastructure.bootstrap/modules/features/patients/patients-module.ts` | Sin cambios de providers (`UpdatePatientCommandHandler` ya está; faltaba el decorador) |
| `backend/src/infrastructure.bootstrap/modules/features/fee-engine/fee-engine-module.ts` | Sin `ProfessionalCategoryController` |
| `backend/src/security-invariants.spec.ts` | Invariantes nuevos (§9.1) |
| `frontend/src/services/data.ts` | URLs de §3.7 y el 404 de `createWorkItem` |
| `frontend/src/components/domain/workload/form/WorkItemForm.tsx` | Omite `activityTypeId` y `presetId` en el caso cross-org (§3.10) |
| `frontend/package.json` | `test` corre también `src/services/api-routes.test.mts` |

### Eliminar
- `backend/src/api/controllers/v1/config/config-controller.ts`
- `backend/src/application/features/config/queries/config-general-queries.ts`
- `backend/src/api/controllers/v1/config/system-controller.ts`
- `backend/src/application/features/config/queries/search-professionals-query.ts`
- `backend/src/api/controllers/v1/fee-engine/professional-category-controller.ts`
- `backend/src/application/features/fee-engine/commands/professional-category-commands.ts`
- `backend/src/application/features/settlements/queries/settlement-queries.ts`

Sin schema nuevo ni migración (criterio 14): todo se resuelve con las columnas `organizationId` existentes y la relación
`WorkItem.professional`.

## 6. Contratos, errores, rendimiento y compatibilidad

### 6.1 Errores

| Caso | Status | `code` |
|---|---|---|
| Recurso por id inexistente, de otra organización, default del sistema o id que no es UUID | 404 | `not-found` |
| Id referenciado (body o query) que no es de la organización que corresponde | 404 | `not-found` |
| Merge de un paciente consigo mismo | 400 | `unhandled-exception` (sin cambios en el filtro; 013) |
| Rol insuficiente (`@RequireOrgRole`, pagadores, reglas) u ownership | 403 | `forbidden` |
| `canLoadActivities = false`, o un profesional cargando a otro `Professional` | 403 | `forbidden` |
| Atención cobrada con fecha de pago | 403 | `unhandled-exception` (mensaje actual) |
| Organización sin vínculo o ausente (005) | 403 | `org-access-denied` |

### 6.2 Cambios de contrato
- **Rutas eliminadas** (pasan a 404 de Nest): `config/*`, `system/professionals`, `pro/payers/lookup`, `GET settlements`,
  `GET settlements/:id/details` y `fee-engine/professional-categories/*`.
- **`org/staff/lookup`:** ya no devuelve `type: 'ORGANIZATION'`, `email` ni `phone`.
- **`GET activity`:** suma `createdByUserId` por ítem.
- **`POST org/categories`:** acepta el body sin `orgId`.
- **`PUT v1/patients/:id`:** pasa de 500 a 200 o 404.
- **`DELETE activity/:id` inexistente:** pasa de 200 con `null` a 404.
- **`PUT activity/:id` inexistente:** pasa de 500 a 404.
- **`IRequestHandler.execute`:** segundo parámetro (interno).

### 6.3 Rendimiento
- Por id: la consulta de verificación reemplaza el `findUnique` existente o agrega una por PK más filtro (menos de 1 ms
  en local).
- `createActivity`: suma unas tres lecturas por PK (paciente, profesional y pagador) y un `BEGIN/COMMIT`. Es despreciable
  frente a las consultas del motor de honorarios.
- Ninguna consulta nueva sin índice: todas filtran por PK.

### 6.4 Compatibilidad
- Front y backend se despliegan juntos: las siete llamadas a `config/*` se migran en el mismo cambio.
- Tokens vigentes: siguen sirviendo.

## 7. Plan de implementación (pasos chicos)

Cada paso termina con `npx tsc --noEmit` y los specs del área en verde.

1. **Contexto:** `primaryOrgId` en el guard, `request-context.ts`, `Dispatcher` y la firma de `IRequestHandler`, con sus
   specs. No hay cambio de comportamiento.
2. **Helper:** `org-resource.ts` y `AUTH_ERROR_CODE.NOT_FOUND`, con sus specs.
3. **Lecturas por id:** `activity/:id`, `patients/:id/debt` y `summary`, con specs. Línea base para el tester.
4. **Atenciones, update y delete:** `canModifyActivity` y los controladores sin `x-mode`. *Antes de este paso, respuesta
   del PO a Aclaraciones 1 (si no hay, opción A).*
5. **Crear atención:** scope, `canLoadActivities`, ids referenciados, transacción y `db` en `FeeResolutionService`.
   `createdByUserId` en el listado. *Aclaraciones 2, 3 y 6.*
6. **Pacientes:** registrar `UpdatePatient`, scope y merge con transacción.
7. **Configuración de la organización:** categorías, presets, staff (incluida la baja del `User`) y tipos de actividad;
   `CreateCategoryCommand.orgId` opcional; lookup a CQRS.
8. **Pagadores y reglas de honorarios.** *Aclaraciones 4 y 5.*
9. **Eliminaciones y front:**
   - borrar `ConfigController`, `SystemController`, `pro/payers/lookup`, las rutas muertas de settlements y
     `ProfessionalCategoryController`;
   - migrar `data.ts`, el 404 de `createWorkItem` y el ajuste de `WorkItemForm`.
10. **Integración y estructura:** `fake-prisma.ts`, `org-isolation.spec.ts`, `security-invariants` ampliado y el
    `node:test` del front.
11. **Calidad:**
    - `tsc` en los dos proyectos;
    - `npx eslint` sobre los archivos tocados del backend (nunca `npm run lint` del backend);
    - `npm run lint` del front;
    - `npm test` en los dos;
    - `npm run build` del front.
12. **Documentador:**
    - BACKLOG #3, #4 y #5 resueltos; #16 parcial (createActivity y merge) y #28 parcial (lookup);
    - RIESGOS (local): S2, S3 y S4 y M-2;
    - la regla 4 de `CLAUDE.md` menciona `requireOrgScope` y `foundOr404`.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un `MEMBER` o un profesional pierde acciones que hoy usa (Aclaraciones 1, 2 y 4) | Se informa al PO antes del paso 4. La regla está aislada en una función |
| Romper la UI de configuración al migrar a `org/*` | Test de contrato con los bodies exactos del front (§9.1), `orgId` opcional y verificación del tester por lectura en el navegador |
| Un handler nuevo por id sin verificación | Test estructural que enumera las rutas con parámetros (§9.1) e invariante estático de acceso por id |
| El contexto del `Dispatcher` llega vacío si alguien lo vuelve singleton | `dispatcher.spec.ts`, y el test de integración falla en todas las filas con "403 en lugar de 200" |
| Una transacción interactiva de `createActivity` vence (5 s por defecto) | Las lecturas del motor dentro de la transacción son pocas y por índice. Si se observa, se sube `timeout` en esa llamada |
| `fake-prisma` no reproduce un `where` real y el test da un falso verde | Los specs unitarios por handler afirman el `where` exacto enviado a Prisma (`organizationId: { in: [...] }`) |
| Perder un caso de modo pro cross-org | Aclaraciones 3 y 10. El tester recorre el modo pro con un profesional real (lectura) |
| `''` en ids opcionales | `optionalId` lo trata como ausente, como el código actual |
| Fusión entre organizaciones de un usuario con dos vínculos | Se exige el mismo `organizationId` en origen y destino |
| Un `ADMIN` que se borra a sí mismo como staff queda sin acceso | Preexistente, y con la regla nueva solo si no tiene otros vínculos. Se anota como residual |

**Residuales para seguridad y el backlog** (fuera de la política del 007):
- dentro de su organización, un profesional puede leer por id cualquier atención y el resumen de cualquier paciente
  (009);
- `settlements/calculate` y el dashboard en modo organización están abiertos a `MEMBER` y profesionales: la UI solo oculta
  el menú;
- `org/config` devuelve emails y CUIT del staff a cualquier vínculo;
- `CreateStaff` revela si un email tiene cuenta (devuelve `userId`);
- queda el oráculo de un bit del CUIT de organización en `POST pro/payers`;
- `x-mode` sigue decidiendo cómo se calculan los montos y el split privado en `SOLO_PRACTICE` (009);
- `UpdateOrganization` acepta `settings` arbitrario (014);
- el merge de pacientes está abierto a profesionales sin membresía (la UI lo ofrece solo en modo organización).

## 9. Estrategia de tests

### 9.1 Backend (Jest, criterio 11)

Convenciones del 005:
- secreto ficticio armado en ejecución;
- `ConfigModule` sin `.env`;
- `PrismaService` mockeado o `fake-prisma`;
- ids con `randomUUID()`;
- ningún spec toca la base.

| Spec | Casos |
|---|---|
| `request-context.spec.ts` | Contexto con y sin `orgAccess`; `requireOrgScope` sin organización da 403 `org-access-denied`; objeto congelado; `roleIn` |
| `org-resource.spec.ts` | `requireId`: no UUID, no string y mayúsculas (normaliza); `optionalId('')` da `null`; `foundOr404(null)` da 404 con `{ code: 'not-found', message: 'Not Found' }`; cuerpos idénticos |
| `org-access-guard.spec.ts` (ampliado) | `primaryOrgId`: header; sin header, query `organizationId`; solo body `orgId`; normalizado |
| `dispatcher.spec.ts` | El handler recibe `(command, ctx)` con `userId` y scope del request |
| `activity-handlers.spec.ts` | **Find:** propia (200), otra organización (404, `where` con `organizationId: { in }`), inexistente (mismo cuerpo), no UUID (sin llamar a Prisma). **Update y delete**, matriz completa: `ADMIN` con atención ajena (ok); `MEMBER` propia (ok); `MEMBER` ajena (403); profesional propia (ok); profesional ajena (403); `null` con el dueño del `Professional` (ok); `null` con otro usuario (403); otra organización (404). Ningún caso 403 o 404 llama a `update` ni a `delete`. Delete cobrada con fecha: 403 |
| `activity.service.spec.ts` | `ADMIN` y `MEMBER` crean (ok). Profesional con `canLoadActivities` en `true` (ok) y en `false` (403, **ninguna** escritura ni `$transaction`). Profesional con `professionalId` de otro (403). Cada id referenciado de otra organización: `patientId`, `professionalId`, participante, `activityTypeId`, `presetId` y `payerId` dan 404 sin escrituras. `''` como ausente. Las escrituras corren dentro de `$transaction` con `tx` (espía), y `calculateSplits` recibe `tx` |
| `patients-handlers.spec.ts` | Debt y summary: propio y ajeno. Update: propio y ajeno (sin `update`). Merge: destino ajeno (404, sin escrituras), los dos de organizaciones distintas del scope (404), iguales (400), legítimo (`$transaction` con `updateMany` y `delete`) |
| `config-handlers.spec.ts` | Por cada update y delete de categoría, preset, staff y tipo de actividad: propio y ajeno (sin escritura). Default del sistema: 404. `DeleteActivityType` ajeno no cuenta usos. `AssignStaffCategory` con categoría de otra organización: 404. `CreateStaff` con `categoryId` ajeno: 404; con `''`: `null`. `DeleteStaff`: `User` con otro vínculo no se da de baja; sin otros vínculos, sí. Pagadores: matriz `ADMIN`/dueño/otro y sistema/propio; `POST` sin `Professional` y sin `ADMIN`: 403. Lookup: solo la organización, sin `email` ni `phone`. Mensaje del CUIT sin nombre |
| `fee-rule-commands.spec.ts` | Pagador ajeno: 404. No `ADMIN` con pagador propio: ok. No `ADMIN` con pagador ajeno o sin pagador: 403. Un body con `payer.create` y `organization.connect` a otra organización: el `data` enviado a Prisma no los contiene |
| `test/org-isolation.spec.ts` (integración; `AppModule` real, `PrismaService` → `fake-prisma`, `OrgAccessService` → stub con roles por usuario y organización) | (a) **Estructural:** se enumeran por metadata todas las rutas del `AppModule` cuyo path tiene un parámetro. El conjunto tiene que ser **igual** a las claves de la tabla `ID_ROUTE_CASES` del spec; una ruta nueva con `:param` hace fallar el test hasta que se agregue con su caso. (b) Por cada fila: usuario de A con recurso de B da 404 con el cuerpo genérico, y ningún espía de escritura de `fake-prisma` se llamó; un id inexistente da el mismo cuerpo, byte a byte; caso legítimo: 2xx. (c) **Rol:** toda ruta no GET de `OrgController` declara `@RequireOrgRole('ADMIN')` (metadata), y con `ADMIN` da 2xx, con `MEMBER` 403 y con profesional sin membresía 403, sin escrituras. (d) **Ownership por HTTP** con `x-mode: org`, `x-mode: pro` y sin header: mismo resultado en cada caso de la matriz. (e) **`canLoadActivities`** por HTTP. (f) Rutas eliminadas: 404. (g) **Contrato del front:** `POST org/categories` con `{ name, percentage }` y `POST/PUT org/activity-types` con el payload de `ActivityTypesManager` dan 2xx como `ADMIN` |
| `security-invariants.spec.ts` (ampliado) | No existen `config-controller.ts`, `system-controller.ts` ni `professional-category-controller.ts`. `@Headers('x-mode')` solo aparece en `activity-controller.ts`, una vez (en `create`). `update-` y `delete-activity-command.ts` no contienen `isProfessionalMode` ni `mode`. Todo archivo de `application/features` o `infrastructure/features` que acceda a un modelo con tenant por `where: { id` importa `org-resource` o está en una lista blanca justificada en el spec (por ejemplo, `fee-resolution.service.ts`, que lee ids ya verificados). **Allowlist de campos `*Id`** de las clases de comandos y queries: cada campo está clasificado como "verificado", "filtro acotado" o "pisado por el controlador", y un campo nuevo hace fallar el test (criterio 4). Ningún controlador inyecta `PrismaService` salvo `ProController` (rutas sin ids) |

### 9.2 Frontend
- `src/services/api-routes.test.mts` (`node:test`, sin dependencias), sobre el texto de `data.ts`:
  - no contiene `/config/`;
  - contiene `/org/categories` y `/org/activity-types`;
  - `getActivityTypes` no manda `?orgId=`.
- `npm test` corre los dos archivos. `tsc`, `npm run lint` (sin errores nuevos en los archivos tocados) y `npm run build`.

### 9.3 Plan del tester en vivo (criterio 13), sin escribir datos reales

**Salvaguardas:**
- solo `SELECT` para obtener ids y conteos;
- sin seeds y sin `down -v`;
- puertos 3000 y 3001 sin tocar;
- no se imprimen valores del `.env`, tokens ni ids en los documentos.

**Herramienta:** el script Node del 005 (§9.5 de su 03), que firma tokens HS256 en memoria con `iss`, `aud` y `exp` de 15
minutos y escribe solo "caso, esperado, obtenido, OK o FALLO". Se borra al terminar.

**Usuarios y datos** (por `SELECT`):
- **A:** `ADMIN` de la organización X;
- **M:** `MEMBER` de X, si existe;
- **P:** profesional sin membresía en X, si existe; anotar su `canLoadActivities`;
- **B:** otra organización Y sin vínculo con A, con un id real de cada entidad de Y: `WorkItem`, `Patient`,
  `ProfessionalCategory`, `FeePreset`, `Professional`, `ActivityType` y `Payer`.

**Pasos:**
0. **Línea base:** `git status` y conteos 9 / 3 / 72 / 324 / 1483.
1. **Lecturas cruzadas** (A con `x-org-id` X), cuerpos idénticos entre sí:
   - `GET activity/<WorkItem de Y>`, `GET v1/patients/<Patient de Y>/summary` y `/debt`: 404 `not-found`;
   - las mismas con un UUID al azar: 404 con el mismo cuerpo;
   - con `abc`: 404;
   - legítimas con ids de X: 200.
2. **Escrituras en vivo solo con ids inexistentes** (UUID al azar): si la protección fallara, Prisma no encontraría la fila,
   así que tampoco se escribiría.
   - A: `PUT/DELETE activity/<rnd>`, `PUT/DELETE org/categories/<rnd>`, `PUT org/staff/<rnd>/category`,
     `PUT/DELETE pro/payers/<rnd>` y `POST v1/patients/<rnd>/merge` con `targetId` al azar: todos 404.
   - **Las escrituras con ids reales de Y se prueban solo en Jest** (§9.1).
3. **Rol:**
   - M en `POST org/categories` con body `{}`: 403 `forbidden`. Si el guard fallara, el `ValidationPipe` daría 400 antes del
     handler; un 400 o un 201 son FALLO;
   - M en `DELETE org/activity-types/<rnd>`: 403 (un 404 indicaría que el rol no se aplicó, sin escritura);
   - P, lo mismo.
4. **`canLoadActivities`:** P en `POST activity` con un body de forma válida y `patientId` al azar.
   - Con el permiso en `false`: 403 `forbidden`. Un 404 es FALLO del permiso, sin escritura, porque el paciente no existe;
   - con `true`: 404 (el permiso pasó y el paciente no existe). No se escribe nada.
5. **Rutas eliminadas:** `GET config/activity-types`, `GET system/professionals?cuit=1` y `GET pro/payers/lookup?cuit=1`: 404.
   `GET org/staff/lookup?cuit=<CUIT de un profesional de Y>` con A: `NOT_FOUND`.
6. **Navegador** (lectura), con la opción A del 005 (CDP con token en memoria) o B (lista para el usuario):
   - como A: dashboard, Carga & Seguimiento (lista y detalle), pacientes (lista y detalle), profesionales, ajustes
     (categorías y prestaciones **cargan** desde `org/*`) y liquidaciones;
   - como P: Carga & Seguimiento, Reglas de Honorarios;
   - **sin guardar nada.** Los guardados de configuración quedan cubiertos por el contrato de Jest (§9.1 g).
7. `-Smoke` en desarrollo OK. Conteos finales iguales. `git status` solo con lo esperado. `.claude/settings.json` sin
   cambios para el commit (regla 12).

## 10. Trazabilidad

| Criterio | Decisión |
|---|---|
| 1 Relevamiento | §2 (40 filas) y el test estructural (§9.1 a) |
| 2 IDOR en lectura | §3.2, §3.3, §3.8; filas 1, 4 y 5 |
| 3 IDOR en escritura | §3.2 (verificar antes de escribir), §3.4 y §3.8 (transacciones); filas 2, 3 y 6 a 16 |
| 4 Ids referenciados | §3.4, §3.6, §3.8; filas 19 a 28; allowlist de campos `*Id` |
| 5 Configuración solo `ADMIN` | §3.6, §3.7; `OrgRoleGuard` existente; §9.1 (c) |
| 6 `ConfigController` | §3.7 (migrar y borrar) |
| 7 `canLoadActivities` | §3.4 |
| 8 Ownership sin `x-mode` | §3.5; §9.1 (d) |
| 9 Lookup por CUIT | §2.3, §3.9 |
| 10 Frontend | §3.7, §3.10; Aclaraciones; §9.3 paso 6 |
| 11 Tests | §9.1 y §9.2 |
| 12 Calidad | §7 paso 11 |
| 13 Verificación en vivo | §9.3 |
| 14 Sin schema | §5 (sin migración) |

VEREDICTO: APROBADO
