# 005 — Seguridad del backend: JWT real, pertenencia a la organización, logs, CORS y dependencias

## Contexto
La auditoría (`docs/auditoria/BACKLOG.md`, P0) marca riesgos bloqueantes del backend. Este feature
toma los ítems 1, 7 y 8 de P0, el 9 de P1 y parte del 11. Cierra además los pendientes que dejó el 004.

Estado actual (verificado en el código el 2026-10-28):
- **Los JWT no se verifican.**
  - `JwtAuthGuard` (`guards/jwt-auth-guard.ts`) y `OrgRoleGuard` (`guards/org-role-guard.ts`) usan
    `jwtService.decode`.
  - `ApiKeyGuard` devuelve siempre `true`, y `BaseController` lo aplica a todos los controladores.
  - Hay un `VerifyTokenService` stub (`verify-token-module.ts`, `auth-guard-provider.ts`).
  - Se registran dos `JwtModule`, uno en `app-module.ts` y otro en `auth-module.ts`.
  - Cualquiera puede fabricar un token o directamente no mandarlo.
- **El usuario y la organización salen de headers del cliente** (`x-user-id`, `x-org-id`), así que
  un usuario autenticado puede operar sobre cualquier organización.
- **`LoggingInterceptor` loguea headers (incluido `Authorization`), body (incluida la contraseña del
  login) y respuestas completas** (incluido el token emitido), en nivel debug.
- **CORS está abierto:** `origin: true` con `credentials: true` (`config/app/cors-config.ts`), pese a
  que existe la variable `CORS_ORIGIN`.
- **Dependencias con vulnerabilidades conocidas:** `next` 16.1.3 (CVE crítico de DoS; se requiere
  16.4.3 o superior) y `axios` ^1.13.2 en el backend (se requiere 1.20 o superior).
- **`POST /api/v1/auth/login` sin el campo `user` responde 500** porque el handler lanza un `Error`
  plano (N-4 del 004).
- **El frontend:**
  - guarda el token en la cookie `auth_token`, escrita desde el cliente con un fallback
    `'mock_token'` y `max-age` de 24 h, cuando el token dura 8 h;
  - `services/data.ts` solo lee el token en el navegador, así que las páginas de servidor (por
    ejemplo `work-items/page.tsx`) llaman a la API sin token;
  - el login llama directo al backend en `NEXT_PUBLIC_API_BASE_URL`, lo que depende de CORS.
- **`bootstrap.ts`** tiene 2 errores de lint preexistentes (imports de Swagger sin usar).

## Historia de usuario
Como responsable de la plataforma, quiero que solo los usuarios autenticados con un token válido
accedan a la API, y únicamente a las organizaciones a las que pertenecen. También quiero que los logs
no guarden credenciales, que el navegador solo acepte orígenes conocidos y que las dependencias no
tengan vulnerabilidades críticas conocidas. Así el sistema puede salir de la máquina de desarrollo sin
estos riesgos.

## Criterios de aceptación

### Autenticación real (BACKLOG 1)
1. **Un solo `JwtModule`**, configurado con `jwtModuleAsyncOptions`. `JWT_SECRET` sigue siendo
   obligatorio y de 32 caracteres o más, y el backend no arranca sin él.
2. **Guard global de autenticación** (`APP_GUARD`):
   - verifica la firma y la expiración con `jwtService.verifyAsync`;
   - acepta solo el algoritmo configurado, sin `none`;
   - toda ruta de la API exige `Authorization: Bearer <token>` válido salvo las marcadas `@Public()`.
3. **Rutas públicas:** solo `POST /api/v1/auth/login`, más lo que el arquitecto justifique como
   imprescindible (por ejemplo, la ruta raíz que usa `-Smoke` para "Backend OK", sin datos sensibles).
   Si Swagger existe, queda deshabilitado en producción (`NODE_ENV=production`) o detrás de
   autenticación, a definir por el arquitecto.
4. **Respuestas del guard:**
   - sin token, con token mal formado, con firma inválida, expirado o con `alg` distinto: **401**;
   - el cuerpo es un mensaje genérico, sin detalles del error de verificación ni el token.
5. **Se eliminan** `ApiKeyGuard`, el `JwtAuthGuard` basado en `decode`, el `VerifyTokenService` stub y
   su módulo y provider. `OrgRoleGuard` deja de usar `decode` y usa el payload verificado por el guard
   global.
6. **Identidad del usuario:** sale de `sub` del token verificado. Si llega un header `x-user-id`
   distinto de `sub`, se ignora y se usa `sub`; en ningún caso se confía en el header. Ningún handler
   ni servicio vuelve a leer la identidad del usuario desde `x-user-id`.

