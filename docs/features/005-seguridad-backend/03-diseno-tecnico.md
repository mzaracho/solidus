# 03 — Diseño técnico: 005-seguridad-backend

> Autor: arquitecto. Entrada: `01-spec.md` (23 criterios), `02-ux.md` (aprobado), `00-estado.md`, `.claude/CLAUDE.md`,
> `docs/auditoria/{ARQUITECTURA,BACKLOG,RIESGOS}.md` y, como referencia de formato, el 03 del feature 004.
> Solo lectura: no se ejecutó `dev.ps1`, no se levantaron contenedores, no hubo SQL y no se modificó código. Del
> `.env` de la raíz se leyeron solo los nombres de las claves. Las versiones de npm se consultaron con `npm view`
> (la red respondió bien, sin errores de TLS).
>
> **Regla para este documento y los siguientes del feature:** el hook `pre-commit` del 004 revisa los `.md`. No se
> escriben tokens de ejemplo, URLs con usuario y contraseña, IPs de redes privadas reales ni valores del `.env`.
> Los ejemplos de IP usan el rango de documentación `192.0.2.x`.

## 1. Estado actual verificado

| Pieza | Hallazgo |
|---|---|
| `JwtModule` | Dos registros: `app-module.ts` (global, `jwtModuleAsyncOptions('1d')`) y `auth-module.ts` (local, `'8h'`). `LoginQueryHandler` recibe el `JwtService` local, así que el token dura 8 h. El global de 1 d solo lo usan los guards que hacen `decode`. Ninguno fija algoritmo, `issuer` ni `audience`. |
| Login | `LoginQuery` es una clase con constructor (`user`, `password`) sin decoradores. Si falta un campo, lanza `new Error(...)` y responde 500. Payload firmado: `sub`, `name`, `email`, `roles`, `orgRole` (de la **primera** membresía), `organizationId` (primera membresía o, si no hay, primer `Professional` **sin filtrar `deletedAt` ni `status`**) y `professionalId`. No mira `User.deletedAt`. Si el usuario no existe responde enseguida y, si existe, tarda lo que tarda bcrypt: hay una diferencia de tiempo que permite enumerar usuarios. |
| Guards | `ApiKeyGuard` siempre devuelve `true` y está en `BaseController`, del que heredan todos los controladores. `AuthGuard` (`config/providers/auth-guard-provider.ts`) delega en `VerifyTokenService.verifyToken()`, que devuelve `true`, y lee `@Public()` solo del handler. `JwtAuthGuard` hace `decode` (solo en `ActivityController`). `OrgRoleGuard` hace `decode` y usa `payload.orgRole`. No hay `APP_GUARD`. |
| `ValidationPipe` | **Ya es global** (`pipes-config.ts`): `transform: true` y `enableImplicitConversion: true`, sin `whitelist`. Con la conversión implícita, una propiedad `string` decorada convierte `123` en `"123"` y `{}` en `"[object Object]"`, así que `@IsString()` solo **no** alcanza para el 400 de "no son strings" (criterio 9). |
| Filtros | `HttpFilter` responde `{ code: 'unhandled-exception', details: JSON.stringify(exception), errors: [{ message }] }` para toda `HttpException`. `GlobalFilter` hace lo mismo con 500. Hoy no hay forma de que el front distinga un 403 de organización de un 403 de rol. |
| Logs | `LoggingInterceptor` (registrado con `app.useGlobalInterceptors(new ...)`) vuelca en debug los headers, el body, la query, los params y la respuesta completa. `NestLoggerAdapter` → `Logger.log*` → `console.log` sin filtro de nivel, también en producción. Otros `console.*` con payloads: `Dispatcher` (2 por request), `ProController` (`GET /pro/payers`, 2), `ActivityService` (6, con el `WorkItem` completo y el `Professional`), `update-organization-command` (`console.error(error)`) y `axios-logger-interceptor` (código muerto: `AxiosInterceptor` no está registrado). En el front, `updateOrgSettings` hace `console.log` de los headers, **incluido el Bearer**. |
| CORS | `origin: true`, `credentials: true`. `CORS_ORIGIN` y `CORS_METHODS` se leen y se ignoran. Ningún `fetch` del front usa `credentials: 'include'`, y el backend no lee cookies. |
| Ruta `/` y Swagger | `SwaggerModule.setup('/')` sirve Swagger UI en la raíz. `-Smoke` ("Backend OK") y los dos `Wait-Http` de `dev.ps1` (desarrollo y Docker) esperan un 200 en `http://<probe>:8080/`, **o sea, Swagger**. En Docker el compose fija `NODE_ENV=production`: si Swagger se apaga en producción sin otra ruta pública, `-Docker` y `-Smoke` fallan. `global-prefix-config.ts` ya excluye del prefijo `/health/liveness`, `/health/readiness` y `/metrics`, pero no hay controladores para esas rutas. |
| `bootstrap.ts` | Importa `DocumentBuilder` y `SwaggerModule` sin usarlos (los 2 errores de lint). Arma Swagger antes de CORS. |
| Modelo de pertenencia | `OrganizationMember` (`@@unique([organizationId, userId])`, `role` ADMIN o MEMBER, sin estado). `Professional` (`@@unique([organizationId, userId])`, `deletedAt`, `status` ACTIVE o PENDING; **ningún código asigna PENDING**). Todos los ids son `@db.Uuid`. **`Organization` no tiene columna `slug`, y nunca la tuvo en ninguna migración.** |
| "Slug" en el front | El segmento `[orgSlug]` de la URL **es el UUID de la organización**: `app/page.tsx` arma `/${payload.organizationId}/...` y `WorkItemForm` compara `p.organizationId === orgSlug`. `getHeaders(slug)` manda `x-org-id = token.organizationId` y solo usa el segmento de la URL si el token no trae organización. Ese caso, más `?orgId=${slug}` en `getOrgConfig` y `getActivityTypes`, es el "slug" de la spec. Hoy un valor que no sea UUID llega a Prisma y termina en 500 (`invalid input syntax for type uuid`). |
| Consecuencia para el 403 | Como `x-org-id` sale del token, abrir `/<otra-org>/dashboard` consulta **la organización propia** y responde 200. Para que exista el 403 de la UX (criterio 19 de UX), el front tiene que mandar la organización de la URL. |
| Código muerto relevante | `ProductionController` y `ReportingController` no están en ningún módulo (404): toman `userId` de la query. Handlers sin registrar, que responden 500 "Handler not found": `GetDictionaries`, `GetOrgRules`, `UpdateOrgRules`, `GetProRules`, `UpdateProfile`, `FindAllSettlements`, `FindSettlementDetails`, los de `professional-categories` y `LogoutCommandHandler`. Es preexistente y queda fuera de alcance. |
| Front: servidor y cliente | De los archivos que importan `services/data.ts`, **solo `app/(dashboard)/[orgSlug]/work-items/page.tsx` es Server Component**. Los demás son `'use client'`. `test-suite/page.tsx` es cliente, sin `orgSlug` real: usa `'default-org-id'`. El login hace `fetch` directo a `NEXT_PUBLIC_API_BASE_URL` y escribe la cookie con `'mock_token'` de fallback y `max-age=86400`. |
| Front: rewrites y URLs | `next.config.ts` reescribe `/api/:path*` a `INTERNAL_API_URL` (o `http://localhost:8080/api`). En el navegador se usa `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8080/api`; en Docker se hornea en el build). En el servidor, `INTERNAL_API_URL` (en Docker, `http://backend:8080/api`). El modo desarrollo no pasa ninguna de las dos (no hay `frontend/.env.local`). |
| `dev.ps1` | `Sync-BackendEnv` escribe en `backend/.env` las claves derivadas `DATABASE_URL`, `JWT_SECRET` y `LISTEN_HOST`, conserva las locales y reemplaza las derivadas si alguien las escribió a mano. `ConvertTo-EnvValue` pone comillas simples a todo lo que no sea `[A-Za-z0-9._~-]`. `Initialize-RootEnv` solo agrega una lista fija de claves, así que una variable comentada nueva en `.env.example` no se agrega sola. El texto de `Get-BindExposureWarning` dice "La API todavía no verifica los JWT", y un test exige la palabra `JWT`. |
| `.env` (raíz, solo nombres) | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `JWT_SECRET`, `NEXT_PUBLIC_API_BASE_URL`, `SMOKE_USER`, `SMOKE_PASSWORD`, `BIND_ADDRESS` y `FRONTEND_PORT`. `.dev/certs/extra-ca.pem` existe. |
| Versiones en el registro | `next`: la última estable es **16.4.3** (2026-10-23), con peer `react ^19.0.0` y `node >=20.9.0`. `eslint-config-next` **16.4.3** (trae `eslint-plugin-react-hooks ^7.1` y `typescript-eslint ^8.56`; hoy están en 7.0.1 y 8.53.1). `axios`: **1.20.0** (2026-08-26) y 1.21.0 (2026-10-27, de ayer). `@nestjs/axios@4` acepta `axios ^1.3.1`. En los locks: `next` 16.1.3 y `axios` 1.13.2. |

## 2. Relevamiento: usuario y organización por endpoint

Prefijo `/api`. "Stub" es el `AuthGuard` que hoy siempre deja pasar.

| Endpoint | Guard hoy | Usuario hoy | Organización hoy | Después del 005 |
|---|---|---|---|---|
| `POST v1/auth/login` | stub + `@Public` | — | — | `@Public`, DTO validado |
| `POST v1/auth/logout` | stub | — | — | Autenticado y `@OrgOptional` (el handler sigue sin registrar: 500, preexistente) |
| `GET activity` | `JwtAuthGuard` (decode) | `x-user-id` | `x-org-id` o `?organizationId` | `sub`; se validan las dos fuentes |
| `GET activity/:id` | `JwtAuthGuard` | — | — | Exige `x-org-id` válido. La pertenencia del recurso por id queda fuera de alcance (BACKLOG 3) |
| `POST activity` | `JwtAuthGuard` | `request.userId` (decode) | `body.organizationId`, que **manda sobre** `x-org-id` | `sub`; se validan las dos fuentes |
| `PUT`, `DELETE activity/:id` | `JwtAuthGuard` | `request.userId` | (`body.organizationId` si viene) | `sub`; se valida header y body |
| `GET dashboard/{kpis,chart,payers}` | stub | `x-user-id` | `x-org-id` | `sub`; header |
| `GET`, `POST v1/patients` | stub | `x-user-id` (GET) | `x-org-id` | `sub`; header |
| `v1/patients/:id/{debt,summary}`, `POST :id/merge`, `PUT :id` | stub | — | — | Header obligatorio (por id: BACKLOG 3) |
| `GET settlements/calculate` | ninguno | — | `?organizationId` | Autenticado; se validan query y header |
| `config/*` (`ConfigController`) | ninguno | — | `x-org-id` (y `?orgId`, que el handler ignora) | Autenticado; se validan header y query. Las escrituras siguen sin `ADMIN` (BACKLOG 5, ver §11) |
| `org/*` | stub, más `OrgRoleGuard` (decode) en escrituras | — | `x-org-id` | Autenticado, header, rol desde la base para esa organización |
| `GET pro/context`, `PUT pro/profile`, `GET`/`POST pro/payers` | stub | `x-user-id` | `x-org-id` | `sub`; header |
| `GET pro/memberships` | stub | `x-user-id` | — | `sub`; `@OrgOptional` |
| `PUT`/`DELETE pro/payers/:id`, `GET pro/payers/lookup`, `GET org/staff/lookup` | stub | — | — | Header obligatorio (el `lookup` de `org` exige además ADMIN) |
| `GET system/professionals` | stub | — | — | Header obligatorio |
| `GET`/`POST fee-rules` | stub | `x-user-id` (GET) | `x-org-id` | `sub`; header |
| `fee-engine/professional-categories`, `PUT profile`, `GET settlements`, `settlements/:id/details` | ninguno | — | `?organizationId` o body | Handlers sin registrar (500). El guard valida igual |
| `my-production`, `work-items/reporting/*` | — | `?userId` | — | Controladores **no registrados** (404). Sin cambios; nota en §11 |

