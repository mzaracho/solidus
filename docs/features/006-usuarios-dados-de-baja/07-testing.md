# 07 — Testing: 006-usuarios-dados-de-baja

> Autor: tester. Fecha: 2026-11-02. No se modificó código de producción ni se agregaron tests (no hubo huecos frente al criterio 6).
> Sin seeds, sin SQL de escritura, sin commit ni push, sin tocar los puertos 3000 y 3001 ni `.env`, `backend/.env` ni `.claude/`.
> Los tokens de prueba se firmaron en memoria con el `JWT_SECRET` local (HS256, issuer y audience del 005); no se imprimieron ni se escribieron.
> El script auxiliar está en el scratchpad, fuera del repo.

## 1. Comandos

| Comando | Resultado |
|---|---|
| `backend: npx tsc --noEmit` | Sin errores |
| `backend: npm test` | 13 suites, 148 tests, todos en verde |
| `.\dev.ps1` (modo desarrollo) | Código 0; backend y frontend responden (frontend en 3002) |
| `.\dev.ps1 -Smoke` | `Backend OK - Frontend OK - Login OK` |

## 2. En vivo (HTTP, modo desarrollo)

| Caso | Resultado |
|---|---|
| Login del usuario de humo (vía `-Smoke`) | Login OK |
| `GET /health/liveness` sin token | 200 (sigue público) |
| Token firmado de un usuario activo con membresía, `GET /api/org` con su `x-org-id` | 200 |
| Mismo token, `GET /api/pro/memberships` (`@OrgOptional`) | 200 |
| Token firmado para un UUID inexistente, `GET /api/org` | 401 |
| Token firmado para un UUID inexistente, `GET /api/pro/memberships` | 401 |
| Sin token, `GET /api/org` | 401 con cuerpo idéntico (mismo hash) a los dos anteriores |
| Login de un usuario inexistente con contraseña ficticia | 401 con el mismo `code: unauthorized` |
| Usuarios con `deletedAt` no nulo en la base local | **0** (`SELECT count`) |

Como no hay usuarios dados de baja, el caso "dado de baja" en vivo no es ejecutable sin escribir en la base; queda cubierto por Jest.
El cuerpo del 401 es `{ code, details }` (ver nota del desarrollador sobre `HttpFilter`), igual para todas las causas.

## 3. Conteos (solo SELECT)

| Momento | User | Organization | Patient | WorkItem | Total `public` (sin `_prisma_migrations`) |
|---|---|---|---|---|---|
| Antes | 9 | 3 | 72 | 324 | 1483 |
| Después | 9 | 3 | 72 | 324 | 1483 |

## 4. Criterio por criterio

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Login de usuario con `deletedAt`: mismo 401 genérico | Código: `user.deletedAt !== null` en la condición (login-query-handler.ts:85). `login.spec`: baja con contraseña correcta y errónea, cuerpo idéntico al de inexistente. En vivo: no ejecutable (0 dados de baja); el inexistente da 401 | Cumple (Jest) |
| 2 | Sin diferencia de tiempo: `bcrypt.compare` también en baja | El usuario de baja sigue el camino del inexistente. `login.spec` verifica `bcrypt.compare` llamado en cada intento | Cumple (Jest) |
| 3 | Token vigente de un usuario de baja: 401 en toda ruta, incluidas `@OrgOptional`; `findUnique` por PK con `select` mínimo, sin caché; `@Public` sin base | Código del guard revisado. Jest: `authentication-guard.spec` (baja, inexistente, activo, `where.id`/`select`, 2 requests = 2 consultas, públicas e inválido sin Prisma), `guard-chain.spec`, `all-routes-auth.spec` (toda ruta no pública). En vivo: UUID inexistente da 401 en ruta con organización y en `pro/memberships`, mismo cuerpo que sin token | Cumple |
| 4 | `OrgAccessService` exige `user: { deletedAt: null }` | Código: membresía y `Professional` con `user: { deletedAt: null }`. `org-access-guard.spec` comprueba el `where` | Cumple (Jest) |
| 5 | Usuarios activos sin cambios | En vivo: activo con membresía 200 en `/api/org` y `pro/memberships`; login de humo OK; liveness 200. Jest en verde | Cumple |
| 6 | Tests de Jest requeridos | Login, guard, `OrgAccessService`, `all-routes-auth` y specs del 005 presentes y en verde (148/148) | Cumple |
| 7 | Calidad: tsc, ESLint sin errores nuevos, `npm test` | tsc sin errores; `npm test` en verde. ESLint: no medí; el desarrollador informa solo errores de prettier preexistentes en líneas no tocadas, y el revisor aprobó | Cumple (ESLint según 04/05) |
| 8 | Verificación en vivo | `-Smoke`: Backend OK, Frontend OK, Login OK; conteos sin cambios | Cumple |
| 9 | Datos intactos y sin schema nuevo | Conteos idénticos; sin migración (`git status` sin cambios en `prisma/`) | Cumple |

## 5. Bugs

Ninguno nuevo.

## 6. Lo que no pude verificar

- Un usuario realmente dado de baja en vivo (token y login): no hay ninguno en la base y no se puede escribir. Cubierto por Jest con mocks.
- Medición propia de ESLint sobre los archivos tocados.
- Costo de la consulta extra por request: no se midió latencia (por clave primaria, riesgo documentado en la spec).

## 7. Estado del entorno al terminar

- `.\dev.ps1 -Stop` ejecutado: se detuvieron los 2 procesos y los contenedores `healthops-gem-db-1` y `healthops-gem-backend-1` (los datos se conservan; sin `down -v`).
- Puertos 3002, 8080 y 5433 libres. El 3000 (coach-claudio) y el 3001 (otro proyecto) quedaron como estaban.
- `.env`, `backend/.env` y `.claude/` sin modificar. No se usó el modo Docker.

VEREDICTO: APROBADO