### Pertenencia a la organización (mínimo de BACKLOG 2)
7. Si la petición indica una organización (`x-org-id` o el `organizationId` u `orgId` que use la ruta,
   según el relevamiento del arquitecto), el backend verifica que el usuario autenticado tenga vínculo
   activo con esa organización:
   - membresía (`OrganizationMember`), o
   - registro de `Professional` en esa organización.

   Si no lo tiene, responde **403**. Un usuario sin ninguna membresía, como el usuario de humo del
   004, recibe 403 en todo endpoint con organización y puede hacer login. Esto debe funcionar tanto
   si `x-org-id` llega como UUID como si llega como slug, porque el frontend hoy manda el slug en
   algunos casos. El arquitecto releva todos los casos.
8. Fuera de alcance de este criterio, y queda en BACKLOG 2 y 3:
   - deducir el modo (org o pro) del rol en lugar de `x-mode`;
   - verificar la pertenencia de cada recurso al operar por `:id`.

### Login (parte de BACKLOG 11 y N-4 del 004)
9. `POST /api/v1/auth/login` valida el body con un DTO y class-validator:
   - si faltan `user` o `password`, o no son strings: **400**;
   - con credenciales inválidas: **401** genérico, sin revelar si el usuario existe;
   - el handler no lanza `Error` plano.

   El rate limiting queda fuera de alcance.

### Logs sin secretos (BACKLOG 7)
10. **`LoggingInterceptor` y cualquier otro log del backend no registran:**
    - los headers `Authorization` ni `Cookie`;
    - campos `password`, `token`, `accessToken`, `secret` ni `jwt`, a ningún nivel de anidamiento,
      en bodies, queries ni respuestas;
    - el cuerpo de las respuestas de login.

    Se elige entre redactar (por ejemplo `"[REDACTED]"`) o no loguear el contenido, según la decisión
    del arquitecto. El nivel de log respeta el entorno: debug solo fuera de producción. Se quitan los
    `console.log` que vuelcan payloads en el código del backend.
11. **Test automático:** un login con una contraseña ficticia conocida no deja esa contraseña ni el
    token emitido en la salida capturada del logger.

### CORS (BACKLOG 9)
12. **CORS con lista blanca desde `CORS_ORIGIN`:**
    - formato definido por el arquitecto: lista separada por comas o JSON;
    - sin `origin: true`;
    - un origen fuera de la lista no recibe `Access-Control-Allow-Origin`;
    - si `CORS_ORIGIN` falta o está vacía en producción, el backend no arranca o rechaza todo origen
      (a definir), nunca permite todos;
    - `credentials` se mantiene solo si el diseño lo necesita.
13. **Los dos modos funcionan sin configuración manual:**
    - `dev.ps1` genera `CORS_ORIGIN` en `backend/.env` con los orígenes del frontend: modo desarrollo
      en `FRONTEND_PORT` y modo Docker en 3001, con `localhost` y `127.0.0.1`;
    - `docker-compose.yml` también lo define;
    - `.env.example` y `backend/.env.example` lo documentan con placeholders.

### Frontend (lo mínimo para que la app siga funcionando con JWT real)
14. **Token en las llamadas desde el servidor:** las llamadas a la API desde Server Components, o
    cualquier código que corra en el servidor, mandan el token de la cookie (por ejemplo, con
    `cookies()` de `next/headers`). Todas las pantallas que hoy funcionan siguen funcionando con un
    usuario válido.
15. **Sin `mock_token`:** el login ya no lo usa como fallback. Si la respuesta no trae token, muestra
    error y no crea la cookie. La duración de la cookie no supera la del token.
16. **Sesión vencida o inválida:** ante un 401 de la API (token vencido o inválido), el frontend borra
    la cookie y lleva a `/login`, en lugar de mostrar pantallas vacías o errores sueltos. Ante un 403
    de organización muestra un mensaje claro sin cerrar la sesión. Textos y comportamiento según el
    diseño de UX.

### Dependencias (BACKLOG 8)
17. **Versiones mínimas:**
    - `next` en 16.4.3 o superior dentro de la línea 16;
    - `eslint-config-next` alineado si corresponde;
    - `axios` del backend en 1.20 o superior, dentro de la línea 1.

    Los lockfiles quedan actualizados y `npm audit --omit=dev` no reporta vulnerabilidades críticas en
    esos paquetes. Si alguna versión mínima no existe en el registro o rompe el build, el desarrollador
    lo informa en lugar de forzarla.

### Regresión y calidad
18. **`.\dev.ps1 -Smoke`** da Backend OK, Frontend OK y Login OK, en modo desarrollo y en modo Docker.
19. **Prueba manual en el navegador:** login con un usuario válido; dashboard, atenciones y
    work-items cargan; una sesión vencida o adulterada redirige a login; un usuario sin membresía
    recibe 403 al consultar una organización.
