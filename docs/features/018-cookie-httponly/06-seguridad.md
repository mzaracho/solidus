# 06 — Seguridad: feature 018 (cookie HttpOnly, CSRF y logout)

Transcrito por el PO a partir del informe del agente de seguridad, que no pudo escribir el archivo. La revisión es
contra HEAD `f50651f` e incluye los archivos nuevos. El agente no modificó código ni dependencias, no levantó
`dev.ps1`, no tocó los puertos 3000 ni 3001 y no imprimió el `.env`.

## Comprobaciones ejecutadas
- **Backend:** `npx tsc --noEmit` sin errores; `npm test` con 56 suites y 1020 tests, todos en verde.
- **`npm audit --omit=dev`:**
  - el 018 no agrega dependencias: solo quita `jwt-decode`;
  - los hallazgos del audit son anteriores al 018:
    - backend: `proxy-addr` (crítico), `@nestjs/*`, `body-parser`, `multer`, `path-to-regexp`, `express`, `qs` y
      otros;
    - frontend: `next` y `source-map-js`;
  - van al feature 021 (#103), y no se corrió `npm audit fix`.
- **Secretos:** no aparecen en los archivos nuevos. Las plantillas y el compose solo tienen placeholders
  (`AUTH_COOKIE_SECURE: "${AUTH_COOKIE_SECURE:-false}"`).

## Hallazgos
No hay hallazgos de severidad CRÍTICA, ALTA ni MEDIA.

### MENOR-1: se puede cerrar la sesión de otro con un GET
- **Dónde:** `frontend/src/middleware.ts`, líneas 31 a 37.
- **Qué pasa:** `GET /login?reason=session_expired` borra `solidus_session`, así que un sitio ajeno puede cerrarle la
  sesión al usuario. Es una molestia, sin robo de sesión ni escalada.
- **Remediación:** borrar la cookie solo si el token ya venció o no se puede decodificar. Para el caso de un token
  inválido pero no vencido (por ejemplo, después de rotar `JWT_SECRET`), usar un marcador de un solo uso.

### MENOR-2: el atributo `Secure` del borrado puede no coincidir con el de la emisión
- **Dónde:** `middleware.ts:17` (`secure = nextUrl.protocol === 'https:'`) y `session.ts`
  (`sessionCookieDeletion`, `legacyCookieDeletion`).
- **Qué pasa:**
  - detrás de un proxy TLS, o con `NODE_ENV=local` (el backend emite con `Secure`), el `Set-Cookie` de borrado sale
    sin `Secure`;
  - el navegador puede ignorarlo, porque una cookie sin `Secure` no pisa a una con `Secure`;
  - con un token inválido pero no vencido, eso puede dejar al usuario en un bucle entre el login y "sesión vencida".
- **Explotable:** no.
- **Remediación:**
  - borrar con `secure: true`, salvo en `http://localhost` y `127.0.0.1`, o replicar el criterio del backend;
  - probar con `NODE_ENV=local`.

### MENOR-3: logout con la cookie vencida o inválida
- **Qué pasa:** el logout responde 401 y no emite el borrado de la cookie. La limpia el middleware, que depende de
  MENOR-2.
- **Remediación (opcional):** un logout `@Public()` con la misma verificación de `Origin` que el login, que solo borre
  la cookie.

### INFO
- **Revocación (P2):**
  - el logout solo borra la cookie, y el JWT sigue valiendo hasta que vence (8 h), también como Bearer;
  - la baja de un usuario sí corta el acceso de inmediato, porque el guard consulta `deletedAt` en cada request;
  - al BACKLOG: `User.sessionsRevokedAt` o un `jti` comparado contra `iat`.
- **`SameSite=Lax`** separa por sitio, no por origen: otros puertos de `localhost` y otros subdominios cuentan como el
  mismo sitio. Eso lo cubren la lista blanca de `Origin` y el header `x-requested-with`.
- **Cookie duplicada, que no es un JWT o de más de 4096 bytes:** la sesión se toma como inexistente y responde 401
  (falla cerrado). Un atacante del mismo sitio solo puede negarle el servicio a ese usuario.
- **Rate limit del 012:**
  - la IP sale de `req.socket.remoteAddress`, sin rewrite de Next ni `trust proxy`;
  - el 403 por `Origin` ocurre antes de contar el intento, así que no consume ni contamina los contadores;
  - queda el residual del 012: detrás del NAT de Docker, todos los usuarios comparten una IP.
- **SSR:**
  - el layout pasa a `SessionProvider` solo la identidad: `userId`, `name`, `email`, `organizationId`, `orgRole`,
    `professionalId` y `roles`;
  - la cookie se decodifica sin verificar la firma, solo para la UI;
  - el nombre y el email viajan en el payload RSC, así que esas páginas no se deben cachear en caches compartidos.

## Verificado sin hallazgos
- **Cookie:**
  - `HttpOnly`, `SameSite=Lax`, `Path=/`, sin `Domain`;
  - `Secure` según el entorno;
  - `Max-Age` de 28800 s, igual a la vida del JWT;
  - el nombre coincide entre front y back (`auth-cookie-sync.spec`);
  - con un `AUTH_COOKIE_SECURE` inválido el backend no arranca.
- **Token fuera del JavaScript del navegador:**
  - la respuesta de login no incluye el token;
  - el front no lee el cuerpo de esa respuesta;
  - la guardia `no-client-token` no deja usar `document.cookie`, `localStorage`, `sessionStorage` ni `jwt-decode`;
  - los logs no registran headers ni query, y las advertencias de CSRF no imprimen valores.
- **Guard:**
  - si llega `Authorization`, aunque sea vacío o mal formado, exige un Bearer válido y nunca cae a la cookie;
  - sin `Authorization` usa la cookie y exige CSRF antes de consultar la base;
  - la verificación del 005 es igual para el Bearer y para la cookie.
- **CSRF:**
  - las escrituras con cookie exigen `x-requested-with: solidus` y un `Origin` exacto de la lista blanca;
  - solo GET, HEAD y OPTIONS se tratan como seguros;
  - un `Origin` ausente o `null` da 403;
  - no hay method-override.
  - **CORS:** con lista explícita y `credentials`.
- **CSRF en el login:**
  - un `Origin` ajeno, también con formularios urlencoded, da 403 antes del rate limit;
  - un pedido sin `Origin` pasa: es para el smoke y `curl`, y los navegadores siempre lo mandan.
- **Logout:** borra la cookie con los mismos atributos y responde 204.
- **Rewrite `/api`:** se quitó y no quedan caminos alternativos al login.
- **`sanitizeFrom`:** bloquea las redirecciones abiertas.
- **Scripts:** `Test-SmokeLoginResponse` no imprime valores y limpia las variables con credenciales.

VEREDICTO: APROBADO
