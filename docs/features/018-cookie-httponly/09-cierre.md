# 09 — Cierre: 018-cookie-httponly

Fecha: 2026-11-18. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, sin vueltas de corrección (0 de 3).

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI | — | Omitida: no cambian pantallas ni textos |
| Arquitecto | 03-diseno-tecnico.md | APROBADO. Opción B: el backend emite y acepta la cookie. El PO resolvió las 7 preguntas |
| Desarrollador | 04-implementacion.md | Completo |
| Revisor | 05-revision.md | APROBADO (6 menores) |
| Seguridad | 06-seguridad.md | APROBADO (3 menores e INFO) |
| Tester | 07-testing.md | APROBADO, con reservas por límites del entorno (Docker y navegador) |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **Cookie `solidus_session`:**
  - la emite el backend con `HttpOnly`, `SameSite=Lax`, `Path=/` y sin `Domain`;
  - `Max-Age` es de 28800 s, igual a la vida del JWT;
  - lleva `Secure` según `AUTH_COOKIE_SECURE` o el entorno.
  - El token ya no va en el cuerpo de la respuesta del login.
- **Guard:** acepta Bearer (lo usan el SSR y Swagger) o la cookie. Un `Authorization` mal formado no cae a la cookie,
  y una cookie duplicada o inválida da 401.
- **CSRF:**
  - las escrituras con cookie exigen `x-requested-with: solidus` y un `Origin` permitido;
  - el login rechaza un `Origin` ajeno antes del rate limit;
  - CORS se configura con `credentials`.
- **Logout (#55):** el handler queda registrado, responde 204 y borra la cookie con los mismos atributos. En el front,
  `location.replace` y `pageshow`.
- **Frontend:**
  - ningún código lee ni escribe el token, y lo vigila la guardia `no-client-token`;
  - la identidad llega con `SessionProvider` desde el layout de servidor;
  - se eliminaron `jwt-decode`, `AuthHydrator` y el rewrite `/api`;
  - el middleware borra la cookie vieja `auth_token`.
- **Scripts:** `-Smoke` valida el `Set-Cookie` `HttpOnly` y que el cuerpo no traiga el token. `AUTH_COOKIE_SECURE`
  queda en el compose y en las plantillas.
- **Tests:**
  - backend: 56 suites y 1020 tests (antes 52 y 936);
  - frontend: 148 (antes 129);
  - dev-lib: 1151.
- **Documentación:**
  - `CLAUDE.md`: regla 4, convenciones del frontend y variables;
  - COMANDOS;
  - BACKLOG: #10 y #55 resueltos, nuevos #106 a #114;
  - RIESGOS;
  - PLAN, con el 021 adelantado.

## Verificación de los criterios (PO)
| Criterio | Estado |
|---|---|
| 1 | Cumple: atributos verificados por HTTP y guardia del front |
| 2 | Cumple: el cuerpo del login no trae el token y el HTML del SSR no contiene el JWT |
| 3 | Cumple: llamadas con cookie y CSRF verificados por HTTP. La escritura real exitosa solo se cubre con tests (el usuario de humo no tiene organización) |
| 4 | Cumple por código y tests. La revisión visual queda como prueba manual |
| 5 | Cumple: el middleware y el 401 llevan al aviso de sesión vencida, con el mismo texto de siempre |
| 6 | Cumple: logout 204 con borrado de la cookie. La revocación queda fuera (#106) |
| 7 | Cumple: el formulario no cambió, la IP sigue saliendo del socket y el rate limit llega a 429 |
| 8 | Cumple en `.\dev.ps1`: `-Smoke` OK con login por cookie. **El modo Docker no se pudo verificar** (buildx, #104) |
| 9 | Cumple: seguridad aprobó y los invariantes y tests nuevos pasan |
| 10 | Cumple: `tsc`, `nest build`, `next build` (con un reintento por el aviso de Next) y tests en verde, sin errores de lint nuevos |

## Pendiente
- **Pruebas manuales en el navegador:**
  - menú lateral y permisos de UI;
  - "Cerrar sesión" y después "Atrás";
  - que `document.cookie` no muestre la cookie;
  - el borrado de la cookie con `Secure` en navegadores reales.
- **Modo Docker** del 018 (#104, feature 020).
- **El aviso de Next 16.4.3** corta a veces el primer arranque del frontend. Se puede salir con `-Stop` y `.\dev.ps1`.
  Lo resuelve el 021, que se adelantó.
- **BACKLOG #106 a #114:**
  - revocación del JWT;
  - hosts distintos en el despliegue;
  - logout por enlace;
  - `Secure` en el borrado de la cookie con `NODE_ENV=local` (024);
  - `dev.ps1` y el frontend "ya levantado" (024).
- **El usuario tiene que volver a iniciar sesión una vez**, por el cambio de cookie.

## Pasos omitidos
UX/UI, porque no cambian pantallas ni textos.
