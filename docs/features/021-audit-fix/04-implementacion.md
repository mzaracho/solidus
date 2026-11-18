# 021 — Implementación

Desarrollador. Fecha: 2026-11-18. Siguió `03-diseno-tecnico.md` en orden, con las decisiones del PO de `00-estado.md`.
No hubo commit. Se usó `NODE_OPTIONS=--use-system-ca` en la sesión; TLS nunca se desactivó. No se ejecutó `next upgrade`.

## 1. Archivos modificados

| Archivo | Cambio |
|---|---|
| `backend/package.json` | Quita `@nestjs/axios` y `axios` (#61); agrega `overrides` (`express ^4.22.3`, `body-parser ^1.20.9`, `multer ^2.5.0`). Los rangos de `@nestjs/swagger` (`^11.2.5`) y `@nestjs/config` (`^4.0.2`) no cambiaron: el lock los sube dentro del rango |
| `backend/package-lock.json` | Regenerado por npm (`uninstall`, `install` y `audit fix`, siempre con `--legacy-peer-deps`) |
| `frontend/package.json` | `next` y `eslint-config-next` 16.4.3 → 16.4.6 (exactos) |
| `frontend/package-lock.json` | Regenerado por npm (`install --save-exact` y `audit fix`) |
| `frontend/next.config.ts` | `experimental.agentUpgrade: false` con comentario en español (ver 4) |
| `backend/test/dependency-floors.spec.ts` (nuevo) | Pisos de versiones instaladas y de `overrides` |
| `backend/src/infrastructure.bootstrap/config/app/body-parser-gzip.spec.ts` (nuevo) | Regresión del corte por gzip con bytes de más (ver 5 y 8) |

No hay cambios de schema, DTOs, builders, fixture ni scripts (`dev.ps1` y `scripts/` intactos; por eso no se corrió
`dev-lib.tests.ps1`).

## 2. Versiones antes → después (lockfiles)

Backend:

| Paquete | Antes | Después |
|---|---|---|
| `express` | 4.22.1 | 4.22.3 |
| `body-parser` | 1.20.4 | 1.20.9 |
| `multer` | 2.0.2 | 2.5.0 |
| `proxy-addr` | 2.0.7 | 2.0.8 |
| `qs` | 6.14.1 | 6.16.2 |
| `path-to-regexp` | 0.1.12 / 3.3.0 / 8.3.0 | 0.1.13 / 3.3.0 / 8.4.2 |
| `@nestjs/swagger` | 11.2.5 | 11.4.8 |
| `@nestjs/config` | 4.0.2 | 4.0.4 |
| `lodash` | 4.17.21 | 4.18.1 |
| `js-yaml` | 3.14.2 / 4.1.1 | 3.15.2 / 4.3.2 / 5.5.0 (anidado en swagger) |
| `handlebars` | 4.7.8 | 4.7.10 |
| `fflate` | 0.8.2 | 0.8.3 |
| `typescript-eslint` y plugin | 8.53.1 | 8.73.0 |
| `minimatch` | 3.1.2 / 9.0.5 | 3.1.5 / 9.0.9 / 11.0.9 |
| `dotenv` | 16.4.7 / 16.6.1 | 16.6.1 en la raíz (sin cambio de major; 17.4.1 solo anidado en `@nestjs/config`) |
| `axios`, `@nestjs/axios`, `follow-redirects` | 1.20.0, 4.0.1, 1.16.2 | quitados |

Frontend: `next` y `eslint-config-next` 16.4.3 → 16.4.6 (`@next/env`, `@next/swc-*` y `@next/eslint-plugin-next` siguen la
versión), `source-map-js` 1.2.1 → 1.2.2 (#36), `js-yaml` 4.1.1 → 4.3.2, `typescript-eslint` y plugin 8.72.1 → 8.73.0,
`minimatch` 10.2.6 / 3.1.2 → 11.0.9 / 3.1.5. `react`, `react-dom` y `typescript` sin cambio.

`npm audit fix --legacy-peer-deps` en el backend necesitó **dos pasadas** para converger (la primera dejó 22 avisos y
la segunda 18; una tercera no cambia nada). Hay que repetirlo si se regenera el lock.

## 3. Overrides y justificación

Los tres son de parche o menor dentro de la misma versión mayor, con `^` para que el piso sea la versión corregida:
- `express ^4.22.3`: `@nestjs/platform-express` 10.4.22 fija 4.22.1 exacto; sube `qs`, `body-parser` y `path-to-regexp`.
- `body-parser ^1.20.9`: corrige GHSA-27r3 (alto, **explotable**: un request anónimo con gzip y bytes de más tira el
  proceso). Nest lo fija exacto en 1.20.4.
- `multer ^2.5.0`: Nest lo fija exacto en 2.0.2 (9 avisos altos; sin subidas de archivos, no explotable).

`qs` y `proxy-addr` no necesitaron override (los resuelven `express`/`body-parser` y `npm audit fix`). Se descartaron
overrides en la cadena de `@nestjs/cli` 10 (D3, decisión PO 2).

`npm ls` marca varios `invalid: "~x" from node_modules/express` (qs, http-errors, on-finished, type-is, mime-types) aunque
las versiones instaladas cumplen el rango (por ejemplo `qs` 6.16.2 vs `~6.16.0`). Es un efecto de cómo npm evalúa los
`overrides` sobre `express`; el árbol es coherente: `npm ci` funciona y los tests de pisos pasan. Ya existía un
`invalid` previo por el peer de swagger (2.4 del diseño).

## 4. Resultado de `agentUpgrade`

Existe en Next 16.4.6 (`server/config-schema.js`: `'security' | 'latest' | 'experimental-future' | false`; por defecto
`'security'`). Con `false`:
- `build/index.js` y `server/lib/router-server.js` solo cargan y ejecutan `nudgeUpgrade`/`assessUpgrade` si la política
  es una de las tres cadenas (o `process.env.__NEXT_AGENT_UPGRADE`, que usa `next upgrade`). Con `false` no se consulta
  el registro de avisos ni hay `SecurityFatalError` bajo un agente.
- El menú interactivo de una persona (`cli/next-dev.js`, `cli/next-build.js`) lo dispara un mensaje IPC que el proceso
  hijo envía **dentro de ese mismo bloque**; sin el bloque no hay mensaje, así que no hay menú que deje a `dev.ps1`
  esperando. `assessUpgrade` también devuelve `null` si la política no es una de las tres.
- `next upgrade` sigue existiendo pero nadie lo corre. Los avisos de Next se ven con `npm audit`.

Se agregó a `next.config.ts` con comentario. Verificado: `tsc`, `npm run build` y arranque en frío sin problemas. Nota: no se
reprodujo el menú ni el corte con una versión vulnerable (no hay una instalada); la conclusión sale de leer el código.
Seguridad debe revisarlo (decisión PO 1).

## 5. Tests nuevos

- `backend/test/dependency-floors.spec.ts` (11 tests): helper de comparación; versión instalada (resuelta desde quien la
  usa) de `express` ≥ 4.22.3, `body-parser` ≥ 1.20.9 (desde Nest y desde express), `multer` ≥ 2.5.0, `proxy-addr` ≥ 2.0.8,
  `qs` ≥ 6.16.1 (desde express y body-parser), `path-to-regexp` ≥ 0.1.13; `axios`/`@nestjs/axios` ausentes; `overrides`
  declarados con esos pisos. **Se comprobó que falla antes de los overrides** (9 de 11 fallaban con el lock viejo y sin overrides).
- `backend/src/infrastructure.bootstrap/config/app/body-parser-gzip.spec.ts` (1 test): app Nest con `configureBodyParser`
  escuchando en 127.0.0.1:0, socket crudo con un frame gzip válido y bytes de más enviados 150 ms después, listener
  temporal de `uncaughtException`, y segundo request que debe responder. **No falla con body-parser 1.20.4** en este
  entorno (ver 8): se deja como guarda de comportamiento, no como prueba de reproducción.
- Totales: backend 58 suites / 1032 tests (el CLAUDE.md dice 45/815: ya estaba desactualizado) y frontend 148 tests
  (CLAUDE.md dice 87).

## 6. `npm audit` antes → después

| Proyecto | Alcance | Antes (crit / alto / mod / bajo = total) | Después |
|---|---|---|---|
| backend | todo | 2 / 18 / 15 / 4 = 39 | 0 / 4 / 11 / 3 = 18 |
| backend | `--omit=dev` | 1 / 8 / 6 / 0 = 15 | 0 / 0 / 4 / 0 = 4 |
| frontend | todo | 0 / 6 / 9 / 0 = 15 | 0 / 0 / 0 / 0 = 0 |
| frontend | `--omit=dev` | 0 / 1 / 1 / 0 = 2 | 0 |

Backend `--omit=dev` (4 moderados, todos del 022 y no explotables): `@nestjs/core` (SSE), `@nestjs/common` y `file-type`,
`@nestjs/platform-express` (por core). Backend todo, lo que queda además (desarrollo, no explotable, 022): altos
`@nestjs/cli`, `glob`, `picomatch`, `tmp`; moderados `@angular-devkit/*`, `@nestjs/schematics`, `@nestjs/testing`,
`ajv`, `minimatch`, `@typescript-eslint/*` (cadena de la CLI/Nest); bajos `external-editor`, `inquirer`, `webpack`.
Coincide con la sección 11 del diseño. Crítico `proxy-addr` y `handlebars`: resueltos.

## 7. Verificaciones (criterio 7)

| Verificación | Resultado |
|---|---|
| backend `npx tsc --noEmit` | 0 errores |
| backend `npx nest build` | OK, existe `dist/src/api/main.js` |
| backend `npm test` | 58 suites, 1032 tests, todo verde |
| `npx prisma validate` / `generate` | OK / OK (Client 5.22.0) |
| backend lint `npx eslint "{src,apps,libs,test}/**/*.ts"` | 755 errores / 153 avisos (base 726 / 153). Ver nota abajo |
| frontend `npx tsc --noEmit` | 0 errores |
| frontend `npm test` | 148 pass, 0 fail |
| frontend `npm run build` (en frío, sin `.next`) | OK; 0 coincidencias de `SecurityFatalError` / `known security vulnerability`; no hizo falta la CA extra para Google Fonts |
| frontend lint `npm run lint` | 140 errores / 42 avisos (igual que la base) |
| `npm ci` en copia temporal (backend con `--legacy-peer-deps`, frontend) | OK en los dos; `npm audit --omit=dev` de las copias: backend 4 moderados, frontend 0; los lockfiles reales no cambian |
| Scripts de instalación y orígenes (paso 3) | Mismos paquetes con `hasInstallScript` que hoy (backend: `@nestjs/core`, `@prisma/client`, `@prisma/engines`, `@scarf/scarf`, `bcrypt`, `fsevents`, `prisma`; frontend: `unrs-resolver`); todos los `resolved` salen de `registry.npmjs.org` |
| `.\dev.ps1 -CheckMigrations` | 0, "Schema y migraciones coinciden" |
| Arranque en frío | En una sola invocación de shell: `-Stop`, borrar `frontend\.next`, `.\dev.ps1` (código 0, backend y frontend responden, frontend en 3002) y `.\dev.ps1 -Smoke` (código 0: Backend OK, Frontend OK, Login OK con cookie HttpOnly), a la primera. Después `-Stop`. La reinstalación de dependencias la hizo `dev.ps1` |
| Swagger / `/docs` | En el arranque de `dev.ps1` `/docs` da 404 porque `backend/.env` no define `NODE_ENV` y el backend lo trata como producción (diseño del backend, no es regresión). Para validar `@nestjs/swagger` 11.4.8 sobre Nest 10 se montó `SwaggerModule` en una app Nest mínima (script descartable): `/docs` y `/docs-json` responden 200 |
| `dev-lib.tests.ps1` | No corrido: no se tocaron scripts |
| `docker compose build backend frontend` | **No verificable**: buildx corta con `additional privileges requested: pass "--allow=fs.read=frontend\\Dockerfile"` (#104). No se forzó |

Nota sobre el lint del backend: la diferencia (+29 errores) es de **una sola regla**,
`@typescript-eslint/no-unnecessary-type-assertion` (2 → 31). La base se reprodujo en una copia con el lock viejo
(726 / 153 exactos) y se comparó regla por regla: no cambia ninguna otra. La causa es `typescript-eslint` 8.53.1 → 8.73.0
(subida de `npm audit fix`), que detecta más aserciones innecesarias en archivos existentes que no se tocaron
(`activity-update.service.spec.ts` 15, `dashboard.service.spec.ts` 5, etc.). Los dos archivos nuevos pasan el lint limpios.
No se arreglaron para no salir del alcance (ver pregunta 1).

## 8. Desvíos respecto del diseño

1. **Regresión de gzip no reproduce el fallo.** El diseño pedía escribirla antes de los overrides para verla fallar con
   1.20.4. Con Node 24.13 no se logró reproducir el cierre del proceso con body-parser 1.20.4: probé cuerpos con bytes de
   más en el mismo chunk y en uno posterior, `Content-Length` y `Transfer-Encoding: chunked`, y colas de bytes no gzip,
   de ceros, otro miembro gzip o 1 byte. Siempre respondió 200 o 400 sin `uncaughtException` (el tipo de cola que describe
   el aviso, "responde normalmente y luego el decodificador emite un error", depende de la versión de Node/zlib). Se deja el
   test como guarda de comportamiento, y la protección real queda en `dependency-floors.spec.ts` (que sí falla con
   1.20.4). Para la prueba manual del tester no hay un `curl` confiable en este Node.
2. `npm audit fix --legacy-peer-deps` en el backend se corrió 2 veces (ver 2); el diseño preveía una.
3. Se agregó `agentUpgrade: false` (decisión PO 1; en el diseño era la pregunta 1).
4. Un `git stash` / `git stash pop` accidental durante la revisión de `npm ls` no dejó cambios (el árbol quedó igual).

## 9. Preguntas al PO

1. Lint del backend: +29 errores de `no-unnecessary-type-assertion` por la subida de `typescript-eslint` a 8.73.0 (código
   sin tocar). Para "sin errores nuevos" estricto: ¿se corrigen aquí con `eslint --fix` solo de esa regla (toca ~11
   archivos existentes, incluidos specs) o se acepta como deuda nueva de lint para el 024?
2. `agentUpgrade: false` quedó validado solo por lectura de código (no hay una versión vulnerable instalada para ver el corte). Se sugiere registrar en BACKLOG que el aviso de actualización de Next queda apagado y que los avisos se siguen por `npm audit`.
3. `/docs` en el arranque de `dev.ps1` da 404 porque `NODE_ENV` no se define en `backend/.env`; el CLAUDE.md dice que
   solo hay Swagger con `development`/`test`. Para el tester: ¿se espera que se pueda abrir `/docs` con `dev.ps1`? Hoy no.
4. Confirmar CLAUDE.md: tests del backend 58 suites / 1032 y del frontend 148 (el documentador lo actualiza).

## Ajustes menores del revisor (2026-11-18)

**M1: pisos de rango.**
- `backend/package.json`: `@nestjs/config` `^4.0.2` -> `^4.0.4` y `@nestjs/swagger` `^11.2.5` -> `^11.4.8` (las versiones ya instaladas).
- `backend/package-lock.json` regenerado con `npm install --legacy-peer-deps --package-lock-only` (con `NODE_OPTIONS=--use-system-ca`; TLS no se desactivó).
  Se comprobó que cada versión resuelta del lock coincide con la instalada en `node_modules` (0 diferencias), o sea que no cambió ninguna versión resuelta; los rangos declarados de esos dos paquetes figuran con el nuevo piso en el paquete raíz del lock.
  Nota: el `git diff` del lock contra HEAD es grande porque incluye todo el trabajo previo de 021 (no solo este ajuste); no hay copia previa del lock para aislar este paso, por eso la comprobación se hizo contra lo instalado.
- `backend/test/dependency-floors.spec.ts`: casos nuevos `lodash` >= 4.18.1 (desde `@nestjs/config` y desde `@nestjs/swagger`) y `path-to-regexp` >= 8.4.2 (desde `@nestjs/swagger`); además verifica los dos rangos de `package.json`.
  `installedVersion` lee directo `node_modules/<pkg>/package.json` anidado cuando existe, porque `path-to-regexp` 8 no exporta `./package.json`.

**M2: `atLeast` estricto.** `parse` marca NaN todo segmento que no sea `^\d+$` (incluido el vacío) y `atLeast` lanza `versión no parseable` si hay NaN. Test nuevo del helper: no parseable (`abc`, `1.x.0`, vacíos) lanza; igual pasa; menor falla; mayor pasa.

**Resultados (backend).** `npx tsc --noEmit` sin errores; `npx nest build` OK; `npm test` 58 suites / 1036 tests, todo en verde (antes 1032, +4); eslint del spec sin errores; `npm audit --omit=dev` 0 críticos / 0 altos (4 moderados, sin cambios); `npm ci --legacy-peer-deps --ignore-scripts` en copia temporal OK (copia borrada).
