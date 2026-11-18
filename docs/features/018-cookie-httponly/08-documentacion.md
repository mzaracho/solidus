# 018 — Documentación: sesión en cookie `HttpOnly` y logout real

Autor: documentador. Fecha: 2026-11-18. Solo documentación; no se tocó código, `.env` ni se hizo commit.
Fuentes: 00-estado, 01-spec, 03-diseno-tecnico, 04-implementacion, 05-revision, 06-seguridad, 07-testing y `git diff`.

## Qué cambió realmente
- El backend emite la cookie `solidus_session` (`HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=28800`, `Secure` según
  `AUTH_COOKIE_SECURE`/entorno) y la acepta junto con Bearer. El login ya no devuelve `token`.
- CSRF: las escrituras con cookie exigen `x-requested-with: solidus` y un `Origin` de `CORS_ORIGIN`; el login rechaza un `Origin` ajeno.
- Logout real (204, borra la cookie); el JWT sigue válido hasta `exp`.
- Front: sin lectura ni escritura del token en el cliente; identidad con `SessionProvider`/`useSessionIdentity()`;
  `getHeaders()` ya no manda `Authorization` en el cliente ni `x-user-id`; sin rewrite `/api`.
- Nueva variable `AUTH_COOKIE_SECURE`. `JWT_EXPIRES_IN_SECONDS` es constante de código, no variable.

## Archivos modificados
| Archivo | Cambio |
|---|---|
| `.claude/CLAUDE.md` | Regla 4: sesión en cookie (018) y pendientes actualizados (se quita "cookie HttpOnly"; quedan revocación y hosts distintos); convenciones del front (`data.ts`, sesión, mismo host); variable `AUTH_COOKIE_SECURE`; conteos: backend 56 suites / 1020 tests, front 148, dev-lib 1151 |
| `docs/auditoria/COMANDOS.md` | `-Smoke` valida la cookie; `AUTH_COOKIE_SECURE`; CORS con `credentials: true`; sección nueva "Sesión en cookie `HttpOnly`" (cookie, CSRF, Swagger con "Authorize", logout, mismo host, Docker sin verificar); errores comunes: `-Smoke` con Frontend FALLO por el aviso de Next 16.4.3 (`-Stop` y `.\dev.ps1`; no ejecutar `next upgrade`) y login 403; conteo de tests del front |
| `docs/auditoria/BACKLOG.md` | #10 y #55 RESUELTOS; #104 y #103 ampliados (sin duplicar); sección "Candidatos surgidos del feature 018" con #106 a #114 |
| `docs/features/PLAN-pendientes.md` | Filas 12 (`f50651f`) y 13 (Hecho, hash pendiente); 021-audit-fix pasa a ser el siguiente (órdenes 14 a 16 renumerados) con nota; ítems nuevos asignados a 024, 028, 031+ |
| `docs/auditoria/RIESGOS.md` (local, ignorado por git) | S9 y M-3 marcados como mitigados por el 018 con residuales; la línea de JWT sin revocación aclara que el logout ya es real |

No se modificó `README.md` (no menciona la sesión ni el login; no verificado más allá de esto) ni existe CHANGELOG.

## Números nuevos de BACKLOG (#106 a #114)
| # | Ítem | Feature |
|---|---|---|
| 106 | Revocación del JWT antes de `exp` (MEDIA) | 031+ |
| 107 | Front y API en hosts distintos (MEDIA, despliegue) | 031+ |
| 108 | `GET /login?reason=session_expired` borra la cookie | 031+ |
| 109 | Borrado de cookie sin `Secure` si el backend la emite con `Secure` | 024 |
| 110 | Logout con token inválido: 401 sin borrar; logout `@Public()` con `Origin` | 031+ |
| 111 | Middleware y `matcher` sin test automático | 028 |
| 112 | `frontend/AGENTS.md` lo regenera `next dev` | 024 |
| 113 | `dev.ps1`: "ya levantado" por ventana y `Wait-Http` con frontend que muere | 024 |
| 114 | Páginas SSR con nombre/email no deben cachearse en caches compartidos (despliegue) | 031+ |

Sumados sin número nuevo: Docker del 018 al #104 (020); aviso `SecurityFatalError` y `proxy-addr` al #103 (021).

## Pendiente de verificar
- Docker (buildx) y navegador (Sidebar, "Cerrar sesión" + "Atrás", `document.cookie`): ver 04 §6 y 07 §8.
- El hash del commit del 018 en `PLAN-pendientes.md` lo agrega el PO.
