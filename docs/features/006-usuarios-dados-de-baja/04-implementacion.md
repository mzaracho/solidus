# 006 — Implementación

## Cambios por criterio
- **C1 y C2 (login):** `login-query-handler.ts`: la condición `!user || !user.passwordHash` pasa a
  `!user || user.deletedAt !== null || !user.passwordHash`. El usuario dado de baja sigue el camino del inexistente:
  `bcrypt.compare` contra el hash ficticio y el mismo 401 genérico.
- **C3 (token vigente):** `authentication-guard.ts` inyecta `PrismaService`. Tras verificar el token y validar `sub`/`exp`
  (solo rutas no públicas, las `@Public` retornan antes), ejecuta
  `user.findUnique({ where: { id: payload.sub }, select: { id: true, deletedAt: true } })`; si no existe o
  `deletedAt !== null` lanza el mismo `unauthorized()`. Sin cache. Alcanza también a `@OrgOptional` (logout y
  pro/memberships) porque el guard es global y corre antes que el de organización. No hizo falta tocar
  `guard-provider.ts`: `AppModule` importa `PrismaModule`.
- **C4 (defensa en profundidad):** `org-access.service.ts`: `members.some` y `professionals.some` llevan
  `user: { deletedAt: null }`. Si el usuario está dado de baja, `org` es null y `allowed: false` (403 de siempre).
- **C5:** usuarios activos sin cambios (cubierto por los specs existentes, todos en verde).
- **C9:** sin schema ni migración.

## Archivos tocados
Código: `backend/src/application/features/auth/login-query-handler.ts`,
`backend/src/infrastructure.bootstrap/guards/authentication-guard.ts`,
`backend/src/infrastructure/features/auth/services/org-access.service.ts`.
Tests: `login.spec.ts`, `authentication-guard.spec.ts`, `guard-chain.spec.ts`, `org-access-guard.spec.ts`
(`OrgAccessService`), `backend/test/all-routes-auth.spec.ts`, `backend/test/helpers/login-app.ts`.

## Tests agregados/ajustados
- login: usuario dado de baja con contraseña correcta y con incorrecta -> 401, mismo cuerpo que el inexistente,
  `bcrypt.compare` llamado en cada intento. `login-app.ts`: `FakeUser.deletedAt` opcional y el mock de
  `user.findUnique` también resuelve por `id`.
- guard (unitario): baja -> 401 genérico; inexistente -> 401; activo pasa; consulta con `where.id` y `select`
  mínimo, 2 requests = 2 consultas (sin cache); `@Public` (handler y clase) y token inválido no consultan Prisma.
- guard-chain: `PrismaService` mockeado; token de usuario dado de baja -> 401 en ruta con organización y en `@OrgOptional`.
- `OrgAccessService`: el `where` incluye `user: { deletedAt: null }` en membresía y Professional.
- all-routes-auth: el mock de Prisma devuelve usuario activo para `user.findUnique` (antes devolvía null, lo que
  daría 401 a todos); test nuevo: token de usuario dado de baja -> 401 en TODA ruta no pública, incluidas `@OrgOptional`.

## Resultados
- `npx tsc --noEmit` (backend): sin errores.
- `npm test`: 13 suites, 148 tests, todos en verde (antes 146 en 13 suites; ver nota).
- `npx eslint` sobre los archivos tocados: sin errores nuevos. Quedan errores de prettier preexistentes en
  `login-query-handler.ts` (líneas 5, 47, 65, 109, no tocadas) y warnings de directivas `eslint-disable` sin uso en los specs.
  No se ejecutó `npm run lint` ni prettier --write.

## Desvíos y notas para revisor/tester
- Sin desvíos del diseño de la spec.
- El cuerpo real del 401 pasa por `HttpFilter`: es `{ code: 'unauthorized', details, errors: [{ message: 'Unauthorized' }] }`,
  no el literal `{ code, message }` de la spec. Lo que importa (y se prueba) es que el cuerpo de baja sea idéntico al
  del usuario inexistente. Observación preexistente para el revisor: `details` serializa la excepción
  (`UnauthorizedException`) en el cuerpo; no revela nada de la baja, pero conviene valorarlo aparte.
- Costo: una consulta por PK extra en cada request autenticado (documentado como riesgo en la spec).
- Los tests no tocan base real ni usan secretos: usuarios, UUID y contraseñas se generan en ejecución.
- Para el tester: no hay dudas pendientes; el login del usuario de humo (activo) debe seguir en OK.