**Llamadas del front:** todas las funciones de `services/data.ts` mandan `x-org-id` con `getHeaders(slug)`. Las que
además mandan la organización en la query: `getOrgConfig` (`?orgId=<segmento>`), `getActivityTypes` (`?orgId=<segmento>`) y
`calculateSettlements` (`?organizationId=<id de getOrgDetails>`). Las que la mandan en el body: `createWorkItem` y `updateWorkItem` (`organizationId =
patientOrganizationId`) y `createPatient` desde `PatientDirectory` (`organizationId: orgSlug`). `-Smoke` solo llama a `POST
/api/v1/auth/login`.

## 3. Decisiones

### 3.1 Un solo `JwtModule` y guard global de autenticación (criterios 1 a 5)

**`jwt-config.ts`** (se modifica):
- Constantes nuevas: `JWT_ALGORITHM = 'HS256'`, `JWT_ISSUER = 'solidus-api'`, `JWT_AUDIENCE = 'solidus-web'` y
  `JWT_EXPIRES_IN = '8h'`.
- `jwtModuleAsyncOptions()` (sin parámetro) devuelve:
  - `secret: getRequiredJwtSecret(config)`, sin cambios: obligatorio y de 32 caracteres o más;
  - `signOptions: { expiresIn, algorithm, issuer, audience }`;
  - `verifyOptions: { algorithms: [JWT_ALGORITHM], issuer, audience }`.
- **Un único registro** en `app-module.ts`: `JwtModule.registerAsync({ global: true, ...jwtModuleAsyncOptions() })`.
  `auth-module.ts` deja de importar `JwtModule`, y `LoginQueryHandler` recibe el global.

**`issuer` y `audience`:** cuestan una línea y hacen que solo se acepten los tokens que emite este backend para este front, aunque
alguien firme otros con el mismo secreto (por ejemplo, scripts). Consecuencia: los tokens emitidos antes del despliegue (sin `iss`
ni `aud`) dan 401 y el usuario vuelve a iniciar sesión una vez. Duran como mucho 8 h, así que se acepta.

**`AuthenticationGuard`** (nuevo, `infrastructure.bootstrap/guards/authentication-guard.ts`), registrado como `APP_GUARD`:
1. Si `reflector.getAllAndOverride(PUBLIC_KEY, [handler, class])` es verdadero, deja pasar. Se reutiliza el `@Public()`
   existente (`public-decorator.ts`); hoy el stub solo lo leía del handler.
2. Lee `request.headers.authorization`. Si no es un string, mide más de 4096 caracteres o no cumple
   `^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$` (`Bearer` sin distinguir mayúsculas), responde **401**.
3. `await jwtService.verifyAsync<JwtPayload>(token, { algorithms: [JWT_ALGORITHM], issuer: JWT_ISSUER, audience:
   JWT_AUDIENCE })`. Las opciones se pasan también aquí, de forma explícita, para no depender solo del módulo.
   `jsonwebtoken` 9 (dependencia de `@nestjs/jwt` 11) rechaza `alg: none` cuando hay secreto y, con `algorithms`
   fijado, rechaza también HS384 y HS512. Cualquier excepción se convierte en **401**.
4. Valida el payload: `sub` es un string con forma de UUID y `exp` es un número. Si no, **401**.
5. Deja el contexto en `request.auth = { userId: payload.sub, claims: payload }`, con el tipo `AuthenticatedRequest` en
   `config/core/authentication/auth-context.ts`.
6. **Pisa `request.headers['x-user-id']` con `sub`.** Es defensa en profundidad: si algún código olvidado leyera el header,
   obtendría la identidad verificada. La garantía principal es que ya nadie lo lee (§3.2) y un test estático lo
   controla.

Respuesta 401: `new UnauthorizedException({ code: 'unauthorized', message: 'Unauthorized' })`. Nunca se incluye el
error de `jsonwebtoken` ni el token. El guard no loguea el motivo: un `debug` con el nombre de la clase de error sería
inofensivo, pero no aporta y es una superficie más.

**Se eliminan:**
- `guards/api-key-guard.ts` y `guards/jwt-auth-guard.ts`;
- `config/providers/auth-guard-provider.ts` (el `AuthGuard` stub);
- `modules/features/auth/verify-token-module.ts`;
- `infrastructure/features/auth/services/verify-token-service.ts`;
- `domain/features/auth/services/i-verify-token-service.ts`;
- `filters/axios-logger-interceptor.ts` y `config/providers/interceptor-provider.ts` (código muerto que vuelca payloads; §3.7).

Todos los `@UseGuards(AuthGuard)` y `@UseGuards(JwtAuthGuard)` de los controladores se quitan, porque el guard es global.
`BaseController` queda como clase abstracta vacía con `@ApiBearerAuth()` en lugar de `@UseGuards(ApiKeyGuard)` y
`@ApiSecurity('x-api-key')`. Se mantiene para no tocar la herencia de los 14 controladores.

**Registro:** `config/providers/guard-provider.ts` (nuevo, mismo patrón que `filter-provider.ts`) exporta
`AuthenticationGuardProvider` y `OrgAccessGuardProvider` (`provide: APP_GUARD`). Los dos van en `AppModule.providers` **en ese
orden**. Nest ejecuta los guards globales en orden de registro, antes que los de controlador y los de método.

**Alternativas descartadas:**
- *Reescribir el `AuthGuard` stub manteniendo el nombre:* confunde con el `AuthGuard` de `@nestjs/passport` y con el
  historial de la auditoría. Un nombre nuevo deja claro el cambio.
- *Passport (`@nestjs/passport` y `passport-jwt`):* agrega dos dependencias para algo que `JwtService.verifyAsync` ya resuelve.
- *Aplicar el guard con `@UseGuards` controlador por controlador:* es exactamente lo que falló hoy (6 controladores sin
  guard). El guard global falla cerrado.

### 3.2 Identidad del usuario (criterio 6)

- **Decorador nuevo `@CurrentUserId()`** (`config/core/authentication/current-user-decorator.ts`), hecho con
  `createParamDecorator`: devuelve `request.auth.userId` y, si falta, lanza 401.
- **Reemplazos** (todo `@Headers('x-user-id')` y `request.userId`):
  - `ActivityController`: `findAll`, `create`, `update` y `delete`;
  - `DashboardController`: `kpis`, `chart` y `payers`;
  - `PatientsController.findAll`;
  - `FeeRulesController.findAll`;
  - `ProController`: `context`, `memberships`, `profile`, `GET payers` y `POST payers`.
- Los controladores siempre **asignan** `userId` después de `@Query()` o `@Body()`, nunca con `||`. Hoy ya es así, y así un
  `?userId=` o un `body.userId` del cliente se pisa.
- `ProductionController` y `ReportingController` no están registrados: no se tocan (§11).
- Test estático (`security-invariants.spec.ts`): ningún `.ts` de `src`, salvo el guard y los specs, contiene `x-user-id`.

### 3.3 Pertenencia a la organización (criterios 7 y 8)

**Dónde:** `OrgAccessGuard` (nuevo, `guards/org-access-guard.ts`), segundo `APP_GUARD`, después de la autenticación. Va
como guard y no como interceptor porque tiene que correr antes que los guards de método (`OrgRoleGuard`) y antes que
los pipes (antes de validar el body). Así un rechazo nunca llega a un handler.

**Fuentes de organización** (se leen sin transformar; el body ya está parseado por Express antes de los guards):

| Fuente | Rutas que la usan hoy |
|---|---|
| Header `x-org-id` | Casi todas |
| Query `organizationId` | `GET activity`, `settlements/*`, `professional-categories` |
| Query `orgId` | `org/config`, `config/activity-types`, `config/org-rules` y `config/pro-rules` |
| Body `organizationId` (nivel superior) | `POST`/`PUT activity`, `POST v1/patients` (el controlador lo pisa) y `professional-categories` |
| Body `orgId` (nivel superior) | Ninguna hoy; se incluye para no dejar huecos si un DTO lo agrega |

**Reglas:**
1. Una fuente con `undefined`, `null` o `''` cuenta como ausente. Es la misma semántica que los `||` de los controladores.
2. Una fuente presente que **no sea un string** (un array por headers o query repetidos, un objeto) da **403**: falla
   cerrado.
