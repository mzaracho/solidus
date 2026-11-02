# 06 — Revisión de seguridad: 005-seguridad-backend

> Autor: agente de seguridad. El agente no pudo escribir el archivo en su entorno, así que el PO transcribe su
> informe sin cambios de fondo. Solo lectura: no se modificó código, no se ejecutó `dev.ps1`, no se tocó el `.env`,
> no se levantó el stack, no hubo SQL, stash, reset, checkout, commit ni push.
> Criterio: la regla 4 de `CLAUDE.md` y el alcance de la spec (autenticación, organización, logs, CORS,
> dependencias y sesión en el frontend).

## Comandos ejecutados
| Comando | Resultado |
|---|---|
| backend: `npx tsc --noEmit` | Sin errores |
| backend: `npx jest` | 12 suites, 134 tests en verde |
| backend: `npm audit --omit=dev` | 15 vulnerabilidades (1 crítica, 7 altas, 7 moderadas), todas preexistentes de Nest 10 y express (ver H-2). `axios` 1.20.0 no figura. |
| frontend: `npm audit --omit=dev` | 1 alta: `source-map-js` (ver H-3) |
| Lockfiles | `next` 16.4.3, `eslint-config-next` 16.4.3, `axios` 1.20.0 en `backend/package-lock.json` (en HEAD era 1.13.2). `jsonwebtoken` 9.0.3, `@nestjs/jwt` 11.0.2, `bcrypt` 6.0.0. El frontend no depende de `axios`. |
| `git diff --ignore-all-space --ignore-cr-at-eol .claude/settings.json` | Vacío: solo cambia el fin de línea y no hay contenido nuevo (regla 12 OK). |
| Búsqueda de secretos en archivos modificados y sin trackear | Solo valores ficticios e IPs `192.0.2.x`. Sin hallazgos. |

## Resultado por punto
1. **Autenticación: OK.**
   - Guard global con `verifyAsync`, `algorithms: ['HS256']`, `issuer` y `audience` fijos.
   - Solo `Bearer` de tres segmentos y hasta 4096 caracteres; exige `sub` UUID y `exp` numérico.
   - Todo fallo da el mismo 401 genérico, sin detalle ni token.
   - `@Public`: `POST v1/auth/login` y `GET /health/liveness`; este último devuelve solo `{status:'ok'}`.
   - Swagger en `/docs` solo con `NODE_ENV` igual a `development` o `test`. Cualquier otro valor, o su ausencia,
     cuenta como producción (falla cerrado).
   - El token dura 8 h y la cookie del frontend se limita a `min(exp, 8 h)`.
2. **Identidad: OK.** `x-user-id` se pisa con `sub`. `security-invariants.spec.ts` exige que solo aparezca en el
   guard, y los controladores usan `@CurrentUserId()` después de `@Query`/`@Body`.
3. **Pertenencia a la organización: OK.**
   - Se validan `x-org-id`, y `organizationId` y `orgId` en query y body.
   - Da 403 si el valor no es string (array, objeto) o no es UUID; los valores se normalizan.
   - Si hay varias fuentes distintas, todas deben ser accesibles: el body no puede pasar por encima del header.
   - El vínculo es `OrganizationMember`, o `Professional` con `deletedAt: null` y `status: 'ACTIVE'`. No hay caché, y
     el mismo 403 vale exista o no la organización.
   - `@OrgOptional` solo en `logout` y `pro/memberships`; este último filtra por `sub`.
4. **`OrgRoleGuard`: OK.** El rol sale de la base para cada organización pedida; si falta o es null, da 403. Los
   guards globales corren antes que los de controlador.
5. **Login: OK (ver M-1).** DTO estricto (`123` o `{}` dan 400, con `MaxLength`). Un usuario inexistente pasa
   por un `bcrypt.compare` contra un hash ficticio, y el 401 es genérico.
6. **Logs: OK (ver B-2 y B-3).**
   - Redacción recursiva (profundidad 8, arrays, ciclos) con la regex
     `pass|token|secret|jwt|authorization|cookie|api[-_]?key`.
   - El interceptor no loguea headers ni cuerpos de respuesta, y el debug va solo fuera de producción.
   - `console.*` queda solo en `logger.ts`.
7. **CORS: OK.**
   - Lista blanca con regex estricta, sin `*` ni path; una entrada inválida no deja arrancar.
   - En producción no arranca sin `CORS_ORIGIN`. `credentials:false`, sin `x-user-id` en los headers permitidos.
   - `CORS_EXTRA_ORIGINS` se valida igual, también en `dev-lib`.
