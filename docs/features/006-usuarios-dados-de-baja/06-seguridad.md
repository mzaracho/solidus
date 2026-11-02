# 006 — Revisión de seguridad

Alcance: login-query-handler.ts, authentication-guard.ts, org-access.service.ts y sus tests. Verificado: `npx tsc --noEmit` sin errores; `npm test` 13 suites, 148 tests en verde.

## Verificaciones
- Login (login-query-handler.ts:85): baja se trata como inexistente: mismo `bcrypt.compare` contra hash ficticio y mismo `invalidCredentials()`. Sin diferencia de cuerpo, status ni costo de bcrypt. OK.
- Guard (authentication-guard.ts:81-88): la consulta va después de verificar firma/alg/iss/aud y validar sub (UUID) y exp. Por PK, select mínimo, sin cache. Baja o inexistente -> mismo `unauthorized()` genérico. OK.
- Cobertura de rutas: el guard es global y solo las `@Public` retornan antes, por lo que alcanza a `@OrgOptional` (logout, memberships). OK.
- Fallo de base: el `await` lanza y la request no llega al handler (falla cerrado). OK.
- OrgAccessService (org-access.service.ts:25-33): `user: { deletedAt: null }` en ambas ramas (members y professionals), condición correcta (relación `user` opcional en Professional: con userId definido la condición aplica). OK.
- Único punto de emisión de tokens: login (`jwtService.sign`, login-query-handler.ts:156); no hay refresh ni otro camino que evite el chequeo. OK.
- Tests: usuarios, UUID y contraseñas generados en ejecución; sin secretos ni datos reales detectados. OK.
- Regresiones sobre el 005: ninguna (firma, issuer, audience, algoritmo y x-user-id sobrescrito sin cambios).

## Hallazgos
### Críticos / Altos / Medios
Ninguno.

### Baja
- B-1 (authentication-guard.ts:83): si la base falla, la respuesta es un 500 (error de Prisma vía filtro) y no un 401. Falla cerrado, pero conviene confirmar que el filtro no serialice el mensaje de Prisma. Recomendación: envolver en try/catch y lanzar `ServiceUnavailableException` genérica, o verificar el filtro con un test.
- B-2 (preexistente, informado por implementación): `details` en el cuerpo del 401 serializa la excepción. No revela la baja ni distingue casos. Recomendación: reducirlo en un feature aparte.

### Informativa
- I-1: costo de una consulta por PK extra por request autenticado (aceptado en la spec). Si crece la carga, evaluar cache con TTL muy corto, aceptando una ventana de baja no inmediata.
- I-2: el chequeo de tiempo entre baja e inexistente en el guard no es observable (ambos hacen una consulta y devuelven el mismo 401).

VEREDICTO: APROBADO
