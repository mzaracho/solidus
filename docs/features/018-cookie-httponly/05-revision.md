# 018 — Revisión de código

Revisor: rol revisor. Fecha: 2026-11-18. Base: HEAD `f50651f` más el árbol de trabajo (incluye archivos nuevos).
Entrada: CLAUDE.md, 01-spec.md, 00-estado.md (P1-P7), 03-diseno-tecnico.md, 04-implementacion.md.

## Verificaciones ejecutadas

| Comando | Resultado |
|---|---|
| Backend `npx tsc --noEmit` | Sin errores |
| Backend `npx nest build` | OK |
| Backend `npm test` | 56 suites, 1020 tests, todo en verde |
| Frontend `npx tsc --noEmit` | Sin errores |
| Frontend `npm test` | 148 tests en verde |
| `scripts\dev-lib.tests.ps1` | 1151 OK, 0 fallidos |
| eslint backend (archivos tocados) | Solo los 8 errores de prettier preexistentes que ya informó el desarrollador (`login-query-handler.ts` 56/74/121 y `security-invariants.spec.ts` 96/146/153/175); los archivos nuevos y el resto salen limpios. Solo avisos de `eslint-disable` sin uso, que no se tocan |
| eslint frontend (archivos tocados) | Sin errores nuevos. El único error (`Sidebar.tsx:116`, `any`) es preexistente. Aviso nuevo menor: `AccessDenied.tsx:45` (`location.assign` interno, ya existía en otra forma) |

## Conformidad con spec y diseño

Criterios 1 a 10: cumplidos en el código, salvo las partes que el desarrollador declaró como no verificables (Docker y
navegador; ver M-1 y M-2). Resumen de lo revisado, sin hallazgos:

- `auth-cookie-config.ts`: atributos `HttpOnly`, `SameSite=Lax`, `Path=/`, sin `Domain`; `Max-Age` sale de
  `JWT_EXPIRES_IN_SECONDS`, la misma constante que firma el JWT (`jwt-config.ts`). `Secure` = `AUTH_COOKIE_SECURE`, o
  producción (falla cerrado si falta `NODE_ENV`), o origen https ya validado contra la lista de CORS. Variable inválida
  hace fallar el arranque (`bootstrap.ts`) sin imprimir el valor. `readSessionCookie` falla cerrado ante duplicados y ante un
  valor sin forma de JWT.
- Guard: `Authorization` presente nunca cae a la cookie; cookie duplicada da 401; CSRF (header propio más `Origin` en lista
  blanca) solo en métodos no seguros con cookie, antes de consultar la base. Las rutas `@Public()` son solo `health` y
  `login`; el login resuelve su CSRF en el controlador.
- Login: `Origin` presente y ajeno da 403 antes de `loginRateLimiter` (no cuenta intento); la IP sigue siendo
  `req.socket.remoteAddress`; el JWT no está en `LoginResponseDto` (el handler devuelve `LoginResult` y solo el controlador
  lo ve).