8. **Frontend: OK (ver M-3).**
   - Sin `mock_token`, `localStorage` ni `sessionStorage`; el token no aparece en logs ni URLs.
   - `sanitizeFrom` acepta solo rutas internas y rechaza `//`, `\`, `://`, caracteres de control, `javascript:`,
     `data:` y los prefijos `/login`, `/api` y `/sin-acceso`, con un máximo de 200 caracteres. No hay open redirect.
   - Un 401 borra la cookie y redirige; un 403 de organización lleva a `/sin-acceso`.
   - El middleware descarta tokens vencidos o sin `exp`.
9. **Scripts y config: OK.** `.env.example` solo con placeholders; `Get-DevCorsOrigin` arma `localhost` y
   `127.0.0.1`; no se imprimen secretos.
10. **Dependencias:** ver H-2 y H-3.
11. **Secretos:** sin hallazgos.

## Hallazgos

### Críticos y altos dentro del alcance
Ninguno.

### Medios
- **M-1: el login y el guard aceptan usuarios con `User.deletedAt`.** Se aceptó en el diseño (§11.7).
  - Archivos: `login-query-handler.ts:72` (`findUnique` sin filtrar `deletedAt`) y `authentication-guard.ts:68`.
  - Impacto: un usuario dado de baja puede iniciar sesión y conserva acceso a las organizaciones donde su vínculo
    siga activo.
  - Recomendación: responder el mismo 401 genérico (con el `bcrypt` ficticio) y chequear `User.deletedAt` en
    `OrgAccessService`.
- **M-2: residuales de autorización fuera de alcance (BACKLOG 2, 3 y 5).**
  - IDOR por `:id` en `org-controller.ts`, `config-controller.ts` y `activity-controller.ts` (`GET :id`).
  - `x-mode` sigue en manos del cliente.
  - `GET /system/professionals?cuit=` y los `lookup` por CUIT devuelven datos personales de todas las
    organizaciones.
  - Las escrituras de `ConfigController` no exigen ADMIN.
  - Recomendación: priorizarlos en el próximo feature.
- **M-3: cookie de sesión sin `HttpOnly`.** `LoginForm.tsx:74`. Un XSS puede leer el JWT. Fuera de alcance
  (BACKLOG 10). Mitigaciones actuales: `SameSite=Lax`, `Secure` con https, `max-age` ≤ 8 h, sin
  `dangerouslySetInnerHTML`.
- **M-4: sin rate limiting en el login.** `auth-controller.ts:19`. Fuera de alcance. Recomendación:
  `@nestjs/throttler` y bloqueo progresivo.

### Bajos
- **B-1:** `ProductionController` y `ReportingController` toman `userId` de la query. Hoy no están registrados
  (404). Recomendación: migrarlos a `@CurrentUserId()` o borrarlos, y agregar un test que lo vigile.
- **B-2:** los filtros de error responden y registran `JSON.stringify(exception)` (`http-filter.ts:16`,
  `global-filter.ts:15`, `axios-filter.ts:44`). Con Prisma expone `code`, `meta` y `clientVersion`, y puede
  incluir valores del `where`. Es preexistente (BACKLOG 13).
- **B-3:** las respuestas fallidas, incluidos los 401 y 403 de los guards, no quedan en el log
  (`logging.interceptor.ts:43`, m-1 del revisor). Recomendación: loguear método, ruta, status y duración.
- **B-4:** el límite del body es de 50 MB por defecto y se aplica antes del guard (`body-parser-config.ts:8`).
  Recomendación: bajarlo a 1–2 MB.
- **B-5:** `.vscode/` está sin trackear. Es inofensivo; no incluirlo en el commit.

### Informativos
- **H-2:** el backend tiene 15 vulnerabilidades preexistentes de Nest 10 y express 4. La crítica es
  `proxy-addr`, que no es explotable sin `trust proxy`, y el código no lo usa. Las altas son de
  `platform-express`, `body-parser`, `multer`, `path-to-regexp`, `lodash`, `js-yaml` y `swagger`. Corregirlas
  exige Nest 11 o superior. Recomendación: un feature de actualización.
- **H-3:** el frontend tiene 1 alta en `source-map-js`, que solo afecta al build. Recomendación: `npm audit fix`.
- **H-4:** `x-user-id` se reescribe como defensa en profundidad. El middleware decodifica la cookie sin verificar
  la firma, pero solo para la interfaz: la autorización real es del backend.

VEREDICTO: APROBADO
