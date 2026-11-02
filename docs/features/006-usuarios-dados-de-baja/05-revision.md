# 006 — Revisión de código

## Resultados de comandos (backend)
- `npx tsc --noEmit`: sin errores.
- `npm test`: 13 suites, 148 tests, todos en verde.
- `npx eslint` sobre los 9 archivos tocados: 4 errores, todos de prettier en `login-query-handler.ts` líneas 5, 47, 65 y 109,
  preexistentes (líneas no tocadas por el diff; el diff solo cambia la línea 84-85). Warnings: directivas `eslint-disable`
  sin uso en specs, sin relación con el cambio. No hay errores nuevos. No se ejecutó `npm run lint`.

## Verificación por criterio
1. **C1 login baja = inexistente:** `login-query-handler.ts:85` `!user || user.deletedAt !== null || !user.passwordHash`
   entra al mismo bloque: `bcrypt.compare` contra el hash ficticio y `invalidCredentials()`. Mismo cuerpo y mismo costo.
   `deletedAt` llega porque `findUnique` con `include` devuelve todos los escalares. Correcto.
2. **C2 tiempo:** un solo `bcrypt.compare` en el camino de baja, igual que el inexistente. Correcto.
3. **C3 guard** (`authentication-guard.ts:81-87`): las rutas `@Public` retornan antes (línea 51); la consulta ocurre después
   de verificar firma/iss/aud/alg y validar `sub` (UUID) y `exp`; `findUnique` por PK con `select { id, deletedAt }`;
   sin cache; 401 con el mismo `unauthorized()`. Alcanza a `@OrgOptional` (logout y pro/memberships) porque el guard es
   global. Correcto. Si la base falla, la excepción propaga (500): falla cerrado, aceptable.
4. **C4 OrgAccessService** (`org-access.service.ts:25-34`): `user: { deletedAt: null }` está en ambas ramas del `OR`
   (`members.some` y `professionals.some`); `OrganizationMember` y `Professional` tienen relación `user`. Resultado
   `allowed: false` y 403 de siempre. Correcto.
5. **C5:** specs de usuarios activos en verde.
6. **C6 tests:** login (baja con clave correcta e incorrecta, mismo cuerpo que inexistente, `bcrypt.compare` contados),
   guard (baja, inexistente, activo, PK/select, sin cache, públicas y token inválido sin consulta), `OrgAccessService`
   (where con la condición), guard-chain y all-routes-auth (baja = 401 en toda ruta no pública). Cubierto.
7. **C7:** tsc, eslint y jest conforme a lo anterior. C9: sin schema ni migración en el diff.

## Mocks ajustados (debilitamiento de los tests del 005)
- `all-routes-auth.spec.ts`: el mock devuelve usuario activo para `user.findUnique` y el resto del Proxy queda igual; los
  tests existentes (401 sin token, 403 con org ajena, etc.) siguen ejerciendo el guard real. Además agrega el caso de baja.
  No se debilita nada. Nota: como ahora todo `user.findUnique` devuelve usuario activo, un token con cualquier `sub`
  pasa el guard de autenticación y el 403/401 que se evalúa después sigue dependiendo del resto del mock, igual que antes.
- `login-app.ts`: `findUnique` resuelve por `email` o por `id`; `deletedAt` opcional (default null). No afecta los tests
  de login del 005.
- `guard-chain.spec.ts` y `authentication-guard.spec.ts`: inyectan un mock de Prisma explícito; sin pérdida de cobertura.

## Hallazgos
- **BLOQUEANTE:** ninguno.
- **MAYOR:** ninguno.
- **MENOR-1:** `authentication-guard.ts:35` y `org-access.service.ts:13` — los comentarios JSDoc quedaron en una sola
  línea muy larga (más de 120 caracteres). Sugerencia: partirlos en varias líneas por legibilidad.
- **MENOR-2:** `login.spec.ts` (test nuevo de baja) crea y cierra una app aparte con `try/finally`; funciona, pero
  convendría un `describe` propio. Opcional.
- **SUGERENCIA-1 (cobertura):** el test del guard con mock no cubre un `sub` en mayúsculas (la regex hace `toLowerCase()`
  pero a Prisma se pasa el valor original; Postgres `uuid` lo acepta). Sin acción necesaria.
- **SUGERENCIA-2 (preexistente, fuera de alcance):** `details` serializa la excepción en el cuerpo del 401 (nota del
  desarrollador). Es idéntico para baja e inexistente, no revela nada nuevo; valorarlo en seguridad.
- **SUGERENCIA-3 (performance):** una consulta por PK extra por request autenticado; aceptada y documentada en la spec.

VEREDICTO: APROBADO
