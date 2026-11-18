# 018 — Testing: sesión en cookie `HttpOnly` y logout real

Autor: tester. Fecha: 2026-11-18. Solo lectura de código; no se modificó producción ni se hizo commit. Las credenciales de
humo se leyeron del `.env` dentro de scripts sin imprimirlas; de las cookies solo se muestran atributos (`<VALOR>`).

## 1. Calidad (línea base)

| Verificación | Resultado |
|---|---|
| Backend `npx tsc --noEmit` | OK, sin errores |
| Backend `npx nest build` | OK, existe `dist/src/api/main.js` |
| Backend `npm test` | OK: **56 suites, 1020 tests** |
| Frontend `npx tsc --noEmit` | OK |
| Frontend `npm test` | OK: **148 tests** |
| Frontend `npm run build` | 1.ª corrida con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`: compila y luego aborta con `SecurityFatalError` (aviso de Next 16.4.3, exit 1). Reintento con el mismo comando: **OK** (exit 0). No se ejecutó `next upgrade` |
| `scripts\dev-lib.tests.ps1` (existe) | OK: **1151 OK, 0 fallidos** |
| Lint | No se re-corrió (lo cubren 04 y 05) |

Para el PO, el aviso de Next pide preguntar al usuario una vez: "Would you like me to run the 'security' upgrade in the
background in a separate Git worktree? I can use the current checkout if you prefer." No lo ejecuté ni lo contesté.

## 2. Arranque real (`.\dev.ps1` + `.\dev.ps1 -Smoke`, misma invocación)

| Corrida | Resultado |
|---|---|
| 1.ª (`.\dev.ps1; .\dev.ps1 -Smoke`) | `dev.ps1` imprimió "Frontend responde" (35 s), pero justo después el proceso `next dev` ya no existía: la ventana de PowerShell del frontend quedó viva (`-NoExit`) y nadie escuchaba en 3002. `-Smoke`: Backend OK, **Frontend FALLO**, Login OK, salida 7 |
| 2.ª (`.\dev.ps1` otra vez, sin parar) | **No lo resuelve**: avisa "El entorno ya está levantado (ventanas vivas). No se relanza nada" y el 3002 sigue sin responder (`-Smoke` otra vez salida 7) |
| 3.ª (`.\dev.ps1 -Stop; .\dev.ps1; .\dev.ps1 -Smoke`) | **Todo OK**: Backend OK, Frontend OK (3002), **Login OK** (cookie `HttpOnly`, sin token en el cuerpo), salida 0 |

Precisión sobre `SecurityFatalError`:
- En la primera corrida tras el `npm run build` fallido no pude leer la ventana de `next dev`, y `frontend/.next/dev/logs/next-development.log`
  no registra el error. Es consistente con el aborto de un solo uso de Next 16.4.3, pero no lo puedo afirmar.
- Pasó en la primera corrida de `next build` y, aparentemente, de `next dev`; no en todas las corridas anteriores del
  desarrollador. La causa está en la versión de Next (#103), no en el código del 018.
- Para el uso diario: no bloquea, pero puede hacer perder un arranque. Receta: `.\dev.ps1 -Stop` y luego `.\dev.ps1`.
- Hallazgo menor de `dev.ps1`: `Wait-Http` dio OK y el frontend murió igual; y el "ya levantado" mira la ventana, no el
  puerto. Se sugiere abrir un ítem.

## 3. Pruebas por HTTP (backend 8080, frontend 3002, usuario de humo)

`NODE_ENV = local` en `backend/.env` (el backend lo trata como producción), por eso la cookie sale con `Secure`.

| # | Caso | Resultado |
|---|---|---|
| H1 | Login con Origin permitido | 201. `Set-Cookie: solidus_session=<VALOR>; Max-Age=28800; Path=/; Expires=+8 h; HttpOnly; Secure; SameSite=Lax`. Sin `Domain`. **`Secure` sale presente** (por `NODE_ENV=local`) |
| H2 | Cuerpo del login | Claves: `id, type, name, email, settings, theme, notifications, roles, orgRole, professionalId`. Sin `token`; ninguna cadena `eyJ` |
| H3 | Login con Origin `http://localhost:3000` | 403 `forbidden`, sin `Set-Cookie` |
| H3b | Login sin Origin (cliente no navegador) | 201 (diseño: solo se rechaza un Origin presente y ajeno) |
| H4 | Preflight desde `localhost:3002` y desde `127.0.0.1:3002` | 204, `Allow-Origin` del origen, `Allow-Credentials: true`, `Allow-Headers` con `x-requested-with, x-org-id, x-mode` |
| H4b | Preflight con origen ajeno | 204 sin `Allow-Origin` (el navegador lo bloquea) |
| H5 | `POST /api/activity` con cookie, sin `x-requested-with` | 403 `forbidden` |
| H6 | Con header pero `Origin` ajeno | 403 `forbidden` |
| H6b | Con header y sin `Origin` | 403 `forbidden` |
| H6c | Con header y `Origin` permitido | pasa el CSRF: 403 `org-access-denied` (el usuario de humo no tiene organización; no se alcanza el handler ni se escribe nada) |
| H7 | `GET /api/pro/memberships` con cookie / sin credenciales | 200 / 401 |
| H8 | Bearer con el mismo JWT | 200. Escritura con Bearer sin `x-requested-with`: no aplica CSRF (llega a `org-access-denied`) |
| H9 | `Authorization` Basic, `Bearer xxx` o `Bearer ` vacío + cookie válida | 401 en los tres: no cae a la cookie |
| H10 | Cookie duplicada; cookie `abc.def.ghi` | 401 (falla cerrado) |
| H11 | Rate limit: intentos fallidos con un usuario inexistente | 401, 401, **429** (el límite por usuario cuenta). El límite por IP (20) no se agotó a propósito para no bloquear al usuario de humo: solo lo cubren `login-rate-limit.spec.ts` y la lectura de `req.socket.remoteAddress` |
| H12 | Logout con cookie, sin `x-requested-with` | 403 |
| H13 | Logout con cookie, header y Origin | **204**, `Set-Cookie: solidus_session=<VALOR>; Max-Age=0; Path=/; Expires=pasado; HttpOnly; Secure; SameSite=Lax` (mismos atributos que la emisión) |
| H14 | Logout sin sesión / con cookie inválida | 401 / 401 y **sin `Set-Cookie`** (m-2 / MENOR-3 confirmado) |
| H15 | `GET /v1/auth/logout` | 404 |
| M1 | Front sin cookie en `/org-x/dashboard` | 307 a `/login?from=%2Forg-x%2Fdashboard` |
| M2 | JWT vencido (armado con firma de prueba) | 307 a `/login?reason=session_expired&from=…` y `Set-Cookie: solidus_session=; Max-Age=0; HttpOnly` |
| M3 | Vencido + `auth_token` vieja | además borra `auth_token` (`Max-Age=0`) |
| M4 | Solo `auth_token` vieja | 307 a login normal (sin aviso) y borra `auth_token` |
| M5 | `/login?reason=session_expired` con cookies | 200 y borra `solidus_session` y `auth_token`. Sin `reason`: no borra |
| M6 | Mismo `/login?reason=…` con header `next-router-prefetch` | 200 y **no borra** (matcher) |
| M7 | Cookie válida: ruta protegida / `/` / `/sin-acceso` | 200 / 307 a `/sin-acceso` (el usuario no tiene organización) / 200 |
| S1 | HTML de SSR de `/org-x/dashboard`, `/sin-acceso`, `/org-x/org/admisiones` con cookie válida | 200; el JWT no aparece, ni ninguna cadena `eyJ…` |

