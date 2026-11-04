# 07 — Testing: 011-controladores-huerfanos

> Autor: tester. Fecha: 2026-11-04. No se modificó código de producción ni se agregaron archivos al repo. Sin seeds, SQL de escritura, commit, push, stash, reset ni checkout. No se tocaron los puertos 3000 ni 3001 (FRONTEND_PORT=3002, sin Docker), ni `.env`, `backend/.env` ni `.claude/`. Token HS256 firmado en memoria (issuer `solidus-api`, audience `solidus-web`, 10 min; usuario ADMIN de su propia organización); no se imprimió ni guardó token, secreto ni dato personal. El script auxiliar está solo en el scratchpad.

## 1. Resultados automáticos

| Comando | Resultado |
|---|---|
| `backend: npx tsc --noEmit` | Sin errores |
| `backend: npx jest` | 32 suites, 567 tests, todo en verde |
| `.\dev.ps1` (desarrollo, sin Docker) | OK, backend y frontend responden |
| `.\dev.ps1 -Smoke` | Backend OK, Frontend OK, Login OK |
| `.\dev.ps1 -Stop` | OK, 2 procesos y contenedor detenidos, datos conservados |

## 2. Efectividad de la guardia (a2)

Por razonamiento sobre el test (`backend/test/org-isolation.spec.ts`, líneas 739-776), sin crear archivos:
- El conjunto `registeredControllers` sale del `ModulesContainer` del `AppModule` real, o sea lo que Nest efectivamente carga.
- El test recorre recursivamente `src/api/controllers/**` (sin `*.spec.ts`), hace `require` y toma toda exportación función con `PATH_METADATA` propia (la deja `@Controller()`). Una clase `@Controller` nueva en esa carpeta que ningún módulo liste en `controllers` queda en `declared` y no en `registered`, entra en `orphans` y `expect(orphans).toEqual([])` falla con su nombre.
- Evita pasar en vacío (`declared.length > 0`) y la lista blanca (vacía) no acumula obsoletos.
- Evidencia adicional: 04 informa que antes del borrado la guardia falló listando `ProductionController` y `ReportingController`. Hoy `src/api/controllers/v1/activity/` solo contiene `activity-controller.ts` de ese grupo y el test pasa.
- Limitación: no se hizo una prueba empírica con un controlador sintético (exigía tocar el árbol del repo o una copia completa del backend). No se detecta un controlador fuera de `src/api/controllers/**` ni uno sin `@Controller`.

## 3. Verificación en vivo

| Caso (token válido, header de la organización propia) | Esperado | Obtenido |
|---|---|---|
| `GET /api/my-production` | 404 | 404 |
| `GET /api/work-items/reporting/daily` | 404 | 404 |
| `GET /api/work-items/reporting/debtors` | 404 | 404 |
| `GET /api/work-items/reporting/monthly` | 404 | 404 |
| `GET /api/org` (ruta existente) | 200 | 200 |

## 4. Criterio por criterio

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Archivos eliminados (2 controladores, 2 archivos de queries; entradas quitadas de `security-invariants.spec.ts`) | `git status` muestra los 4 archivos borrados; `security-invariants.spec.ts` modificado; `tsc` y Jest en verde (sin referencias colgantes) | Cumple |
| 2 | Guardia estructural de controladores huérfanos | Test `(a2)` pasa; análisis de la sección 2 | Cumple (sin prueba empírica con controlador sintético) |
| 3 | Sin cambios de comportamiento | Rutas eliminadas siguen en 404 (sección 3); `/api/org` 200; test estructural de rutas con parámetros de `org-isolation` (132 tests) en verde | Cumple |
| 4 | Calidad | `tsc` sin errores, Jest 567 en verde. ESLint no lo corrí (lo informa 04 con errores prettier/EOL preexistentes) | Cumple (ESLint según 04) |
| 5 | Verificación | 404 en `my-production` y `reporting/daily` (más debtors y monthly); `-Smoke` Backend/Frontend/Login OK; conteos sin cambios | Cumple |

## 5. Conteos (solo `SELECT count`)

| Momento | User | Organization | Patient | WorkItem | Total filas de `public` (sin `_prisma_migrations`) |
|---|---|---|---|---|---|
| Antes (tras levantar, previo a las pruebas con token) | 9 | 3 | 72 | 324 | 1483 |
| Después (tras las pruebas, antes del `-Stop`) | 9 | 3 | 72 | 324 | 1483 |

## 6. Bugs

Ninguno.

## 7. Qué no pude verificar

- Prueba empírica de la guardia con un controlador huérfano real (solo razonamiento y lo informado en 04).
- ESLint de los archivos tocados.
- Modo Docker (fuera de la salvaguarda).
- `scripts/dev-lib.tests.ps1` no se corrió (no aplica al feature); el archivo sigue en disco.

## 8. Estado del entorno

- `.\dev.ps1 -Stop` ejecutado: backend, frontend y base detenidos, volumen intacto. Puertos 3002, 8080 y 5433 libres. Los puertos 3000 y 3001 no se tocaron.
- `git status` sin cambios nuevos por mi parte respecto del inicio (solo este `07-testing.md` se suma). `.env`, `backend/.env` y `.claude/` sin cambios míos.

Veredicto previo (historial, ronda inicial): APROBADO.

## Re-verificación (vuelta 1)

> Fecha: 2026-11-04. Mismas salvaguardas que la ronda inicial (FRONTEND_PORT=3002, sin Docker, puertos 3000/3001 intactos, token firmado en memoria sin imprimirse, solo SELECT count, sin escrituras). Script auxiliar solo en el scratchpad. `PUT /api/pro/profile` no se probó (escribe).

| Verificación | Resultado |
|---|---|
| `backend: npx tsc --noEmit` | Sin errores |
| `backend: npm test` (jest) | 32 suites, 567 tests, todo en verde (incluye guardia `(a2)` ampliada a `backend/src/**`) |
| `.\dev.ps1` / `-Smoke` | Backend OK, Frontend OK, Login OK |
| `PUT /api/profile` (body mínimo, token válido) | 404 (esperado 404) |
| `GET /api/my-production`, `/work-items/reporting/daily`, `/debtors`, `/monthly` | 404, 404, 404, 404 |
| `GET /api/org` (organización propia) | 200 |
| `.\dev.ps1 -Stop` | OK, 2 procesos y contenedor detenidos, datos conservados |

Conteos (solo SELECT count): User / Organization / Patient / WorkItem / total filas de `public`.
- Antes: 9 / 3 / 72 / 324 / 1483.
- Después: 9 / 3 / 72 / 324 / 1483 (sin cambios; el `PUT /api/profile` no escribió nada).

Criterios: borrado de `profile-controller.ts`, `update-profile-command.ts` y `update-profile.dto.ts` sin referencias colgantes (tsc y Jest verdes); guardia ampliada pasa; sin cambios de comportamiento en rutas existentes. Todos cumplen.

Bugs: ninguno. `scripts/dev-lib.tests.ps1` sigue en disco.

No verificado: prueba empírica de la guardia con un controlador sintético huérfano; ESLint (según 04 solo errores prettier/EOL preexistentes); modo Docker; `PUT /api/pro/profile` (escribe, excluido por salvaguarda).

VEREDICTO: APROBADO