3. Cada valor se recorta y se pasa a minúsculas. Si no cumple
   `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, da **403** sin consultar la base. Un header
   repetido llega como `"a, b"` y cae acá.
4. **Se validan todos los valores distintos.** Si el header y el body difieren, por ejemplo un profesional que carga una
   atención de un paciente de otra organización suya, el usuario necesita vínculo con las dos.
5. **Organización obligatoria por defecto:** si la ruta no es `@Public()` ni `@OrgOptional()` y no hay ninguna fuente, da
   **403**. Sin esta regla, el criterio 7 se esquivaría omitiendo el header: varios handlers no filtran por
   organización cuando falta (`GetOrganizationQuery` llega a Prisma con `undefined`, `system/professionals` busca en todas).
   `@OrgOptional()` (nuevo, `config/core/authentication/org-optional-decorator.ts`) se aplica solo a `POST
   v1/auth/logout` y `GET pro/memberships`. Si una ruta opcional igual trae organización, se valida.
6. **Vínculo activo** (consulta en `OrgAccessService`, §3.3.1): existe un `OrganizationMember` de `(org, user)`, o un
   `Professional` de `(org, user)` con `deletedAt = null` y `status = 'ACTIVE'`. `PENDING` no cuenta: hoy nadie lo asigna,
   y su semántica ("vínculo no aceptado") no es activa.
7. Contexto: `request.orgAccess = { organizationIds: string[]; roles: Record<orgId, OrgRole | null> }`. El rol sale de la
   membresía; es `null` si el vínculo es solo de `Professional`.
8. Respuesta 403: `new ForbiddenException({ code: 'org-access-denied', message: 'Forbidden' })`. Es la misma para una
   organización inexistente, ajena, mal formada o ausente, y no revela si la organización existe.

**"Slug" o UUID:** el modelo no tiene slugs (§1). El segmento de la URL que el front llama `orgSlug` **es el UUID**. Por eso,
"funcionar con slug" quiere decir: un UUID válido de una organización con vínculo responde 200, y cualquier otro texto
responde **403** (hoy, 500). No hay nada que resolver contra la base ni hace falta una columna nueva. Ver §11, punto 1.

**El `organizationId` del token:** no se usa para autorizar. Es de la primera membresía y no sirve para usuarios de
varias organizaciones. Se sigue firmando, porque el front lo usa para elegir la ruta inicial en `app/page.tsx`. La
autorización siempre consulta la base para la organización pedida. Un usuario con N organizaciones puede operar en
cualquiera de ellas mandando su UUID.

#### 3.3.1 `OrgAccessService` y cache

`infrastructure/features/auth/services/org-access.service.ts` (nuevo; reemplaza en esa carpeta al `verify-token-service`
eliminado) hace una sola consulta, que usa los dos índices únicos:

```ts
prisma.organization.findFirst({
  where: {
    id: orgId,
    OR: [
      { members: { some: { userId } } },
      { professionals: { some: { userId, deletedAt: null, status: 'ACTIVE' } } },
    ],
  },
  select: { members: { where: { userId }, select: { role: true }, take: 1 } },
});
```

Devuelve `{ allowed, memberRole }`. Se registra en `AppModule.providers`, y el `PrismaService` llega por `PrismaModule`, que
`AppModule` ya importa.

**Sin cache entre requests:** una consulta indexada en la base local cuesta alrededor de 1 ms, y una cache retrasaría las
revocaciones (bajas de staff). Dentro de un request, los valores repetidos se resuelven una sola vez (un `Map` local del
guard).

**Alternativas descartadas:**
- *Validar solo `x-org-id`:* deja pasar el `body.organizationId` de `POST activity`, que hoy manda sobre el header.
- *Normalizar o reescribir header, query y body con el UUID resuelto:* no hace falta, porque solo se aceptan UUID, y mutar
  el body es frágil.
- *Columna `slug` y migración:* el front no maneja slugs. Sería schema nuevo sin necesidad (criterio 22).
- *Confiar en `organizationId` y `orgRole` del token:* rompe a los usuarios de varias organizaciones y no se entera de
  las bajas hasta 8 h después.

### 3.4 `OrgRoleGuard` (criterio 5)

- Deja de inyectar `JwtService` y de leer el header. Lee `@RequireOrgRole()` igual que hoy y exige que, **para cada
  organización de `request.orgAccess`**, `roles[org] === 'ADMIN'`.
- Si no hay `orgAccess` (ruta sin organización) y se exige un rol: **403**.
- Respuesta: `ForbiddenException({ code: 'forbidden', message: 'Forbidden' })`.
- **Desvío consciente de la letra del criterio 5** ("usa el payload verificado"): el guard deja de decodificar y usa el
  contexto verificado del request (identidad del token más el rol de esa organización, leído de la base). El
  `orgRole` del token es el de la **primera** membresía: usarlo dejaría a un ADMIN de la organización A actuar como ADMIN
  en la B, donde es MEMBER. Para usuarios de una sola organización el resultado es idéntico. Ver §11, punto 3.

### 3.5 Login (criterio 9)

- **DTO nuevo** `application/features/auth/dtos/login-request.dto.ts`:
  ```ts
  export class LoginRequestDto {
    @ApiProperty() @Transform(({ obj, key }) => obj[key]) @IsString() @IsNotEmpty() @MaxLength(254) user!: string;
    @ApiProperty() @Transform(({ obj, key }) => obj[key]) @IsString() @IsNotEmpty() @MaxLength(128) password!: string;
  }
  ```
  El `@Transform` devuelve el valor **crudo** del body y anula la conversión implícita del `ValidationPipe` global
  (§1). Así `123`, `{}`, `true` o un array dan 400. No se cambia la configuración global (BACKLOG 12) ni se agrega un
  pipe propio.
- `AuthController.login(@Body() body: LoginRequestDto)` despacha `new LoginQuery(body.user, body.password)`. `LoginQuery`
  no cambia.
- `LoginQueryHandler`:
  - el chequeo defensivo de campos lanza `BadRequestException` en lugar de `Error`;
  - si el usuario no existe o no tiene `passwordHash`, hace igual un `bcrypt.compare` contra un hash ficticio. El hash
    se genera una vez, de forma perezosa, con `bcrypt.hash(randomBytes(16).toString('hex'), 10)`, y nunca coincide.
    Después responde el mismo `UnauthorizedException({ code: 'unauthorized', message: 'Unauthorized' })`. Así se
    iguala el tiempo de respuesta (UX 1.3: "ni de tiempo perceptible");
  - la búsqueda de `Professional` para el `organizationId` y el `professionalId` del token agrega `deletedAt: null, status:
    'ACTIVE'`, igual que el guard. Si no, un usuario con un vínculo dado de baja recibiría un token que lo manda a una
    organización que responde 403.
- Sin rate limiting (fuera de alcance).

### 3.6 Contrato de errores

| Caso | Status | `code` en el body |
|---|---|---|
| Token ausente, mal formado, firma inválida, expirado, otro `alg`, sin `iss` o `aud`, `sub` inválido | 401 | `unauthorized` |
| Login: faltan campos o no son strings | 400 | `unhandled-exception` (sin cambios) |
| Login: credenciales inválidas | 401 | `unauthorized` |
| Organización ausente, mal formada, inexistente o sin vínculo | 403 | `org-access-denied` |
| Rol insuficiente (`@RequireOrgRole`) | 403 | `forbidden` |

Cambio mínimo en `HttpFilter.buildResponse`: si `exception.getResponse()` es un objeto con `code` string que cumple
`^[a-z][a-z-]{0,40}$`, se usa ese código; si no, sigue `'unhandled-exception'`. `details` y `errors` no cambian (BACKLOG
13 sigue fuera de alcance). Ningún mensaje de verificación ni valor del request entra en esas excepciones.

### 3.7 Logs sin secretos (criterios 10 y 11)

**Se elige redactar, y no loguear lo que no hace falta:**
- **`config/core/redact.ts`** (nuevo): `redactSensitive(value)` copia en profundidad (hasta 8 niveles, con protección
  contra ciclos por `WeakSet`, y los arrays se recorren). Reemplaza por `'[REDACTED]'` el valor de toda clave que
  coincida, sin distinguir mayúsculas, con `pass|token|secret|jwt|authorization|cookie|api[-_]?key`. Cubre los nombres de
  la spec y sus variantes (`newPassword`, `passwordHash`, `accessToken`, `idToken`).
- **`LoggingInterceptor`** (se reescribe):
  - **nivel `log`:** una línea por request, con método, ruta **sin query string** (la query puede traer `search` o `cuit`),
    status y duración;
  - **nivel `debug`:** solo si `debug` está habilitado. Loguea `params`, `query` y `body` pasados por `redactSensitive`;
  - **nunca loguea headers** (ni siquiera redactados: no aportan);
  - **nunca loguea cuerpos de respuesta**, en ningún endpoint ni nivel. Así queda cubierto "el cuerpo de las respuestas
    de login" sin casos especiales, y no se vuelcan listas de pacientes;
  - recibe `{ debugEnabled }` por constructor desde `bootstrap.ts`.
- **Nivel por entorno:** `config/app/runtime-env.ts` (nuevo) define `getRuntimeEnv(config)`, que devuelve `'development'` o `'test'`
  solo si `NODE_ENV` vale exactamente eso (recortado y en minúsculas), y `'production'` en cualquier otro caso (falla
  cerrado). `Logger` (`config/core/logger.ts`) calcula `debugEnabled = env !== 'production'`:
  - `logDebug` no hace nada en producción;
  - `logError` va a `console.error` y `logWarning` a `console.warn`;
  - `NestLoggerAdapter` agrega `verbose` (igual que `debug`) y, si `message` no es un string, lo pasa por
    `redactSensitive` antes de serializar.
- **`console.*` que se quitan o cambian:**

  | Lugar | Cambio |
  |---|---|
  | `dispatcher.ts` (2 `console.log`) | Se quitan. El `console.error` de "Handler not found" pasa a `Logger.error` con el nombre de la clase |
  | `pro-controller.ts` (2) | Se quitan |
  | `activity.service.ts`, líneas 106, 139 y 203 (payload, `Professional`, `WorkItem` completo) | Se quitan |
  | `activity.service.ts`, líneas 87, 134 y 255 (informativos) | `this.logger.debug(...)` (Nest `Logger`) solo con ids, sin nombres ni montos |
  | `update-organization-command.ts` (`console.error(error)`) | `Logger.error` con `error.message` |
  | `axios-logger-interceptor.ts` | Se elimina el archivo (código muerto) |
  | Front, `data.ts` `updateOrgSettings` (`console.log` con headers y Bearer) | Se quita |

  Los `logger.log` de `FeeResolutionService` quedan (reglas aplicadas, sin secretos).
- **Logs viejos:** `-Docker` reconstruye y recrea el contenedor `backend`, y los logs del contenedor anterior se van con
  él. No se borran volúmenes.

### 3.8 CORS (criterios 12 y 13)

- **Formato de `CORS_ORIGIN`:** orígenes separados por comas, por ejemplo
  `http://localhost:3002,http://127.0.0.1:3002`. Las entradas vacías se ignoran (permite una coma final, §3.10). Cada
  entrada tiene que cumplir `^https?://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?$`: sin path, sin barra final y
  sin `*`. Una entrada inválida **impide arrancar**, con un mensaje que la nombra (los orígenes no son secretos). Se descarta
  JSON: en un `.env` exige comillas y escapes, y el ejemplo viejo con `["..."]` confundía.
- **`config/app/cors-config.ts`** (se reescribe):
  - `parseCorsOrigins(raw)` es una función pura;
  - `buildCorsOptions(config)` devuelve `{ origin: string[], methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Authorization','Content-Type','x-org-id','x-mode'], credentials: false, maxAge: 600 }`;
  - el paquete `cors` compara exacto contra el array y solo responde `Access-Control-Allow-Origin` (con `Vary: Origin`) si
    el origen está en la lista.
- **Lista vacía o variable ausente:**
  - **en producción el backend no arranca**, con el mensaje "CORS_ORIGIN es obligatorio en producción (lista de orígenes
    separada por comas)". Falla rápido, igual que `JWT_SECRET`: rechazar todo en silencio se vería en el navegador como
    "No pudimos conectarnos";
  - **fuera de producción** se rechaza todo origen (array vacío) y se loguea un `warn`.
- **`credentials: false`:** el front manda el token en `Authorization`, no en cookies, al backend. Además, una cookie de
  `localhost:3002` también se enviaría a `localhost:8080` (las cookies no se aíslan por puerto) si se usara
  `credentials: 'include'`. Sin credenciales, eso no ocurre.
- **`x-user-id` sale de `allowedHeaders`** porque el front deja de mandarlo (§3.11). Front y backend se despliegan juntos.
- **`CORS_METHODS`** se elimina de los ejemplos: nunca se usó.
- `maxAge: 600` cachea los preflights 10 minutos. Hoy cada llamada hace preflight por el header `Authorization`.

**Alternativa descartada:** que el navegador use el rewrite `/api` de Next (mismo origen, sin CORS). Es la mejor arquitectura a
futuro (además saca `NEXT_PUBLIC_API_BASE_URL` del build), pero cambia el camino de todas las llamadas y la spec pide
explícitamente la lista blanca. Se anota para BACKLOG 10, que propone la cookie `HttpOnly`.

### 3.9 Ruta pública de salud, raíz y Swagger (criterio 3)

- **`GET /health/liveness`** (fuera del prefijo `/api`, porque ya está excluida en `global-prefix-config.ts`), con
  `@Public()`:
  - responde `{ "status": "ok" }`, sin versión, entorno ni base;
  - controlador nuevo `api/controllers/health/health-controller.ts`, en `modules/features/health/health-module.ts`;
  - no usa CQRS: es una respuesta constante, y un request más su handler sería ceremonia.