Atención a la sesión del front: el `Set-Cookie` de borrado del middleware (M2, M3, M5) sale **sin `Secure`**, mientras que
el backend emite con `Secure` (y su logout también lo borra con `Secure`).

### Escenario m-1 (cookie `Secure` inválida-no-vencida, jar de curl)
- Jar con `solidus_session` `Secure`, JWT con `exp` futuro y firma inválida. La ruta protegida da 200 (el middleware solo
  decodifica); la API respondería 401, lo que en el navegador lleva a `/login?reason=session_expired`.
- Con `curl` 8.22 (trata `localhost` como contexto seguro) el borrado sin `Secure` **sí** limpió la cookie; después, el
  login dio 201 y la ruta protegida y la API dieron 200.
- Caso de borrado ignorado por el navegador (se simula omitiendo el paso del borrado: el jar conserva la cookie
  inválida): `/login` es público, el login nuevo (201) **reemplazó** la cookie (una sola `solidus_session`, valor distinto)
  y la API dio 200. **No hay bucle.**
- Lo que no se puede confirmar sin navegador es si Chrome/Firefox/Safari aceptan el borrado sin `Secure` sobre una cookie
  `Secure` (m-1 / MENOR-2). Impacto acotado a un retraso hasta el próximo login.

## 4. Docker aislado (`-p solidus018`, puertos 3011/8081/5434)

Intento único, con override `.dev/compose.018.yml` y `CORS_EXTRA_ORIGINS` en la sesión del shell: **falló igual** con
`additional privileges requested: pass "--allow=fs.read=frontend\\Dockerfile"` (Compose 5.6.1, bake). No cambié la
configuración de Docker. **No verificable.** Limpieza: `down -v` solo de `solidus018` (nada que borrar), override borrado;
`docker ps -a` solo muestra `healthops-gem-db-1`, y no quedan volúmenes, redes ni imágenes `solidus018`.

