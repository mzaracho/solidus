# 021 - Revision de codigo

Revisor. Fecha: 2026-11-18. Base: HEAD 75fae4c. Solo lectura y ejecucion de verificaciones (con `NODE_OPTIONS=--use-system-ca`, TLS intacto).

## Verificaciones ejecutadas
| Verificacion | Resultado |
|---|---|
| backend `npx tsc --noEmit` | 0 errores |
| backend `npx nest build` | OK (`dist/src/api/main.js` existe) |
| backend `npm test` | 58 suites / 1032 tests, verde |
| backend `npm audit --omit=dev` | 0 criticos, 0 altos, 4 moderados (`@nestjs/core` SSE, `@nestjs/common`, `file-type`, `platform-express`; van al 022) |
| backend `npm audit` | 18 (0 criticos, 4 altos, 11 moderados, 3 bajos); los altos son la cadena dev de `@nestjs/cli` (022) |
| frontend `npx tsc --noEmit` | 0 errores |
| frontend `npm test` | 148 pass / 0 fail |
| frontend `npm audit` | 0 vulnerabilidades |
| lockfiles: `resolved` fuera de `https://registry.npmjs.org/` | ninguno, en los dos |
| `next` / `eslint-config-next` instalados | 16.4.6 / 16.4.6; `agentUpgrade` existe en `config-schema.js` de 16.4.6 |

## Cumplimiento de la spec
1. Next 16.4.6 exacto, eslint-config-next 16.4.6 exacto: cumple. Sin majors de Nest, Prisma, React, Next ni TypeScript (diff de package.json lo confirma).
2. Frontend audit en 0: cumple.
3. Backend: proxy-addr critico y handlebars resueltos; body-parser explotable resuelto con override; lo restante esta listado y es del 022: cumple.
5. #61: `git grep axios|HttpModule|HttpService` en src, test, prisma, scripts y frontend/src solo devuelve `security-invariants.spec.ts:468` (test negativo sobre un archivo inexistente, valido). Cumple.
6. Lock coherente, origenes oficiales: cumple (la prueba `npm ci` la reporta el desarrollador; no la repeti por la prohibicion de instalar).
8. Rangos: ver M1.

## Hallazgos

### BLOQUEANTE
Ninguno.

### MAYOR
Ninguno.

### MENOR
- **M1 - `backend/package.json:24,28` (rangos `^` de `@nestjs/config` y `@nestjs/swagger`).** `^4.0.2` y `^11.2.5` siguen aceptando las versiones con `lodash` 4.17.21 / `path-to-regexp` 8.3.0 / `js-yaml` vulnerables; hoy lo evita solo el lock (`npm ci` lo respeta, un `npm install` con el lock regenerado, no). Es una brecha menor frente al criterio 8 ("ninguna version en un rango que reabra los avisos"). Sugerencia: subir los pisos a `^4.0.4` y `^11.4.8`, y agregar `lodash >= 4.18.1` y `path-to-regexp` (desde swagger) >= 8.4.2 a los casos de `dependency-floors.spec.ts`.
- **M2 - `backend/test/dependency-floors.spec.ts:28-40` (`parse`/`atLeast`).** La logica semver es correcta para x.y.z y es determinista (lee package.json instalados, sin red; resuelve desde el paquete consumidor, no es ciega). Pero si una version trae un segmento no numerico, `Number()` da `NaN`, ambas comparaciones son falsas y `atLeast` devuelve `true` (falso verde). Sugerencia: `if (a.some(Number.isNaN) || f.some(Number.isNaN)) throw new Error(...)` y un caso en "helper de comparacion". Ademas ignora prerelease (documentado en el comentario; aceptable).
- **M3 - `backend/test/dependency-floors.spec.ts:70-77` (piso de `multer`/`express` solo desde `@nestjs/platform-express`).** No cubre una copia anidada de `qs`/`body-parser` bajo otros consumidores (p. ej. `superagent`, `swagger-ui-express`). Sugerencia: opcional, agregar `qs` desde `supertest`/`superagent` si se quiere blindar tambien la cadena dev.
- **M4 - `backend/src/.../body-parser-gzip.spec.ts:73-100`.** El test no reproduce el fallo con 1.20.4 (ya aceptado por el PO como guarda de comportamiento). Riesgo de flakiness: depende de `setTimeout` de 150 ms/100 ms/1500 ms y de un listener de `uncaughtException` dentro de Jest. Paso 16 s de suite completa sin fallos; solo se anota. Sugerencia: si aparece flakiness en CI (026), subir tolerancias o marcarlo con comentario. Tambien el titulo/comentario dicen "regresion"; conviene aclarar en la cabecera que no falla con la version vulnerable en Node 24.
- **M5 - `frontend/next.config.ts:5-13` (`agentUpgrade: false`).** Correcto: existe en el schema de 16.4.6 (union `'security' | 'latest' | 'experimental-future' | false`), el comentario explica el motivo y la alternativa (`npm audit`). Trade-off a notar: se pierde el aviso en tiempo de build de un aviso de seguridad de Next hasta que `npm audit` corra en el CI (026). Sin accion salvo que 026 lo incluya.
- **M6 - lint del backend (+29 errores `no-unnecessary-type-assertion`, 755/153).** Aceptado por el PO como deuda del 025; no se objeta. Solo se recuerda dejarlo registrado en BACKLOG/PLAN para el 025.
- **M7 - Overrides (`backend/package.json:67-71`).** Justificados: parche/menor en la misma major, compatibles con Nest 10 / express 4 (`express ^4.22.3` excluye la 5, `body-parser ^1.20.9` excluye la 2.x, `multer ^2.5.0` sin uso real). Sin cambios requeridos. Nota: `npm ls` marca `invalid` para `~x from express` (efecto de overrides, documentado en 04 seccion 3); verificar que el tester no lo tome por regresion.
- **M8 - Documentacion.** `CLAUDE.md` dice 45 suites / 815 tests (backend) y 87 (frontend); la realidad es 58/1032 y 148. Para el documentador (etapa 08). `04-implementacion.md` ya lo senala.

## Casos no verificados por mi
Build Docker (#104, buildx), `.\dev.ps1`/`-Smoke` en frio y `npm ci` desde cero: reportados por el desarrollador, no repetidos por restriccion del encargo.

VEREDICTO: APROBADO