- **Rutas públicas:** solo `POST /api/v1/auth/login` y `GET /health/liveness`.
- **Swagger:**
  - solo se monta si `getRuntimeEnv(config) !== 'production'`, en **`/docs`** (ya no en `/`), con `.addBearerAuth()`;
  - Swagger UI lo sirve Express fuera de los guards de Nest: en desarrollo queda público, y es aceptable porque el modo
    desarrollo escucha en loopback por defecto. La API que documenta exige JWT;
  - en Docker (`NODE_ENV=production`) no existe.
- **`/`** deja de responder (404 JSON de Nest).
- **`-Smoke` y los `Wait-Http`** pasan a usar `/health/liveness` (§3.10).

**Alternativa descartada:** una ruta Nest en `/` excluida del prefijo. Excluir la raíz en `setGlobalPrefix` de Nest 10 es
frágil, y `/health/liveness` ya está prevista en el código.

### 3.10 `dev.ps1`, compose y ejemplos (criterio 13)

- **`CORS_ORIGIN` en `backend/.env`** (`Sync-BackendEnv`):
  - se suma a las claves derivadas: si existe una línea local, se reemplaza;
  - valor `http://localhost:<FRONTEND_PORT>,http://127.0.0.1:<FRONTEND_PORT>`, más `CORS_EXTRA_ORIGINS` si está definida;
  - se escribe con `ConvertTo-EnvValue` (queda entre comillas simples);
  - la cabecera del archivo pasa a decir "No editar DATABASE_URL, JWT_SECRET, LISTEN_HOST ni CORS_ORIGIN aquí";
  - funciones puras nuevas: `ConvertTo-CorsOriginList -Value` (valida con la misma regex que el backend; código 1 si hay
    una entrada inválida) y `Get-DevCorsOrigin -FrontendPort -Extra`.
- **El origen del modo Docker (3001) no va en `backend/.env`:** ese archivo solo lo usa el modo desarrollo (el compose no
  tiene `env_file` y `.dockerignore` excluye `.env`). El 3001 lo define el compose. Ver §11, punto 2.
- **`docker-compose.yml`**, en el `environment` del backend:
  ```yaml
  # Origenes del navegador permitidos (frontend en 3001). Extra opcionales: CORS_EXTRA_ORIGINS en .env.
  CORS_ORIGIN: "http://localhost:3001,http://127.0.0.1:3001,${CORS_EXTRA_ORIGINS:-}"
  ```
  La coma final queda vacía si no hay extras, y el parser la ignora.
- **`CORS_EXTRA_ORIGINS`** (nueva, opcional, en el `.env` de la raíz, comentada en `.env.example`):
  - **por qué:** sin ella, con CORS estricto, el uso documentado desde la red local (`BIND_ADDRESS=0.0.0.0` más
    `NEXT_PUBLIC_API_BASE_URL` con la IP de la PC) deja de funcionar en los dos modos;
  - **validación:** la valida `Test-RootEnv` (código 1);
  - **uso:** la suman `Sync-BackendEnv` y el compose;
  - **aviso:** `Get-BindExposureWarning` deja de decir "no verifica los JWT" y pasa a decir que la API y el frontend quedan
    accesibles en la red (con JWT y organización validados) y que, para usarlos desde otro equipo, hay que agregar
    `http://<IP>:<puerto>` a `CORS_EXTRA_ORIGINS`. El texto sigue mencionando "JWT" y "red", y no repite la dirección,
    así que el test existente se ajusta mínimamente.
- **Salud:**
  - `$script:BackendHealthPath = '/health/liveness'` en `dev-lib.core.ps1`;
  - `dev.ps1` (dos `Wait-Http`) e `Invoke-SmokeTest` usan `http://<probe>:8080/health/liveness`;
  - el mensaje pasa a ser "Backend OK (.../health/liveness)".
- **`Show-Urls`:** recibe `-SwaggerUrl`. En desarrollo muestra `http://localhost:8080/docs`; en Docker muestra
  "Swagger: deshabilitado (NODE_ENV=production)".
- **`.env.example`:**
  - `# CORS_EXTRA_ORIGINS=` comentada, con explicación;
  - se corrige el comentario de `BIND_ADDRESS`, que dice "la API no verifica los JWT todavía".
- **`backend/.env.example`:**
  - `CORS_ORIGIN=http://localhost:3000,http://127.0.0.1:3000` sin comentar, para quien arranca sin `dev.ps1`, con el formato
    explicado;
  - se quita `CORS_METHODS`.
- **`listen-config.ts`:** solo se actualiza el comentario que menciona los JWT sin verificar.

### 3.11 Frontend (criterios 14 a 16 y UX)

**Convenciones:** todo acceso a la API sigue pasando por `services/data.ts`. La única excepción es un helper de servidor que
no hace llamadas: solo lee la cookie y redirige, porque `next/headers` no se puede importar en un módulo que también
usan los componentes cliente. Se usan `components/ui` (`Card`, `Button`) y los textos compartidos van en `lib/constants.ts`.

1. **`src/lib/session.ts`** (nuevo, **sin imports**, isomórfico: servidor, cliente y middleware Edge):
   - `AUTH_COOKIE_NAME = 'auth_token'`, `SESSION_EXPIRED_REASON = 'session_expired'` y `MAX_SESSION_SECONDS = 28800`;
   - `decodeJwtPayload(token)`: base64url, `atob` y `TextDecoder`, sin verificar. Devuelve un objeto o `null`;
   - `getCookieMaxAgeSeconds(token, nowMs)`: `min(exp - ahora, 8 h)`. Devuelve `null` si no hay `exp`, si ya venció o si
     no se puede decodificar;
   - `sanitizeFrom(raw)`: implementa UX 2.3 sobre el valor **ya decodificado** (no vuelve a decodificar):
     - el valor tiene que ser string, de 200 caracteres o menos, y empezar con una sola `/`;
     - se rechaza si contiene `\`, `://`, caracteres de control (`\u0000-\u001F`, `\u007F`) o `javascript:`, `data:` o
       `vbscript:` (sin distinguir mayúsculas);
     - se corta el `#...`;
     - se rechaza si el path empieza con `/login`, `/api` o **`/sin-acceso`** (agregado: volver a la pantalla de acceso
       denegado tras el login no tiene sentido);
     - devuelve el path o `null`;
   - `buildLoginPath({ reason?, from? })`: `/login` más `URLSearchParams` (codifica `/` como `%2F`, como espera UX
     criterio 11). `from` pasa por `sanitizeFrom` y se omite si es `/`;
   - `clearSessionCookie()`, que solo usa `document` y se llama solo en el cliente.

   Al no tener imports, se puede probar con `node --test` sin dependencias (§9.3).
2. **`src/lib/constants.ts`:**
   - `SESSION_MESSAGES`: todos los textos de UX 1.3, 3.2, 3.3 y 3.4, en voseo y literales;
   - `API_ERROR_CODE`: `UNAUTHORIZED`, `ORG_ACCESS_DENIED` y `FORBIDDEN`;
   - `ROUTES`: `LOGIN = '/login'` y `NO_ACCESS = '/sin-acceso'`.
3. **`services/data.ts`, transporte único `apiFetch(url, init, { orgSlug, token? })`** (privado):
   - **headers:** `Content-Type`, `x-org-id = orgSlug` (**el segmento de la URL, ya no `token.organizationId`**: hace
     posible el 403 de otra organización; ver §10) y `Authorization` si hay token. **Ya no manda `x-user-id`.** Se eliminan
     `parseJwt` y la lectura del token para armar headers;
   - **token:** `ctx.token` si viene. Si no, en el navegador sale de `document.cookie`. En el servidor, sin `ctx.token`,
     se lanza `ApiUnauthorizedError` sin llamar a la API;
   - **401:**
     - *cliente* (salvo el login, que no usa `apiFetch`): `clearSessionCookie()` y, si no hay ya una navegación en
       curso (bandera de módulo), `window.location.assign(buildLoginPath({ reason: SESSION_EXPIRED_REASON, from: pathname +
       search }))`. Devuelve `new Promise<never>(() => {})`: la llamada no resuelve ni falla, así que no hay toast ni
       pantalla vacía (UX 2.2). Varias llamadas en paralelo producen una sola navegación;
     - *servidor:* lanza `ApiUnauthorizedError`;
   - **403:** se lee el `code` del body JSON (si no se puede leer, cuenta como `forbidden`):
     - *cliente, GET con `org-access-denied`:* `window.location.assign('/sin-acceso')` con la misma bandera y la promesa
       pendiente. No se pasa el slug;
     - *cliente, mutación (o GET con `forbidden` de rol):* llama al notificador registrado, que muestra el toast de UX 3.4
       con `id: 'api-forbidden'` para que sonner no apile duplicados, y lanza `ApiForbiddenError` con
       `message = SESSION_MESSAGES.forbiddenAction` y `handled = true`;
     - *servidor:* lanza `ApiForbiddenError` con `orgDenied` según el `code`;
   - **otros status:** se devuelve el `Response` y cada función sigue con su manejo de hoy.

   En **todas** las funciones de `data.ts`:
   - se cambia `fetch(...)` por `apiFetch(...)`;
   - se agrega `ctx?: { token?: string | null }` como último parámetro **opcional**: las firmas actuales no cambian;
   - la primera línea de cada `catch` es `rethrowServerAuthError(error)`, que relanza `ApiUnauthorizedError` y
     `ApiForbiddenError` **solo en el servidor**, para que un fallback (`null`, `[]`) nunca se trague un 401 o un 403 (UX
     2.2). En el cliente, el 403 de una mutación sigue el camino de error de hoy, sin texto crudo: el mensaje es el de UX
     3.4.
4. **Notificador:** `registerApiForbiddenNotifier(fn)` en `data.ts`. `providers.tsx` (cliente) lo registra con
   `toast.error(SESSION_MESSAGES.forbiddenAction, { id: 'api-forbidden' })`. Así `data.ts` no importa `sonner` (es
   `'use client'`), porque también se importa desde el servidor.
5. **Componentes que muestran `e.message`:**
   - `settings/general/page.tsx`: 96;
   - `ActivityTypesManager.tsx`: 207 y 223;
   - `org/profesionales/page.tsx`: 177;
   - el `catch` de los `onSubmit` que llaman a `createWorkItem` en `AdmisionesTable`, `AtencionesTable` y `PacientesTable`.

   A esos sitios se agrega `if (isHandledApiError(e)) return` antes de su toast, para no duplicar el de UX 3.4. Los
   componentes con texto fijo ("Error al guardar valor") no se tocan: pueden mostrar, además, su toast genérico de siempre.
   Es lo que pide UX 3.5 ("los toasts existentes no cambian"). Ver riesgos.
6. **Login en `data.ts`:** `login(user, password)` hace un `fetch` directo (no `apiFetch`), con `NEXT_PUBLIC_API_BASE_URL`, y
   devuelve un resultado discriminado:

   | Resultado | Cuándo |
   |---|---|
   | `ok` | 200 con `token` y `max-age` válido; trae `token` y `maxAge` |
   | `invalid` | 401 |
   | `bad-request` | 400 |
   | `server` | 5xx |
   | `network` | `fetch` rechazado |
   | `unexpected` | 200 sin `token`, sin `exp` o con cuerpo que no es JSON |
   | `other` | Cualquier otro status |

   Nunca lanza ni expone el cuerpo.