## 5. Base del usuario y cierre

Conteos por tabla (solo SELECT, consulta del procedimiento de baseline de 016) antes y después de toda la sesión:
**idénticos** (17 tablas, p. ej. `WorkItem=324`, `Patient=72`, `User=9`). `.\dev.ps1 -Stop`: 8080, 3002 y 5433 libres; el 3000
(proceso ajeno, pm2) no se tocó; el 3001 tampoco.

## 6. Criterios de aceptación

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Cookie `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age`=JWT, `Secure` en producción; sin `document.cookie`/`localStorage`/`sessionStorage`; guardia | H1 (atributos reales, `Max-Age=28800`, `Secure` por `NODE_ENV=local`); `no-client-token.test.mts` (14) y `security-invariants` en verde | **Cumple** |
| 2 | El token no llega al JS | H2 (cuerpo sin `token`), S1 (HTML sin JWT), smoke valida ambos | **Cumple** |
| 3 | Llamadas con cookie, CSRF, org/modo, reglas 4 y 5 | H4 a H10, tests `all-routes-auth`, `org-isolation`, guard con cookie; `x-org-id`/`x-mode` en `Allow-Headers` | **Cumple** (escritura real exitosa con cookie no probada: sin base descartable) |
| 4 | Identidad en la UI sin leer el JWT | Tests de `session`/`SessionProvider`, SSR 200 sin JWT | **Cumple en código/tests**; lo visual queda como prueba manual |
| 5 | Expiración (middleware, 401 del cliente, texto) | M1 a M6; tests del front | **Cumple** (el 401 del cliente: solo por tests) |
| 6 | Logout real y handler registrado | H12 a H15; `cqrs-handlers.spec.ts` en verde; "Atrás": manual | **Cumple**, con la limitación m-2: con token vencido/inválido el logout da 401 y no emite el borrado |
| 7 | Login igual; rate limit | Smoke OK; H11 (límite por usuario activo); login directo al backend; tests del 012 | **Cumple** (límite por IP solo por tests/código) |
| 8 | `dev.ps1`, `-Smoke`, `-Docker` | `.\dev.ps1` + `-Smoke` OK (3.ª corrida; ver §2); dev-lib 1151 OK; **Docker no verificable** (buildx) | **Cumple en desarrollo; Docker sin verificar** (limitación del entorno) |
| 9 | Seguridad y tests nuevos | 56 suites / 1020 en verde, con los tests de cookie, CSRF, logout y ausencia de token | **Cumple** |
| 10 | Calidad | tsc y `nest build` backend OK; tsc, `npm test` y `npm run build` frontend OK (build tras reintento) | **Cumple** |

## 7. Hallazgos (ninguno bloqueante)

1. **No hay bugs del 018 que reproducir.**
2. **`dev.ps1` primera corrida:** el frontend muere tras "Frontend responde" y un segundo `.\dev.ps1` no lo relanza (§2).
   Probable causa: el aviso de Next 16.4.3 (#103). Recuperación: `-Stop` y `.\dev.ps1`.
3. **m-1:** el borrado del middleware sale sin `Secure` con `NODE_ENV=local` (confirmado en M2, M3 y M5). Sin bucle (probado).
4. **m-2 / MENOR-3:** logout con token inválido, 401 sin borrado (confirmado en H14).
5. **MENOR-1 / m-3:** `GET /login?reason=session_expired` borra la cookie (M5); es una molestia, no un robo.
6. **Discrepancia con 04:** 04 dice que el logout real sale sin `Secure`; en esta corrida sale con `Secure` (mismos atributos que la emisión).
7. **m-4:** sigue sin test automático del middleware; lo cubrí con HTTP real.

## 8. No pude verificar

- **Docker** (`-Docker`, `AUTH_COOKIE_SECURE=false` del compose, SSR con Bearer desde el contenedor): buildx pide privilegios.
- **Navegador:** Sidebar con el nombre, enlaces restringidos, botón Eliminar y "Eliminar pagador", "Ver como",
  "Cerrar sesión" + "Atrás" (bfcache, `pageshow`), `document.cookie` sin la cookie en DevTools, y el comportamiento real
  de m-1 en Chrome, Firefox y Safari (Safari no acepta `Secure` sobre http).
- **Escrituras reales con cookie** (editar una atención) y el 401 del cliente de punta a punta: sin base descartable.
- **Rate limit por IP** hasta el 429 (no se agotó para no bloquear al usuario de humo).
- **Pruebas manuales sugeridas:** login, DevTools > Application (`HttpOnly`), `document.cookie`, navegación por los tres
  roles, "Cerrar sesión" + "Atrás", crear a mano `auth_token` y recargar, y rotar `JWT_SECRET` con una sesión abierta (m-1).

VEREDICTO: APROBADO
