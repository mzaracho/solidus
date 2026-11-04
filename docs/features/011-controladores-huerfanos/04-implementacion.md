# 011 — Implementación

## Archivos
Borrados (backend/src):
- `api/controllers/v1/activity/production-controller.ts`
- `api/controllers/v1/activity/reporting-controller.ts`
- `application/features/activity/queries/get-my-production-query.ts` (query + handler)
- `application/features/activity/queries/reporting-queries.ts` (3 queries + 3 handlers)

Modificados:
- `backend/src/security-invariants.spec.ts`: se quitaron las 4 entradas `*.userId` de `ID_FIELDS`, la lista
  `NOT_REGISTERED_ALLOWLIST` y el test de "lista blanca sin entradas obsoletas" (ya sin objeto), y el `continue` que la usaba.
- `backend/test/org-isolation.spec.ts`: nuevo test `(a2)` y `registeredControllers`; imports `fs` y `path`.

Conservado: nada de lo que se pidió borrar. Verificado con grep en todo `backend/` (sin `node_modules`/`dist`) que
ninguna otra pieza usaba esas clases, y que ningún handler estaba registrado en un módulo (por eso no se tocó ningún módulo).
Sin DTOs ni specs propios. Sin desvíos del diseño (no hubo 03).

## Guardia estructural (criterio 2)
Test `(a2)` en `test/org-isolation.spec.ts`, que ya compila el `AppModule` real con Prisma en memoria:
1. En `beforeAll` se juntan todos los `wrapper.metatype` de los controladores del `ModulesContainer` (`registeredControllers`).
2. El test recorre `src/api/controllers/**` (sin `*.spec.ts`), hace `require` de cada archivo y toma las exportaciones
   función con metadata propia `PATH_METADATA` (la deja `@Controller()` en la clase).
3. Falla si alguna no está en `registeredControllers`. Comprueba además que se detecte al menos un controlador
   (evita pasar en vacío si cambia la metadata de Nest) y que la lista blanca no acumule obsoletos.
`ORPHAN_CONTROLLERS_ALLOWLIST` está vacía. Se comprobó que la guardia funciona: antes de borrar, falló listando
`ProductionController` y `ReportingController`.

## Calidad
- `npx tsc --noEmit`: sin errores.
- `npm test` (backend): 32 suites, 567 tests, todos en verde (org-isolation: 132, incluido el test estructural de rutas con
  parámetro, o sea que las rutas restantes no cambian).
- ESLint de los dos specs: la única línea nueva con error (prettier) la corregí. Quedan los errores prettier/EOL
  preexistentes de esos archivos (CRLF y líneas largas anteriores), que no toqué.

## Notas
- Revisor: el borrado es puro código muerto; revisar el test (a2) y que no quedó referencia en docs (ARQUITECTURA.md y
  BACKLOG #39 son del documentador).
- Seguridad: confirmar que la guardia detecta controladores no registrados (probado) y que `require` de todos los
  controladores no tiene efectos secundarios.
- Tester: `GET /api/my-production` y `GET /api/work-items/reporting/daily` deben dar 404 (ya lo daban); `-Smoke`; conteos de base.
  Yo no levanté el stack.

## Dudas pendientes
Ninguna.

## Vuelta de corrección 1

Hallazgos menores de 05-revision.md y 06-seguridad.md.

1. **MENOR-1 (seguridad): `PUT /api/profile` eliminado.** Era código muerto: el handler `UpdateProfileCommandHandler`
   nunca estuvo registrado (500 "Handler not found") y además era un mock que devolvía el body. Verificado con grep
   en backend y frontend: nadie lo usa (el front usa `PUT /pro/profile`, que es de `ProController`). No figuraba en
   `security-invariants.spec.ts`, `ID_FIELDS` ni `ID_ROUTE_CASES`.
   Borrados: `backend/src/api/controllers/v1/config/profile-controller.ts`,
   `backend/src/application/features/config/commands/update-profile-command.ts` y
   `backend/src/application/features/config/Dtos/update-profile.dto.ts` (el DTO solo lo usaba ese comando).
   Modificado: `backend/src/infrastructure.bootstrap/config/config-module.ts` (import y entrada en `controllers`;
   la lista quedó en una línea por prettier).
2. **MENOR-2 (seguridad): guardia `(a2)` recorre todo `backend/src/**`.** En `backend/test/org-isolation.spec.ts`
   ya no se limita a `src/api/controllers`. Excluye `*.spec.ts`, `*.d.ts` y, explícitamente, `src/api/main.ts`
   (ejecuta `bootstrap()` al importarse) e `src/infrastructure.bootstrap/bootstrap.ts` (crea la app Nest); ninguno
   declara controladores. Lista blanca `ORPHAN_CONTROLLERS_ALLOWLIST` sigue vacía.
3. **Sugerencia del revisor:** imports `crypto`, `fs`, `path` agrupados juntos (módulos de Node) antes de los de `@nestjs`.

### Resultados
- `npx tsc --noEmit` (backend): sin errores.
- `npx eslint` en `config-module.ts`: 1 error prettier preexistente (`{ }` en `export class ConfigModule`), ninguno nuevo. En `org-isolation.spec.ts` quedan errores prettier preexistentes
  (EOL CRLF y formato de bloques ajenos a este cambio, p. ej. líneas 373+ y 1571+) y 2 warnings de directivas
  eslint-disable sin uso, también preexistentes; no se tocaron para no ampliar el alcance.
- `npm test` (backend): 32 suites, 567 tests, todo en verde (incluye `(a2)` con el nuevo alcance).