7. **Login (UI):**
   - `app/login/page.tsx` pasa a ser Server Component:
     - lee `searchParams` (`Promise` en Next 16);
     - pasa `showSessionNotice = (reason === 'session_expired')` y `from = sanitizeFrom(from)`;
     - exporta `metadata.title = 'Iniciar sesión · Solidus'`;
     - así se evita `useSearchParams`, que en el build pediría un `Suspense`;
   - **`components/domain/auth/LoginForm.tsx`** (cliente, nuevo) implementa la tabla de estados, los textos, el foco,
     `aria-*`, el `role="alert"` siempre presente, el `role="status"`, "Ingresando…", la protección contra doble envío y
     el bloque de error sin `animate-pulse`, según UX 1 y 5;
   - con el aviso de sesión, al montar llama a `clearSessionCookie()` (UX 2.1, punto 6);
   - en el éxito escribe `auth_token=<token>; path=/; max-age=<maxAge>; SameSite=Lax`, más `; Secure` si
     `location.protocol === 'https:'`, y hace `window.location.assign(from ?? '/')`;
   - sin `mock_token`.
8. **Servidor:** **`src/services/session.server.ts`** (nuevo) importa `cookies` de `next/headers` y `redirect`:
   - `getServerAuthToken()`: `(await cookies()).get(AUTH_COOKIE_NAME)?.value ?? null`;
   - `withServerSession(from, fn)`:
     - sin token, `redirect(buildLoginPath({ reason, from }))`;
     - con token, ejecuta `fn(token)`. Si `fn` lanza `ApiUnauthorizedError`, redirige al login con el aviso; si lanza
       `ApiForbiddenError` con `orgDenied`, redirige a `/sin-acceso`; cualquier otro error se relanza;
     - `redirect()` se llama fuera de los `try` de `data.ts`, con API estable (sin `unstable_rethrow`).

   `work-items/page.tsx`:
   ```ts
   withServerSession(`/${orgSlug}/work-items`, (token) =>
     getWorkItems(orgSlug, 'ORGANIZATION', undefined, 1, 20, { token }),
   )
   ```
   La ruta la arma la página y no sale de los headers del cliente (UX 2.2).
9. **`middleware.ts`:**
   - **sin cookie:** `/login?from=<pathname+search saneado>`, sin `reason` (UX 2.1, punto 4);
   - **con cookie:** se decodifica (sin verificar). Si `exp` ya pasó, no existe o no se puede decodificar (por ejemplo, un
     `mock_token` viejo), redirige a `/login?reason=session_expired&from=...` **y borra la cookie en esa respuesta**
     (`response.cookies.delete`). Responde la pregunta 3 de UX 8: evita un viaje a la API y limpia las cookies viejas.
     La verificación real sigue siendo del backend;
   - `/sin-acceso` queda protegida, y `/login` sigue siendo pública;
   - se mantiene `middleware.ts`: renombrarlo a `proxy.ts` es BACKLOG 31.
10. **`/sin-acceso`:**
    - `app/sin-acceso/page.tsx` es Server Component, **fuera de `(dashboard)`**, así que no carga el Sidebar. La ruta
      estática tiene prioridad sobre `[orgSlug]`;
    - lee la cookie con `cookies()` y la decodifica: si el token trae `organizationId`, muestra la variante "sin acceso"
      (UX 3.2); si no, la variante "sin organización" (UX 3.3). **No usa query params**: nada de la URL se muestra ni elige
      el texto;
    - `metadata.title = 'Sin acceso · Solidus'`;
    - **`components/domain/auth/AccessDenied.tsx`** (cliente, nuevo) usa `Card` y `Button`, con el ícono `ShieldAlert`
      `aria-hidden`, un `h1` con `tabIndex={-1}` y foco al montar, los botones apilados por debajo de 640 px y "Cerrar sesión"
      con `clearSessionCookie()` más `window.location.assign('/login')`;
    - se descarta `forbidden.tsx` de Next: es experimental y requiere el flag `authInterrupts`.
11. **`app/page.tsx`:** con token sin `organizationId`, `router.replace('/sin-acceso')` en lugar de `/login` (UX 8, punto 4).
    Usa `decodeJwtPayload`.
12. **`Sidebar.tsx`:**
    - `handleLogout` usa `clearSessionCookie()`;
    - el efecto de `getProfessionalContext` pasa a usar el `orgSlug` de la URL (`params`) en lugar de `storeOrgSlug`. El
      valor persistido en `localStorage` puede ser de otra sesión u organización: con el 403 nuevo, mandaría al usuario
      a "Sin acceso" por error.
13. **`providers.tsx`:** registra el notificador del punto 4. `AuthHydrator` no cambia, salvo que usa `clearSessionCookie()`.

**`/test-suite`:** sigue usando `'default-org-id'`: ahora recibe 403 y va a "Sin acceso" (antes, 500). No se arregla: la
regla 9 prohíbe usarla y BACKLOG 15 la elimina.

### 3.12 Dependencias (criterio 17)

| Paquete | Hoy | Objetivo | Forma |
|---|---|---|---|
| `next` | 16.1.3 | **16.4.3** exacta | `npm install next@16.4.3 --save-exact` (`package.json` ya fija versiones exactas) |
| `eslint-config-next` | 16.1.3 | **16.4.3** exacta | `npm install -D eslint-config-next@16.4.3 --save-exact` |
| `axios` (backend) | ^1.13.2 (1.13.2) | **^1.20.0, lock en 1.20.0** | `npm install axios@1.20.0 --legacy-peer-deps` (los mismos flags que el Dockerfile, para no remover el árbol de peers) |

- **axios 1.20.0 y no 1.21.0:** 1.21.0 tiene un día de publicada. Se aplica una política mínima de antigüedad por riesgo de
  cadena de suministro. Si `npm audit --omit=dev` marca algo que solo corrige la 1.21, se pasa a 1.21.0 y se informa.
- **React** queda en 19.2.3 (peer `^19.0.0`). No se actualizan `react` ni `react-dom` (fuera de alcance).
- **Riesgos del upgrade de `next`:**
  - cambios de Turbopack en `next build` y `next dev`;
  - aviso de deprecación de `middleware.ts`;
  - comportamiento de los rewrites;
  - `eslint-plugin-react-hooks` 7.1 puede sumar errores en archivos **no tocados**.

  Se verifica con `npm run build` local y en Docker con la CA extra, y comparando la cantidad de errores de `npm run lint`
  antes y después (solo los archivos tocados tienen que quedar limpios, criterio 21).
- Los lockfiles se commitean. `npm audit --omit=dev` en los dos proyectos: sin críticas en `next` ni en `axios`. El
  crítico de `proxy-addr` (Nest 10) queda fuera de alcance: requiere un upgrade mayor.

## 4. Archivos

### Crear
| Archivo | Contenido |
|---|---|
| `backend/src/infrastructure.bootstrap/guards/authentication-guard.ts` (+ `.spec.ts`) | Guard JWT global (§3.1) |
| `backend/src/infrastructure.bootstrap/guards/org-access-guard.ts` (+ `.spec.ts`) | Pertenencia (§3.3) |
| `backend/src/infrastructure.bootstrap/guards/org-role-guard.spec.ts` | Tests del guard reescrito |
| `backend/src/infrastructure.bootstrap/guards/guard-chain.spec.ts` | Integración de la cadena con supertest (§9.1) |
| `backend/src/infrastructure.bootstrap/config/providers/guard-provider.ts` | `APP_GUARD` en orden |
| `backend/src/infrastructure.bootstrap/config/core/authentication/auth-context.ts` | `JwtPayload`, `AuthenticatedRequest`, `UUID_REGEX` y códigos de error |
| `backend/src/infrastructure.bootstrap/config/core/authentication/current-user-decorator.ts` | `@CurrentUserId()` |
| `backend/src/infrastructure.bootstrap/config/core/authentication/org-optional-decorator.ts` | `@OrgOptional()` |
| `backend/src/infrastructure.bootstrap/config/core/redact.ts` (+ `.spec.ts`) | `redactSensitive` |
| `backend/src/infrastructure.bootstrap/config/app/runtime-env.ts` (+ `.spec.ts`) | `getRuntimeEnv` |
| `backend/src/infrastructure.bootstrap/config/app/cors-config.spec.ts` | CORS (§9.1) |
| `backend/src/infrastructure.bootstrap/interceptors/logging.interceptor.spec.ts` | Redacción y criterio 11 |
| `backend/src/infrastructure/features/auth/services/org-access.service.ts` | Consulta de vínculo |
| `backend/src/application/features/auth/dtos/login-request.dto.ts` | DTO del login |
| `backend/src/application/features/auth/login.spec.ts` | 400, 401 y 200 con supertest |
| `backend/src/api/controllers/health/health-controller.ts` | `GET /health/liveness` |
| `backend/src/infrastructure.bootstrap/modules/features/health/health-module.ts` | Módulo del anterior |
| `backend/src/security-invariants.spec.ts` | Invariantes estáticos (§9.1) |
| `frontend/src/lib/session.ts` | Helpers puros (§3.11, punto 1) |
| `frontend/src/lib/session.test.mts` | Tests con `node:test` (§9.3) |
| `frontend/src/services/session.server.ts` | Token y redirecciones del servidor |
| `frontend/src/components/domain/auth/LoginForm.tsx` | Formulario de login (cliente) |
| `frontend/src/components/domain/auth/AccessDenied.tsx` | Pantalla "Sin acceso" (cliente) |
| `frontend/src/app/sin-acceso/page.tsx` | Ruta "Sin acceso" (servidor) |