20. **Tests automáticos del backend (Jest)** que cubran:
    - el guard global: sin token, firma inválida, expirado, `alg none`, ruta pública y token válido;
    - el reemplazo de `x-user-id` por `sub`;
    - la pertenencia a la organización: miembro, `Professional`, ajeno, y org por UUID y por slug;
    - el DTO del login: 400, 401 y 200;
    - la redacción de logs;
    - la configuración de CORS: origen permitido, no permitido y variable vacía.
21. **Calidad:**
    - `npx tsc --noEmit` sin errores en backend y frontend;
    - ESLint sin errores en los archivos tocados, incluida la corrección de los 2 errores
      preexistentes de `bootstrap.ts`;
    - `npm test` del backend en verde;
    - `npm run build` del frontend OK, en Docker con la CA extra del 004;
    - tests de `dev-lib` en verde si se toca `dev.ps1`.
22. **Datos intactos:** los conteos de la base (9 / 3 / 72 / 324 / 1483) son iguales antes y después.
    Sin schema nuevo salvo que el arquitecto lo justifique; en ese caso, con migración Prisma (regla 6).
23. **Documentación:**
    - `CLAUDE.md` (regla 4 actualizada: los JWT ya se verifican y la organización se valida contra
      las membresías);
    - `docs/auditoria/COMANDOS.md` (`CORS_ORIGIN`);
    - `RIESGOS.md` local, con los ítems S1, S2, S5 y S7 actualizados según corresponda;
    - `BACKLOG.md`, con los ítems 1, 7, 8 y 9 marcados como resueltos y el 2 y el 11 como parciales.

## Fuera de alcance
- Sesión en cookie `HttpOnly` emitida por el backend y refresh tokens (BACKLOG 10). La cookie sigue
  escribiéndose desde el cliente.
- Rate limiting del login (BACKLOG 11, parte de throttling).
- Deducir el modo desde el rol y verificar la pertenencia por recurso en cada `:id` (BACKLOG 2 y 3
  completos).
- `canLoadActivities`, ownership y `ConfigController` (BACKLOG 4 y 5), salvo que queden cubiertos
  por el guard global.
- `ValidationPipe` global con `whitelist` (BACKLOG 12) y filtros de error (BACKLOG 13), salvo lo
  necesario para el 400 del login.
- Actualizaciones mayores (Nest 11, Prisma 6, etc.).

## Riesgos
- **Romper la app:** hoy todo funciona sin verificar nada. Con el guard global, cualquier llamada
  que no mande el token (SSR, `test-suite`, scripts) empieza a dar 401. El arquitecto debe relevar
  todas las llamadas del frontend y de `dev.ps1`.
- **Slug y UUID en `x-org-id`:** si la validación de pertenencia solo acepta UUID, se rompen las
  pantallas que hoy mandan el slug.
- **CORS demasiado estricto:** puede romper el login, que el navegador hace directo al backend.
  Hay que probar desde `localhost` y `127.0.0.1` en ambos modos.
- **Actualizar `next`:** un cambio de versión dentro de la 16 puede cambiar el comportamiento de
  Turbopack, el middleware o los rewrites. Hay que verificar con un build completo y en Docker.
- **Testing sin escribir en la base:** para probar la pertenencia hace falta un usuario con
  membresía. El tester puede firmar en memoria tokens de prueba con el `JWT_SECRET` local para
  usuarios existentes, solo leyendo ids, sin crear filas ni imprimir el secreto ni los tokens. Para
  el login real usa el usuario de humo.
- **Logs existentes:** los logs viejos de contenedores pueden contener contraseñas ya registradas.
  Se recomienda recrear los contenedores. No se borran volúmenes.

## Pasos del flujo
- Requiere UX/UI: **sí, acotado** (criterios 15 y 16: errores del login, sesión vencida y acceso
  denegado a la organización).
- Requiere seguridad: **sí**.
- Arquitecto: **sí**.
- Documentador: **sí**.
- Cambios de schema: no previstos.
- Commit y push: autorizados por el usuario cuando revisor, seguridad y tester aprueben (sin force).

## Salvaguardas vigentes
- Sin seeds ni SQL de escritura.
- Nunca escribir `BORRAR` en `-Seed`.
- Sin `down -v`, `prune` ni borrar volúmenes.
- No tocar el puerto 3000 (coach-claudio, pm2). El `.env` local tiene `FRONTEND_PORT=3002`.
- No imprimir valores del `.env`.
- Sin stash, reset ni checkout.
- Regla 12 con `.claude/settings.json`.
