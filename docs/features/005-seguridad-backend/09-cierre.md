# 09 — Cierre: 005-seguridad-backend

Fecha: 2026-11-02. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, sin vueltas de corrección (0 de 3).

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI | 02-ux.md | APROBADO |
| Arquitecto | 03-diseno-tecnico.md | APROBADO |
| Desarrollador | 04-implementacion.md | Completo: 13 de 13 pasos. La sesión del 2026-10-29 se interrumpió y el desarrollador la retomó el 2026-11-02 |
| Revisor | 05-revision.md | APROBADO (6 menores y 5 sugerencias) |
| Seguridad | 06-seguridad.md | APROBADO (sin críticos ni altos; 4 medios fuera de alcance o aceptados) |
| Tester | 07-testing.md | APROBADO |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **Autenticación real:**
  - un solo `JwtModule`;
  - guard global que verifica con HS256, `issuer`, `audience` y `exp`, y responde un 401 genérico;
  - `@Public` solo en el login y en `GET /health/liveness`;
  - se borraron los guards y stubs viejos.
- **Identidad y organización:**
  - la identidad sale de `sub` (`@CurrentUserId()`) y `x-user-id` se ignora;
  - `OrgAccessGuard` valida todas las fuentes de organización contra `OrganizationMember` o `Professional`
    activo, y responde 403 si no hay vínculo;
  - `@OrgOptional` solo en `logout` y `pro/memberships`;
  - `OrgRoleGuard` toma el rol de la base.
- **Login:** DTO estricto (400), 401 genérico sin enumeración por tiempo y sin `Error` plano.
- **Logs:**
  - redacción recursiva de credenciales;
  - no se loguean headers ni respuestas;
  - nivel debug solo fuera de producción;
  - sin `console.*` con payloads.
- **CORS:**
  - lista blanca desde `CORS_ORIGIN`, más `CORS_EXTRA_ORIGINS` opcional sin comodines;
  - en producción el backend no arranca si falta la lista;
  - `credentials:false`.
- **Swagger:** en `/docs`, solo fuera de producción.
- **Scripts:**
  - `dev.ps1` genera `CORS_ORIGIN`, y `-Smoke` y las esperas usan `/health/liveness`;
  - el compose y los `.env.example` quedaron actualizados.
- **Frontend:**
  - el token viaja también en las llamadas desde el servidor;
  - ya no existe `mock_token`, y la cookie dura como mucho lo que el token (8 h);
  - un 401 lleva a `/login` con `reason` y `from` saneado;
  - un 403 de organización lleva a `/sin-acceso`;
  - no queda el log del Bearer.
- **Dependencias:** `next` y `eslint-config-next` 16.4.3, `axios` 1.20.0.
- **Tests:**
  - backend: 13 suites y 141 tests, entre ellos `all-routes-auth.spec`, que recorre todas las rutas;
  - frontend: 7 tests con `node --test`;
  - `dev-lib`: 1017 tests.
- **Documentación:** `CLAUDE.md` (regla 4, stack y comandos), `COMANDOS.md`, `BACKLOG.md` y `RIESGOS.md` (local).

## Verificación de los criterios (PO, contra 07-testing y los demás informes)
| Criterios | Estado |
|---|---|
| 1 a 5, 9 a 13, 17, 20 a 22 | Cumplen, con evidencia en vivo o en Jest |
| 6 | Cumple en Jest y por invariante estático. No hubo prueba en vivo porque la base no tiene un caso adecuado |
| 7 | Cumple en vivo. El caso de un usuario solo `Professional` se probó únicamente en Jest. El slug no existe (decisión 1 del PO) |
| 8 | Fuera de alcance por definición |
| 14 a 16 | Cumplen por HTTP y en código. **La parte visual queda pendiente de prueba en el navegador** |
| 18 | **Cumple en desarrollo. En Docker es parcial:** `-Smoke` no se pudo correr porque el puerto 3001 lo ocupa otro proyecto del usuario. Se probaron por separado el backend de producción y el frontend en Docker (puerto 3009) |
| 19 | **Pendiente:** prueba manual del usuario (07-testing, sección 5) |
| 23 | Cumple (08-documentacion) |
| 20, nota | El login exitoso responde 201, el valor por defecto de Nest, y no 200. Es el comportamiento que ya había y el frontend lo acepta. Se da por cumplido |

## Pendiente
1. **Prueba en el navegador**, a cargo del usuario: lista de 10 puntos en 07-testing, sección 5. Incluye la
   observación O-2 (si un 401 durante el render del servidor borra la cookie) y los toasts duplicados.
2. **`-Smoke` en modo Docker:** con el puerto 3001 libre, correr `.\dev.ps1 -Docker` y `.\dev.ps1 -Smoke`.
   Confirmar también H-2 del tester (Bake desde Git Bash).
3. **`NODE_ENV=local`** en el `backend/.env` local: hace que el modo desarrollo se comporte como producción, sin
   `/docs` ni debug. El usuario decide si lo cambia por `development`. Mejora sugerida para `dev.ps1`: normalizar
   el valor o no anunciar Swagger.
4. **Residuales de seguridad registrados en BACKLOG 34 a 39 y en RIESGOS:**
   - M-1: login de usuarios con `deletedAt`. Es chico; se recomienda hacerlo pronto.
   - M-2: IDOR por `:id`, `x-mode` del cliente, lookup por CUIT y ADMIN en `ConfigController`.
   - M-3: cookie sin `HttpOnly`.
   - M-4: rate limiting del login.
   - B-1 a B-4, Nest 11 por `npm audit` y `npm audit fix` del frontend.
5. **Menores del revisor:**
   - m-1: el interceptor no registra los requests fallidos;
   - m-2: el título del test dice "200";
   - m-3: avisos de `eslint-disable`;
   - m-5: `console.log("Pay")` preexistente.
6. **Bug preexistente O-3:** `work-items/page.tsx` pasa el objeto en lugar del array y la tabla muestra
   "No results".
7. **Doc vieja fuera del criterio 23:** `ARQUITECTURA.md` y `ESTADO.md` de `docs/auditoria`, y los README de
   `backend/` (`db push`, BACKLOG 32).
8. **Del 004:** activar push protection o secret scanning en GitHub (acción del usuario). Además, `User.cuit` no
   tiene migración.

## Para el commit
- **Fuera del commit:**
  - los 5 archivos que solo cambiaron de fin de línea: `body-parser-config.ts`, `global-prefix-config.ts`,
    `logger-config.ts` y `pipes-config.ts` (los cuatro en `config/app`), y `public-decorator.ts`;
  - `.claude/settings.json`, que solo cambió de fin de línea (lo confirmó seguridad);
  - `.vscode/` y `frontend/AGENTS.md`, que no son del feature.
- `docs/auditoria/RIESGOS.md` es local y git lo ignora.
- Antes del commit: revisar `git diff .claude/settings.json` (regla 12) y dejar que corra el hook `pre-commit`.

## Pasos omitidos
Ninguno. Se ejecutaron todas las etapas: UX/UI, arquitecto, desarrollador, revisor, seguridad, tester y
documentador.