### Modificar
| Archivo | Cambio |
|---|---|
| `backend/package.json`, `backend/package-lock.json` | `axios` |
| `backend/src/infrastructure.bootstrap/bootstrap.ts` | Sin imports de Swagger sin usar; `LoggingInterceptor({ debugEnabled })`; `configureSwagger(app, config)`; CORS con `buildCorsOptions` (falla al arrancar si corresponde) |
| `.../config/app/jwt-config.ts` y `jwt-config.spec.ts` | Algoritmo, `issuer`, `audience`, `JWT_EXPIRES_IN` y opciones de verificación; el spec pasa a un solo módulo y a esos valores |
| `.../config/app/cors-config.ts` | Reescrito (§3.8) |
| `.../config/app/swagger-config.ts` | Solo fuera de producción, en `/docs`, con `addBearerAuth` |
| `.../config/app/listen-config.ts` | Solo el comentario |
| `.../config/core/logger.ts`, `nest-logger-adapter.ts` | Niveles por entorno y redacción (§3.7) |
| `.../config/core/cqrs/dispatcher.ts` | Sin `console.log` |
| `.../config/core/authentication/public-decorator.ts` | Sin cambios de API (el guard lo lee también de la clase) |
| `.../filters/http-filter.ts` | `code` desde la excepción (§3.6) |
| `.../guards/org-role-guard.ts` | Reescrito (§3.4) |
| `.../interceptors/logging.interceptor.ts` | Reescrito (§3.7) |
| `.../modules/app-module.ts` | Un `JwtModule`; sin `VerifyTokenModule`; `HealthModule`; `OrgAccessService` y `APP_GUARD` |
| `.../modules/features/auth/auth-module.ts` | Sin `JwtModule` |
| `backend/src/api/controllers/base/base-controller.ts` | `@ApiBearerAuth()`; sin `ApiKeyGuard` |
| Los 14 controladores en `backend/src/api/controllers/v1/**` | Sin `@UseGuards(AuthGuard/JwtAuthGuard)`; `@CurrentUserId()`; `@OrgOptional()` en `logout` y `memberships`; `LoginRequestDto`; `ProController` sin `console.log` |
| `backend/src/application/features/auth/login-query-handler.ts` | `BadRequestException`, hash ficticio y filtro de `Professional` (§3.5) |
| `backend/src/application/features/config/commands/update-organization-command.ts` | `Logger.error` |
| `backend/src/infrastructure/features/activity/activity.service.ts` | `console.*` (§3.7) |
| `backend/.env.example` | `CORS_ORIGIN`; sin `CORS_METHODS` |
| `.env.example` | `CORS_EXTRA_ORIGINS` comentada; comentario de `BIND_ADDRESS` |
| `docker-compose.yml` | `CORS_ORIGIN` del backend |
| `dev.ps1` | `Wait-Http` en `/health/liveness`; `Show-Urls -SwaggerUrl` |
| `scripts/dev-lib.core.ps1` | `$script:BackendHealthPath` |
| `scripts/dev-lib.env.ps1` | `ConvertTo-CorsOriginList`, `Get-DevCorsOrigin`, `Sync-BackendEnv` (`CORS_ORIGIN`), `Test-RootEnv` (`CORS_EXTRA_ORIGINS`), texto de `Get-BindExposureWarning` |
| `scripts/dev-lib.process.ps1` | `Invoke-SmokeTest` con la ruta de salud |
| `scripts/dev-lib.tests.ps1` | Tests nuevos y ajustados (§9.2) |
| `frontend/package.json`, `frontend/package-lock.json` | `next` y `eslint-config-next` |
| `frontend/src/services/data.ts` | Transporte, headers, `login`, notificador y `rethrowServerAuthError` (§3.11, puntos 3 a 6) |
| `frontend/src/app/login/page.tsx` | Server Component con `searchParams` y `metadata` |
| `frontend/src/app/page.tsx` | Variante sin organización y `decodeJwtPayload` |
| `frontend/src/app/(dashboard)/[orgSlug]/work-items/page.tsx` | `withServerSession` |
| `frontend/src/middleware.ts` | `from`, `exp` y borrado de la cookie |
| `frontend/src/components/providers.tsx` | Notificador; `clearSessionCookie` |
| `frontend/src/components/layout/Sidebar.tsx` | `clearSessionCookie`; `orgSlug` de la URL |
| `frontend/src/lib/constants.ts` | `SESSION_MESSAGES`, `API_ERROR_CODE` y `ROUTES` |
| `frontend/tsconfig.json` | `allowImportingTsExtensions: true` (solo para el test `.mts`; `noEmit` ya está activo) |
| Componentes de §3.11, punto 5 (6 archivos) | `isHandledApiError` en el `catch` |

### Eliminar
`backend/src/infrastructure.bootstrap/guards/api-key-guard.ts`, `guards/jwt-auth-guard.ts`,
`config/providers/auth-guard-provider.ts`, `config/providers/interceptor-provider.ts`, `filters/axios-logger-interceptor.ts`,
`modules/features/auth/verify-token-module.ts`, `backend/src/infrastructure/features/auth/services/verify-token-service.ts` y
`backend/src/domain/features/auth/services/i-verify-token-service.ts`.

`@nestjs/axios` queda sin usos. No se desinstala en este feature (se anota para BACKLOG 25). `axios` sigue en uso por
`AxiosFilter`.

### Documentación (criterio 23, la hace el documentador)
- **`.claude/CLAUDE.md`:**
  - regla 4: los JWT se verifican (guard global), la organización se valida contra `OrganizationMember` y `Professional`,
    y `@Public` y `@OrgOptional` son excepciones explícitas;
  - todo endpoint nuevo que use otra fuente de organización tiene que agregarla al guard;
  - la línea de Jest ("solo `jwt-config`") se actualiza;
  - Swagger pasa a `/docs`, solo en desarrollo.
- **`docs/auditoria/COMANDOS.md`:** `CORS_ORIGIN` (generado), `CORS_EXTRA_ORIGINS`, `/health/liveness`, Swagger en `/docs` y
  la pista de "No pudimos conectarnos" cuando falla CORS.
- **`RIESGOS.md` (local e ignorado):**

  | Ítem | Estado |
  |---|---|
  | S1 | Resuelto |
  | S2 | Mitigado (todo autenticado; `ConfigController` sin `ADMIN`, BACKLOG 5) |
  | S3 | Parcial (organización validada; recursos por id pendientes) |
  | S5 | Ya cubierto en 002 en lo que toca al secreto por defecto |
  | S7 | Resuelto |
  | S8 | Resuelto |
  | S9 | Parcial (sin `mock_token`, `SameSite`, `Secure` en HTTPS; sigue sin `HttpOnly`) |
  | S11 | Resuelto |
  | Residuales del 004 | Usuario de humo: 403; login sin campos: 400 |
- **`BACKLOG.md`:**
  - 1, 7, 8 y 9 resueltos;
  - 2 y 11 parciales;
  - 10 y 14 parciales (`mock_token` y Swagger);
  - nota en 3 y 5.
- **Recomendado:** la tabla de endpoints y guards de `ARQUITECTURA.md`.

## 5. Datos y contratos

- **Base:** sin cambios de schema ni migraciones. Solo lecturas nuevas (consulta de vínculo).
- **Token** (sin cambios de claims): se agregan `iss = solidus-api` y `aud = solidus-web`. `alg` queda fijo en HS256 y la
  duración en 8 h.
- **API:**
  - `GET /health/liveness` es nueva y pública;
  - Swagger pasa de `/` a `/docs` (solo fuera de producción);
  - los 401 y 403 llevan `code` (§3.6);
  - `x-user-id` se ignora: el backend lo pisa con `sub`;
  - la organización es obligatoria salvo en las rutas `@OrgOptional`;
  - un identificador que no sea UUID da 403.
- **Variables de entorno:**

  | Variable | Dónde | Detalle |
  |---|---|---|
  | `CORS_ORIGIN` | Backend | Lista separada por comas; obligatoria en producción. Generada en `backend/.env` y definida en el compose |
  | `CORS_EXTRA_ORIGINS` | `.env` de la raíz | Opcional |
  | `CORS_METHODS` | — | Deja de documentarse |
- **Cookie `auth_token`:** `path=/; SameSite=Lax; max-age` hasta `exp` (8 h como máximo), `Secure` en HTTPS. La escribe el cliente
  y la borran el middleware, el login con `reason` y el manejo de 401.
- **Rutas del front:** `/sin-acceso` es nueva. `/login` acepta `reason=session_expired` y `from`.

## 6. Manejo de errores (resumen)

| Origen | Backend | Front cliente | Front servidor |
|---|---|---|---|
| Sin token o token inválido | 401 `unauthorized` | Borra la cookie y va a login con `reason` y `from` (una sola vez; promesa pendiente) | `redirect` a login con `reason` y `from` |
| Organización sin vínculo | 403 `org-access-denied` | GET: `/sin-acceso`. Mutación: toast de UX 3.4 | `redirect('/sin-acceso')` |
| Rol insuficiente | 403 `forbidden` | Toast de UX 3.4 y el fallback de la función | Error genérico |
| Login 400, 401, 5xx o red | — | Textos de UX 1.3, sin el cuerpo de la respuesta | — |
| Configuración inválida (`JWT_SECRET`, `CORS_ORIGIN` en producción, origen mal formado) | No arranca, con un mensaje sin secretos | — | — |

## 7. Impacto

- **Rendimiento:**
  - una consulta indexada por request con organización. El dashboard hace 3 llamadas en paralelo, o sea 3 consultas de
    unos 1 ms;
  - `verifyAsync` con HMAC: microsegundos;
  - los preflights quedan cacheados 10 minutos (hoy no hay cache);
  - el login sin usuario ahora cuesta lo mismo que con usuario (un bcrypt de cost 10, unos 70 ms). Es intencional.
- **Compatibilidad:**
  - **sesiones existentes:** los tokens sin `iss` y `aud` dan 401, y las cookies `mock_token` las limpia el middleware.
    El usuario vuelve a iniciar sesión una vez;
  - **`x-org-id` = organización de la URL:** en los flujos normales es la misma que la del token, porque `app/page.tsx` arma la
    URL con ella. Lo que cambia es el caso de otra organización en la URL: hoy muestra los datos propios bajo una URL
    ajena y ahora muestra "Sin acceso";
  - **profesionales de varias organizaciones:** `POST activity` con `body.organizationId` de otra organización suya sigue
    funcionando, porque se valida el vínculo con las dos. Lo que deja de funcionar es crear una atención en una
    organización `SOLO_PRACTICE` **sin vínculo**: hoy `ActivityService` autocrea el `Professional` en cualquier
    organización de ese tipo cuyo UUID se conozca. Era una escalada de privilegios y ahora da 403;
  - **uso desde la red local:** requiere `CORS_EXTRA_ORIGINS`;
  - **Swagger** se mueve a `/docs` y no existe en Docker;
  - **scripts propios** que llamaban a la API sin token o sin `x-org-id`: 401 o 403. El único conocido es `-Smoke`, que solo
    hace el login.

## 8. Plan de implementación (pasos chicos)

1. **Dependencias, primero y por separado:**
   - backend: `axios@1.20.0`, `npx tsc --noEmit` y `npm test`;
   - frontend: `next` y `eslint-config-next` 16.4.3, `npx tsc --noEmit` y `npm run build` (con
     `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` si falla Google Fonts por TLS);
   - se anota la cantidad de errores de `npm run lint` del front antes y después.
   Si algo rompe, se informa al PO antes de seguir (criterio 17).
2. **`runtime-env.ts`, `redact.ts`, `Logger`, `NestLoggerAdapter`, `LoggingInterceptor`** y la limpieza de `console.*`.
   Tests de redacción e interceptor.
3. **JWT:** `jwt-config` con un solo módulo y su spec. `AuthModule` sin `JwtModule`.
4. **Autenticación:** `auth-context`, decoradores, `AuthenticationGuard`, `guard-provider`, `HealthModule`, `@Public` en el login y
   la salud, y borrado de los guards y stubs viejos. `BaseController` y los `@UseGuards` de los controladores. Tests del guard.
5. **`@CurrentUserId()`** en los controladores y `security-invariants.spec.ts`.
6. **`OrgAccessService`, `OrgAccessGuard`, `@OrgOptional` y `HttpFilter`** (`code`). Tests.
7. **`OrgRoleGuard`.** Tests. `guard-chain.spec.ts` (integración).
8. **Login:** DTO y handler. `login.spec.ts`, con el caso del criterio 11.
9. **CORS** y Swagger. `bootstrap.ts` (cierra los 2 errores de lint). `cors-config.spec.ts`. `npx eslint` sobre los archivos
   tocados.
10. **`dev.ps1`, `dev-lib`, compose y `.env.example`.** Tests de `dev-lib`. `docker compose config --quiet`.
11. **Front, base:** `session.ts` y su test, `constants`, `data.ts` (transporte, headers, `login` y notificador),
    `session.server.ts` y `work-items/page.tsx`.
12. **Front, UI:** `LoginForm` y la página de login, `middleware`, `/sin-acceso` con `AccessDenied`, `app/page.tsx`, `Sidebar`,
    `providers` y los 6 componentes.
13. **Calidad completa (§9.4).** No se ejecuta `dev.ps1` contra el `.env` real: eso lo hace el tester.

## 9. Estrategia de tests