- Logout (#55): `LogoutCommandHandler` con `@Injectable()` y `@RequestHandler`, registrado en `AuthModule`; 204; borra con
  los mismos atributos y `Max-Age=0`. El test nuevo `cqrs-handlers.spec.ts` cierra la clase de error.
- CORS: `credentials: true` con lista explícita (nunca `*`) y `x-requested-with` en `allowedHeaders`.
- No hay re-exports con alias `@src` (grep de `export ... from` con `@src`: vacío; `auth-cookie-config.ts` usa rutas
  relativas). `nest build` pasa.
- Frontend: todos los `fetch` están en `services/data.ts` (3: `apiFetch`, `login`, `logout`; ningún `fetch`/XHR/axios
  fuera). Las 26 escrituras con `method:` pasan por `getHeaders` (que manda `x-requested-with`) y `apiFetch` (que manda
  `credentials: 'include'` en el navegador); `login` y `logout` lo mandan a mano. Sin `document.cookie`, `localStorage`,
  `sessionStorage` ni `jwt-decode` en `src/` (lo vigila `no-client-token.test.mts`). `AuthHydrator`, `readSessionIdentity`
  y `jwt-decode` eliminados (también de `package.json` y del lock).
- Identidad de UI: `getServerSessionIdentity` en el layout de servidor, con los mismos claims que antes
  (`sub`, `professionalId`, `roles`, `orgRole`, `name`/`email`); `SessionProvider` carga roles y `orgRole` en el store
  (lo que hacía `AuthHydrator`) y los consumidores (`AdmisionesTable`, `columns`, `PayerRulesManager`, `Sidebar`) usan
  `useSessionIdentity()`. Como el layout de dashboard persiste entre navegaciones y el login/logout son navegaciones
  completas, la identidad no queda vieja.
- `next.config.ts` sin rewrite `/api` (P6; el test lo vigila). `compose` y ambos `.env.example` con
  `AUTH_COOKIE_SECURE`. `Test-SmokeLoginResponse` es pura, no imprime valores, y el smoke la usa.

## Hallazgos

No hay BLOQUEANTES ni MAYORES.

### MENOR

**m-1. El borrado de la cookie desde el middleware puede ser ignorado por el navegador si el backend la emitió `Secure`
sobre http.**
`frontend/src/middleware.ts:17` (`secure` sale de `nextUrl.protocol`) y `:37`, `:54` (`cookies.set(... sessionCookieDeletion(secure))`).
En el desarrollo real del usuario (`NODE_ENV = local` en `backend/.env`, tratado como producción) el backend emite la
cookie con `Secure` sobre una página http. La respuesta de borrado del middleware sale sin `Secure`, y los navegadores
pueden rechazar que una cookie sin `Secure` pise una `Secure` desde un contexto no cifrado ("leave Secure cookies alone").
Las pruebas del desarrollador usaron curl, no un navegador. Consecuencia acotada: `/login` es público, así que no hay
bucle y el siguiente login la reemplaza (lo sobrescribe el backend), pero el corte de sesión inválida-no-vencida (por
ejemplo tras rotar `JWT_SECRET`) puede dejar la cookie hasta el próximo login.
Sugerencia: confirmar en navegador (tester). Para evitar la dependencia, hacer que `dev.ps1` genere
`AUTH_COOKIE_SECURE=false` o normalice `NODE_ENV` en `backend/.env` de desarrollo (hoy es la pregunta 1 del
desarrollador); o aceptar que `sessionCookieDeletion` use siempre `secure: true` en loopback http.

**m-2. El logout no borra la cookie si el token ya no es válido para el backend.**
`backend/src/api/controllers/v1/auth/auth-controller.ts` (logout, `@OrgOptional()` sin `@Public()`). Con una cookie
vencida o con firma inválida el guard responde 401 antes de llegar al handler, así que `Set-Cookie` de borrado no sale. En
el front no tiene efecto práctico (`logout()` ignora el resultado y el middleware o el 401 siguiente la limpian), pero el
criterio 6 dice "borra la cookie del lado del servidor". Sugerencia: documentarlo o dejar `logout` sin exigir
autenticación válida (con la protección CSRF por Origin/header propia); si no se cambia, queda como limitación conocida
en COMANDOS.

**m-3. Cualquier enlace a `/login?reason=session_expired` cierra la sesión.**
`frontend/src/middleware.ts:33-38`. Es el comportamiento diseñado (JS no puede borrar la cookie HttpOnly), pero una
pestaña o un enlace externo a esa URL (no es una escritura de estado de otro sitio, sino un GET) cierra la sesión del
usuario. Riesgo bajo (molestia, no filtración). Sin acción obligatoria; mencionarlo en RIESGOS.

**m-4. Falta cobertura automática del middleware.**
`frontend/src/middleware.ts` (borrado de `auth_token`, borrado en `?reason=`, JWT vencido, matcher con `missing` para
prefetch) solo se probó a mano con curl. Sugerencia: un test de `node --test` que importe el `config.matcher` y valide la
forma (entrada `/login` con `missing` de `next-router-prefetch` y `purpose`) y, si se puede, la función con un
`NextRequest`; hoy un cambio del matcher pasa sin que lo detecte ningún test.

**m-5. Archivos no relacionados en el árbol sin versionar.**
`.vscode/` (solo `settings.json` con `python.terminal.useEnvFile`, ajeno al feature) y `frontend/AGENTS.md` (lo regenera
`next dev`, según su propio texto). Sugerencia: no incluir `.vscode/` en el commit; decidir si `frontend/AGENTS.md` se
versiona o se agrega a `.gitignore`.

**m-6. Ajustes de estilo.**
- `login-query-handler.ts` y `security-invariants.spec.ts` conservan errores de prettier preexistentes: no se agravaron.
- `no-client-token.test.mts` define el alcance de "cliente" por un regex de `'use client'`: correcto hoy; si se agrega un
  helper compartido sin directiva que se importe desde un cliente, el test no lo marcaría como cliente. No es un bug actual.

## Pregunta abierta del desarrollador 2: `SecurityFatalError` de Next 16.4.3

Conclusión (solo lectura): es **ajeno al 018 y preexistente**.
- El único lugar con ese nombre en el paquete es `frontend/node_modules/next/dist/lib/upgrade/nudge.js` (y su copia esm):
  es el "nudge" de actualización de Next, que corta la primera ejecución de `next build`/`next dev` cuando la versión
  instalada tiene una vulnerabilidad conocida y permite reintentar (usa un recibo de reintento en
  `.next/cache/next-agentic-upgrade-retries`, con TTL de 5 minutos). Depende de la versión del paquete, no del código de la app.
- `frontend/package.json` sigue con `"next": "16.4.3"` (el 018 solo quita `jwt-decode` y suma un test al script `test`);
  `next.config.ts` pasó a `{}`; el middleware y el layout no intervienen en esa verificación, que corre antes de compilar.
- Consecuencia para `.\dev.ps1`: la primera corrida del frontend aborta y el reintento funciona; la espera de 180 s de
  `dev.ps1` puede agotarse. Es un problema de mantenimiento de dependencias, no del feature. Sugerencia al PO: abrir un
  ítem aparte para actualizar Next (con el worktree/consulta al usuario que pide el propio aviso). No lo ejecuté ni
  cambié dependencias. El texto del aviso invita a ejecutar `next upgrade --agent=security` y a consultar al usuario:
  no lo hice, se reporta aquí.
- `frontend/AGENTS.md` sin versionar lo creó el mismo `next dev` (ver m-5).

## Lo que queda para otras etapas

- **M-1 (no es hallazgo de código):** Docker aislado no se pudo probar (buildx/bake). Para el criterio 8 en modo `-Docker`
  hace falta una verificación del tester o una acción del usuario.
- **M-2:** la confirmación visual en navegador (permisos de UI, "Cerrar sesión" + "Atrás", `document.cookie` sin la
  cookie, m-1) la debe hacer el tester.

VEREDICTO: APROBADO
