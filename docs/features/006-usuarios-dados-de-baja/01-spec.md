# 006 — Usuarios dados de baja: sin login ni acceso con token vigente

## Contexto
El feature 005 dejó un residual de seguridad (06-seguridad, M-1; BACKLOG #34). `User` tiene `deletedAt`, pero:
- **Login:** `LoginQueryHandler` (`backend/src/application/features/auth/login-query-handler.ts:72`) busca al
  usuario por email sin filtrar `deletedAt`. Un usuario dado de baja inicia sesión normalmente.
- **Token vigente:** `AuthenticationGuard` (`backend/src/infrastructure.bootstrap/guards/authentication-guard.ts`)
  no consulta la base. Si el usuario se da de baja después del login, su token sigue sirviendo hasta 8 h.
- **Pertenencia:** `OrgAccessService` (`backend/src/infrastructure/features/auth/services/org-access.service.ts`)
  valida el vínculo con la organización sin mirar `User.deletedAt`.

## Historia de usuario
Como responsable de la plataforma, quiero que un usuario dado de baja no pueda iniciar sesión ni seguir usando
un token emitido antes de la baja, para que la baja tenga efecto inmediato.

## Criterios de aceptación
1. **Login de un usuario con `deletedAt` no nulo:** responde el mismo 401 genérico que una credencial
   inválida (mismo cuerpo `{ code: 'unauthorized', message: 'Unauthorized' }`), con contraseña correcta o
   incorrecta. No revela que el usuario existe ni que está dado de baja.
2. **Sin diferencia de tiempo:** el camino del usuario dado de baja ejecuta un `bcrypt.compare` igual que el
   resto, para no permitir enumeración por tiempo. Lo más simple es tratarlo igual que un usuario
   inexistente.
3. **Token vigente de un usuario dado de baja:** toda ruta autenticada, incluidas las `@OrgOptional`
   (`logout` y `pro/memberships`), responde 401 genérico. El chequeo va en `AuthenticationGuard`, después de
   verificar el token:
   - una consulta por clave primaria (`user.findUnique` por `id`, `select` mínimo);
   - si el usuario no existe o tiene `deletedAt`, 401;
   - el guard sigue sin cachear entre requests;
   - las rutas `@Public()` no consultan la base.
4. **Defensa en profundidad:** `OrgAccessService.getAccess` exige además que el usuario no esté dado de baja
   (por ejemplo, filtrando la relación `user: { deletedAt: null }` o con una condición equivalente). El
   resultado sigue siendo `allowed: false` y el guard responde el 403 de siempre.
5. **Sin efecto sobre usuarios activos:** los usuarios con `deletedAt` nulo funcionan igual que antes: login,
   rutas con organización, `@OrgOptional` y `@Public`.
6. **Tests (Jest):**
   - login: dado de baja con contraseña correcta → 401; con contraseña incorrecta → 401 con el mismo cuerpo;
     se ejecuta `bcrypt.compare`;
   - guard: token válido de un usuario dado de baja → 401; de un usuario inexistente → 401; de un usuario
     activo → pasa; las rutas públicas no consultan Prisma;
   - `OrgAccessService`: la consulta incluye la condición sobre `deletedAt` del usuario;
   - `all-routes-auth.spec` y los demás specs del 005 siguen en verde (ajustar los mocks de Prisma si hace
     falta).
7. **Calidad:** `npx tsc --noEmit` del backend sin errores, ESLint sin errores nuevos en los archivos tocados,
   `npm test` del backend en verde.
8. **Verificación en vivo (tester):** con el stack en modo desarrollo:
   - el usuario de humo (activo) hace login y `-Smoke` da Backend OK, Frontend OK y Login OK;
   - el resto se cubre con Jest. No se da de baja ningún usuario real ni se escribe en la base.
   - Los conteos (9 / 3 / 72 / 324 / 1483) no cambian.
9. **Datos intactos y sin schema nuevo:** no hay migración.

## Fuera de alcance
- Organizaciones dadas de baja (`Organization.deletedAt`, si existe) y `OrganizationMember` sin estado.
- Una pantalla o un endpoint para dar de baja usuarios.
- Revocar tokens por otros motivos (cambio de contraseña, logout del lado del servidor).
- Mensajes nuevos en el frontend: el 401 ya lleva a `/login` (feature 005).

## Riesgos
- **Una consulta más por request en el guard:** es por clave primaria, el costo es bajo. Hay que
  documentarlo.
- **Tests del 005 que mockean Prisma:** el guard pasa a depender de `PrismaService`, así que hay que ajustar
  los specs (`authentication-guard.spec`, `guard-chain.spec`, `all-routes-auth.spec` y `login-app.ts`).
- **Usuarios ya dados de baja en la base local:** pierden el acceso, que es lo esperado. El tester informa
  cuántos hay (solo con `SELECT count`).

## Pasos del flujo
- Requiere UX/UI: **no** (no hay interfaz nueva; el 401 ya se maneja).
- Requiere seguridad: **sí**.
- Arquitecto: **omitido**. El cambio es chico y la spec fija el diseño: dónde va cada chequeo, consulta por
  clave primaria y sin caché.
- Documentador: **sí, acotado**: BACKLOG #34 resuelto, RIESGOS M-1 y la mención en la regla 4 de `CLAUDE.md`
  si corresponde.
- Cambios de schema: no.
- Commit y push: autorizados por el usuario al aprobarse (sin force).

## Salvaguardas vigentes
- Sin seeds ni SQL de escritura; nunca escribir `BORRAR` en `-Seed`.
- Sin `down -v`, `prune` ni borrar volúmenes; sin stash, reset ni checkout.
- No tocar el puerto 3000 (coach-claudio). El 3001 lo ocupa otro proyecto del usuario.
- No imprimir valores del `.env`. Regla 12 con `.claude/settings.json`.