### 9.1 Backend (Jest, criterio 20)

Todos los specs usan un secreto ficticio armado en ejecución (`'k'.repeat(40)`), `ConfigModule.forRoot({ ignoreEnvFile:
true })` y `PrismaService` mockeado. No leen `backend/.env` ni tocan la base. Los tokens de prueba se firman con
`JwtService` o, para `alg: none` y HS512, se arman a mano con `crypto.createHmac` y base64url.

| Spec | Casos |
|---|---|
| `authentication-guard.spec.ts` (unidad) | Sin header; sin `Bearer`; dos partes; header de más de 4096; firma de otro secreto; expirado (`exp` en el pasado); `alg: none`; HS512 con el secreto correcto; sin `iss`; `aud` distinto; `sub` que no es UUID; sin `exp`: todos dan `UnauthorizedException` con `code: 'unauthorized'`, y el mensaje no contiene "jwt", "signature", "expired" ni el token. Ruta `@Public` (en el handler y en la clase): pasa sin token. Válido: `request.auth.userId === sub`, y un `x-user-id` distinto queda pisado con `sub` |
| `org-access-guard.spec.ts` (unidad, `OrgAccessService` mockeado) | Miembro (UUID): pasa con `roles[org] = 'ADMIN'`. Solo `Professional`: pasa con rol `null`. Ajeno: 403 `org-access-denied`. **"Slug"** (`'psico-lsa'`): 403 y el servicio **no** se llama. UUID en mayúsculas: se normaliza y pasa. Header y body distintos: se consultan los dos, y si uno falla, 403. Query `orgId` y `organizationId`. Fuente no string (array u objeto): 403. Ruta normal sin organización: 403. `@OrgOptional` sin organización: pasa; con organización ajena: 403. `@Public`: no consulta |
| `org-access.service` (dentro del spec anterior o propio) | El `where` enviado a Prisma incluye `deletedAt: null` y `status: 'ACTIVE'` para `Professional` y filtra la membresía por `userId` |
| `org-role-guard.spec.ts` | Sin `@RequireOrgRole`: pasa. ADMIN: pasa. MEMBER: 403 `forbidden`. Solo `Professional` (`null`): 403. Dos organizaciones con ADMIN en una sola: 403. Sin `orgAccess`: 403. Un `orgRole: 'ADMIN'` en los claims del token **no** alcanza |
| `guard-chain.spec.ts` (integración con supertest) | Módulo de prueba con un controlador ficticio (públicas, protegidas, con organización, opcionales y de rol), los dos `APP_GUARD` reales, `JwtModule` con `jwtModuleAsyncOptions()`, `HttpFilter` y `HealthModule`, con `configureGlobalPrefix`. Verifica el orden (sin token da 401 y no 403), el cuerpo genérico de 401 y 403, `GET /health/liveness` en 200 sin token y fuera de `/api`, y que el controlador recibe `@CurrentUserId() === sub` aunque se mande otro `x-user-id`. Además, `Reflect.getMetadata('providers', AppModule)` contiene los dos `APP_GUARD` en orden |
| `login.spec.ts` (supertest, `configurePipes` real, Prisma mockeado, hash bcrypt de cost 4 de una contraseña ficticia armada en ejecución) | 400: `{}`, sin `user`, sin `password`, `user: 123`, `password: {}`, `user: ['a']`. 401: usuario inexistente y contraseña errónea, **con cuerpos idénticos**, y `bcrypt.compare` llamado en los dos casos (espía). 200: trae `token`, y el token verifica con HS256, `iss` y `aud`, con `exp - iat = 28800` |
| `logging.interceptor.spec.ts` | Con `NODE_ENV=development` (debug activo): espías sobre `console.log`, `info`, `warn`, `error` y `debug`, y sobre `process.stdout.write`. **Criterio 11:** login 200 con la contraseña ficticia; la salida capturada no contiene ni la contraseña ni el token devuelto (ni su firma, la tercera parte), y sí contiene `[REDACTED]`. También: un body con `{ a: { b: [{ accessToken: 'x' }] }, secret: 'y', JWT: 'z' }` sale redactado; el header `Authorization` y la cookie no aparecen; las respuestas no se loguean; con `NODE_ENV=production` no hay líneas de debug |
| `redact.spec.ts` | Claves anidadas, arrays, mayúsculas, ciclos, profundidad máxima, y que no muta el original |
| `cors-config.spec.ts` | `parseCorsOrigins`: lista con espacios, coma final y entradas inválidas (`*`, con path, con barra final, `ftp://`) que lanzan. Integración (`createNestApplication`, `enableCors(buildCorsOptions(...))` y supertest): un origen permitido recibe ACAO igual al origen y `Vary: Origin`; uno no permitido no recibe ACAO; el preflight permitido responde 204 con `x-org-id` en los headers permitidos y sin `Access-Control-Allow-Credentials`; una variable vacía en desarrollo no deja ningún ACAO; una vacía o ausente en producción lanza |
| `runtime-env.spec.ts` | `development`, `test`, `' Development '`, `production`, `staging`, `undefined`. Swagger solo fuera de producción (función `shouldEnableSwagger`) |
| `jwt-config.spec.ts` (ajustado) | Los casos actuales del secreto. Firma con HS256, `iss`, `aud` y 8 h. Un solo `JwtModule.register` en todo `src` |
| `security-invariants.spec.ts` (estático, mismo estilo que el spec actual de `jwt-config`) | En `src` (sin `*.spec.ts`): ningún `x-user-id` salvo en el guard; ningún `jwtService.decode` ni `.decode(`; ninguna referencia a `ApiKeyGuard`, `VerifyTokenService` ni `JwtAuthGuard`; ningún `console.log(` fuera de `config/core/logger.ts`; `origin: true` ausente; exactamente un `JwtModule.register` |

### 9.2 `dev-lib` (`scripts/dev-lib.tests.ps1`)

- **`ConvertTo-CorsOriginList`:**
  - acepta vacío, una entrada, varias con espacios e IPv6 entre corchetes;
  - rechaza con código 1 `*`, un path, una barra final, `ftp://` y una entrada con espacio interno.
- **`Get-DevCorsOrigin`:** con `-FrontendPort 3005` da `http://localhost:3005,http://127.0.0.1:3005`, y con extras los agrega
  al final.
- **`Sync-BackendEnv`:**
  - escribe una sola línea `CORS_ORIGIN` que sigue a `FRONTEND_PORT` y a `CORS_EXTRA_ORIGINS`;
  - reemplaza una línea local `CORS_ORIGIN=...`;
  - la cabecera menciona `CORS_ORIGIN`;
  - una segunda ejecución no reescribe.
- **`Test-RootEnv`:** `CORS_EXTRA_ORIGINS` inválida da código 1, y una válida da 0.
- **Compose:** el texto del backend contiene `CORS_ORIGIN:` con `http://localhost:3001` y `http://127.0.0.1:3001`.
- **Salud:**
  - `$script:BackendHealthPath` vale `/health/liveness`;
  - `dev.ps1` no contiene `8080/'` y usa la constante en los dos `Wait-Http`;
  - `Invoke-SmokeTest`, con `Get-HttpStatus` redefinida, consulta esa ruta.
- **`Get-BindExposureWarning`:** el test existente se ajusta. Sigue exigiendo "JWT" y "red", que no repita la dirección, y que
  mencione `CORS_EXTRA_ORIGINS`.
- **Ejemplos:** `.env.example` contiene `# CORS_EXTRA_ORIGINS=` y `backend/.env.example` contiene `CORS_ORIGIN=`.
- **Regresión:** los tests previos siguen en verde.

### 9.3 Frontend

No hay framework de tests y no se agrega ninguno (BACKLOG 22).

- **Test sin dependencias:** `src/lib/session.test.mts` con `node:test` y `node:assert`, que importa `./session.ts`. Se corre con
  `node --test src/lib/session.test.mts`: Node 24 local y 22 en Docker quitan los tipos solos.
- **Script:** `"test": "node --test src/lib/session.test.mts"` en `package.json`.
- **Casos:**
  - `sanitizeFrom`, con los 8 casos de UX criterio 15 más `/sin-acceso`, `/api/x`, una ruta válida con query, una con `#` y
    `/%0d%0aX`, este último ya decodificado y con `\r\n`;
  - `getCookieMaxAgeSeconds`: `exp` en 1 h, en 10 h (tope 28800), vencido, sin `exp` y basura;
  - `decodeJwtPayload` con UTF-8;
  - `buildLoginPath` con el `%2F` esperado.
- **Plan B:** si `node --test` no corre limpio (detección de módulos o tipos), el desarrollador lo informa y esos casos quedan
  cubiertos por el tester (§9.5, paso 6). No se agrega Vitest sin aprobación.

### 9.4 Calidad (criterio 21)

- `npx tsc --noEmit` en backend y frontend;
- `npx eslint` sobre cada `.ts` del backend tocado o creado, incluido `bootstrap.ts` (nunca `npm run lint` del backend, que
  aplica `--fix`);
- `npm run lint` del front, sin errores en los archivos tocados y con el delta informado;
- `npm test` del backend;
- `node --test` del front;
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-lib.tests.ps1`;
- `docker compose config --quiet`, con y sin el override de la CA;
- `npm audit --omit=dev` en los dos proyectos.

### 9.5 Plan del tester en vivo

**Salvaguardas de `00-estado.md`:**
- sin escrituras en la base (solo `SELECT`), sin seeds y sin `down -v`;
- el 3000 de pm2 no se toca (`FRONTEND_PORT=3002`);
- no se imprimen valores del `.env`, tokens ni ids en los documentos;
- todo con `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 …`.

**Herramienta para tokens (sin imprimir nada):** un script Node en el scratchpad que:
1. Lee `JWT_SECRET` del `.env` de la raíz **en memoria**, con un parser simple de `KEY=VALUE` que quita comillas.
2. Recibe los ids por stdin. Los obtiene antes con:
   ```
   docker compose exec -T db psql -U <user> -d <db> -tA -c "<SELECT>"
   ```
   Las consultas:
   - **A:** un usuario con `OrganizationMember` ADMIN y su organización X;
   - **M:** un usuario MEMBER, si hay;
   - **P:** un usuario con `Professional` ACTIVE, `deletedAt` nulo y sin membresía en esa organización, si hay;
   - **Y:** una organización sin vínculo con A.
3. Arma los JWT con `crypto.createHmac('sha256')` (sin dependencias): válidos con `iss`, `aud` y `exp` en 15 minutos, y
   también las variantes inválidas (otro secreto, vencido, `none`, HS512, sin `iss`).
4. Hace los requests con `fetch` a `http://127.0.0.1:8080` y escribe **solo** "caso, status esperado, status obtenido, OK o
   FALLO".

El script no escribe tokens en disco y se borra al final.

**Pasos:**

0. **Línea base:**
   - `git status`, hashes de los locks y `docker ps -a`;
   - conteos 9/3/72/324/1483 (`SELECT` de solo lectura).
1. **Calidad estática:** todo lo de §9.4. `npm run build` del front local.
2. **`-Init`:**
   - código 0;
   - `backend/.env` tiene **una** línea `CORS_ORIGIN` con los orígenes de 3002 (se compara con una regex, sin mostrar el
     resto del archivo).
3. **Modo desarrollo** (`.\dev.ps1`, luego `-Smoke`): Backend OK (`/health/liveness`), Frontend OK (3002) y Login OK.
   - `GET http://127.0.0.1:8080/` da 404;
   - `/docs` da 200 (Swagger en desarrollo).
4. **API con el script:**
   - **401** en `GET /api/org` sin token, con basura, con otro secreto, vencido, `none`, HS512 y sin `iss`. El cuerpo no
     contiene "jwt", "expired" ni "signature";
   - **200** con A más `x-org-id` X en `GET /api/org`, `/api/dashboard/kpis`, `/api/activity`, `/api/v1/patients` y
     `/api/fee-rules`;
   - **200** con P en su organización (si existe);
   - **403 `org-access-denied`:**
     - A con Y;
     - A con `x-org-id: psico-lsa`;
     - A sin `x-org-id` en `/api/org`;
     - A con `?organizationId=Y` en `/api/settlements/calculate`;
   - **403 en `POST /api/activity` con `x-org-id` X y body `{ "organizationId": Y }` solo:**
     - es seguro: si el guard fallara, el `ValidationPipe` daría 400 (faltan `date` y `patientId`) **antes** del handler, y
       no se escribe nada;
     - un 400 o un 201 son FALLO del guard;
   - **403 `forbidden`:** M en `PUT /api/org` **con body vacío y `x-org-id` X**. Si diera 200 sería un fallo grave; antes,
     confirmar con un `SELECT` que M existe. Si no hay M, se cubre en Jest;
   - **`x-user-id`:** con A y `x-user-id` igual al id de P, `GET /api/pro/context` devuelve null o los datos de A, nunca los
     de P (se compara `userId` en memoria);
   - **login:**
     - `{}` y `{ "user": 123, "password": "x" }` dan 400;
     - usuario `nadie@ejemplo.invalid` y contraseña errónea del usuario de humo dan 401 con cuerpos idénticos;
     - el usuario de humo (`SMOKE_*` en memoria) da 200, y con su token `GET /api/org` con X da 403 y `GET
       /api/pro/memberships` da 200;
   - **CORS** (preflight `OPTIONS /api/org` con `Access-Control-Request-Headers: authorization,x-org-id`):
     - `Origin: http://localhost:3002` y `http://127.0.0.1:3002` reciben ACAO;
     - `http://evil.example` y `http://localhost:3001` no reciben ACAO;
     - ninguna respuesta trae `Access-Control-Allow-Credentials`.
5. **Navegador** (UX §6):
   - **sin credenciales**, con cualquier herramienta: criterios 1 a 10, porque los errores de login se prueban con un usuario
     ficticio inexistente; criterio 3 con el backend detenido; 15, 16, 17 y 25;
   - **sesión vencida o adulterada:** se inyecta en la cookie un token **sin firma válida**, fabricado sin secreto, que no
     sirve como credencial. Con `exp` en el pasado, para el camino del middleware; con `exp` futuro y firma basura, para el
     camino del 401 del servidor en `/<X>/work-items` y del cliente (criterios 11 a 14);
   - **con sesión válida** (criterios 18 a 24 y 26, y criterio 19 de la spec):
     - **opción A**, preferida: un script Node sin dependencias que maneja Chrome por el DevTools Protocol (`--remote-debugging-port`
       y el `WebSocket` global de Node 22 o superior). Pone la cookie con `Network.setCookie` usando el token firmado en
       memoria, navega y lee el texto o el foco del DOM, y escribe solo OK o FALLO;
     - **opción B:** el PO le pide al usuario la lista de verificación manual.

     Para el usuario de humo (criterio 22), lo mismo con el token de su login real en memoria. **No se escriben tokens ni
     contraseñas en los argumentos de herramientas que queden en el registro.**
6. **Si `node --test` no corrió** (plan B de §9.3): los casos de `from` de UX criterio 15 por navegador.
7. **`-Stop`.** Modo Docker: `.\dev.ps1 -Docker` usa sola la CA extra de `.dev/certs/extra-ca.pem` (build de `next` 16.4.3).
   - `-Smoke`: Backend OK, Frontend OK (3001) y Login OK;
   - `/docs` y `/` dan 404;
   - el script repite un subconjunto contra 8080: 401, 200 con A, 403 con Y y CORS con 3001 permitido y 3002 no;
   - el navegador repite una carga de dashboard con sesión válida (opción A o B);
   - **logs:** `docker compose logs backend` se busca **en memoria** contra `SMOKE_PASSWORD`, la firma del token del login de
     humo y `[REDACTED]` (en producción no hay debug: se esperan 0, 0 y cualquier valor). Se muestran solo los conteos. El
     contenedor es nuevo, así que los logs viejos no están.
8. **`-Stop`.** Conteos finales 9/3/72/324/1483.
9. **Barrido:** `git diff` y los archivos nuevos, revisados con el hook (o `scripts/pre-commit.ps1` sobre el diff), y
   `git status` con solo lo esperado. `.claude/settings.json` se restaura antes del commit (regla 12).

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| Alguna llamada queda sin token o sin `x-org-id` y la pantalla se rompe | Relevamiento completo (§2): todas las llamadas pasan por `apiFetch`, y la única de servidor es `work-items`. El tester recorre dashboard, atenciones, work-items, pacientes, profesionales, liquidaciones y ajustes |
| `x-org-id` pasa a ser la organización de la URL | En los flujos normales coincide con la del token. `Sidebar` deja de usar el `orgSlug` persistido. El tester prueba en modo profesional (si hay P) y en modo organización |
| Profesional que carga para un paciente de otra organización | Se valida el vínculo con las dos. Un paciente de una organización con el vínculo dado de baja da 403, que es lo correcto |
| `SOLO_PRACTICE` sin vínculo deja de autocrear `Professional` | Es intencional (escalada). La lista de pacientes del modo profesional solo trae organizaciones con vínculo |
| Rol desde la base en lugar del token (desvío del criterio 5) | Mismo resultado para usuarios de una organización; más seguro para los de varias. Se avisa al PO (§11) |
| Conversión implícita del `ValidationPipe` en el login | `@Transform` con el valor crudo. Tests con número, objeto y array |
| Sesiones vigentes invalidadas al desplegar (`iss`/`aud`) | Un nuevo login. El middleware limpia las cookies viejas y muestra el aviso |
| Upgrade de `next` (Turbopack, `middleware`, rewrites, reglas nuevas de lint) | Paso 1, aislado. Build local y en Docker con la CA. Delta de lint informado. Si rompe, se escala (criterio 17) |
| `axios` reciente | 1.20.0 (dos meses) y no 1.21.0 (un día) |
| CORS rompe el login desde la red local | `CORS_EXTRA_ORIGINS` y aviso de `BIND_ADDRESS` |
| `CORS_ORIGIN` ausente en un despliegue de producción | El backend no arranca, con un mensaje claro. El compose la define |
| Promesas pendientes en el cliente tras un 401 o un 403 de lectura | Hay navegación completa inmediata, así que el estado se descarta. La bandera evita navegaciones múltiples |
| Un toast genérico extra tras un 403 de mutación en los componentes con texto fijo | Consistente con UX 3.5: el toast de UX 3.4 aparece siempre, sin duplicarse (`id`). Eliminar el genérico requiere tocar cada componente (BACKLOG 26) |
| `node --test` con `.mts` y `.ts` no corre | Plan B (§9.3) |
| El middleware decodifica sin verificar | Solo decide la redirección. La autorización siempre es del backend |
| Swagger fuera de `/`: documentación y costumbre | COMANDOS y `Show-Urls` lo explican |
| Logs con datos personales en desarrollo (bodies en debug) | Solo en desarrollo, con claves sensibles redactadas. Las respuestas no se loguean nunca. En producción no hay debug |
| Mensajes de Prisma en los logs de error | Contienen argumentos de la consulta, pero ninguna consulta del backend lleva contraseñas ni tokens (el login compara en memoria). Residual aceptado |
| `.claude/settings.json` modificado por el harness | Regla 12: restaurarlo antes del commit. El hook lo bloquea si tiene `allow` |
| IDOR por `:id` y `ConfigController` sin `ADMIN` | Fuera de alcance (BACKLOG 3 y 5). Se deja escrito para seguridad (§11) |

## 11. Aclaraciones sobre la spec y notas para el PO

Ninguna bloquea. Son lecturas de la spec que conviene que el PO confirme o transmita.

1. **No existe el "slug" (criterio 7).** El modelo no tiene slugs y el segmento `[orgSlug]` es el UUID. "Funcionar con
   slug" se implementa así: la organización de la URL (UUID) se valida igual que el header, y un texto que no es UUID
   responde 403 (hoy, 500). En Jest, "org por slug" significa: un valor no UUID da 403 sin consultar la base.
2. **"modo Docker en 3001" en `backend/.env` (criterio 13).** `backend/.env` solo lo usa el modo desarrollo. Los orígenes de
   3001 van en `docker-compose.yml`, que es lo que lee el contenedor. El resultado pedido (los dos modos sin configuración
   manual) se cumple.
3. **`OrgRoleGuard` (criterio 5)** usa la identidad verificada y el rol **de la organización pedida**, leído de la base, y no
   el `orgRole` del token (§3.4).
4. **Organización obligatoria por defecto (criterio 7, endurecido).** Las rutas autenticadas exigen organización salvo
   `logout` y `pro/memberships`. Sin esto, omitir el header esquivaría la validación.
5. **Ruta pública extra (criterio 3):** `GET /health/liveness` en lugar de `/`, que era Swagger. `-Smoke` y `Wait-Http` se
   adaptan. Swagger queda en `/docs`, solo fuera de producción.
6. **Variable nueva `CORS_EXTRA_ORIGINS`**, opcional, para no romper el uso documentado desde la red local.
7. **Residuales para seguridad y el backlog:**
   - IDOR por `:id` (BACKLOG 3);
   - escrituras de `ConfigController` sin `ADMIN`, ahora autenticadas y con organización (BACKLOG 5);
   - `system/professionals` y los `lookup` por CUIT buscan en todas las organizaciones;
   - `x-mode` sigue en manos del cliente (BACKLOG 2);
   - los usuarios con `deletedAt` pueden iniciar sesión, aunque el guard les niega las organizaciones de las que fueron
     dados de baja;
   - `ProductionController` y `ReportingController` (no registrados) toman `userId` de la query: si alguien los
     registra, hay que pasarlos a `@CurrentUserId()`;
   - `@nestjs/axios` queda sin uso.
8. **`RIESGOS.md`** es local e ignorado (como en el 004): el criterio 23 se cumple en el archivo local.

## 12. Trazabilidad

| Criterio | Sección |
|---|---|
| 1 | 3.1 |
| 2 | 3.1 |
| 3 | 3.9 |
| 4 | 3.1 y 3.6 |
| 5 | 3.1 y 3.4 |
| 6 | 3.2 |
| 7 | 3.3 |
| 8 | 3.3 (fuera de alcance respetado) |
| 9 | 3.5 |
| 10 | 3.7 |
| 11 | 3.7 y 9.1 (`logging.interceptor.spec`) |
| 12 | 3.8 |
| 13 | 3.10 |
| 14 | 3.11, punto 8 |
| 15 | 3.11, puntos 6 y 7 |
| 16 | 3.11, puntos 3, 9 y 10 |
| 17 | 3.12 |
| 18 | 3.10 y 9.5 |
| 19 | 9.5, paso 5 |
| 20 | 9.1 |
| 21 | 9.4 |
| 22 | 5 y 9.5 |
| 23 | 4, "Documentación" |

VEREDICTO: APROBADO
