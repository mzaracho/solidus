# 021 — Diseño técnico (relevamiento de dependencias)

Autor: arquitecto. Fecha: 2026-11-18. Ítems: #36, #25 (parte no incompatible), #61, #103. Relacionados: #35 (022), #104 (020).

## 0. Resumen

- **`proxy-addr` crítico se corrige sin Nest 11.** `express` 4.22.x pide `proxy-addr ~2.0.7` y la corrección (2.0.8)
  entra en ese rango, así que la trae `npm audit fix` sin `--force`. Además **no es explotable** en este backend: no hay
  `trust proxy` y la IP del login sale de `req.socket.remoteAddress`. **No hace falta consultar al PO antes de cerrar el
  diseño.**
- **El único aviso explotable hoy es `body-parser` (GHSA-27r3-jxmh-p828, alto):** un solo request sin autenticar, con
  `Content-Encoding: gzip` y bytes de más después del cuerpo comprimido, **tira abajo el proceso del backend**. No lo
  corrige `npm audit fix` porque `@nestjs/platform-express` 10.4.22 fija `body-parser` 1.20.4 de forma exacta. Se
  resuelve con un `overrides` a 1.20.9, que es un parche.
- **Backend:**
  - `npm audit fix --legacy-peer-deps`, sin `--force`;
  - 3 `overrides` de producción, todos de parche o menor dentro de la misma versión mayor: `express`, `body-parser` y
    `multer`;
  - se quitan `axios` y `@nestjs/axios`, que no tienen uso.
  - Quedan avisos que solo se corrigen con Nest 11 y van al 022: en producción, moderados y no explotables; en
    desarrollo, la cadena de `@nestjs/cli` 10.
- **Frontend:**
  - `next` y `eslint-config-next` pasan a 16.4.6, versión exacta, como hoy;
  - después, `npm audit fix` sin `--force`;
  - resultado esperado: `npm audit` en 0, también con `--omit=dev`.
- **`SecurityFatalError`:** Next lo dispara solo si la versión instalada está dentro del rango de un aviso publicado.
  La consulta se hace en tiempo real al registro de npm. Hoy ningún aviso afecta a 16.4.5 ni a 16.4.6 (verificado
  contra el registro).

## 1. Método y alcance del relevamiento

- Entorno:
  - Node 24.13.0 y npm 11.6.2 en el host; Docker usa `node:22-alpine`;
  - red con `NODE_OPTIONS=--use-system-ca`;
  - no se desactivó TLS.
- Comandos de solo lectura:
  - `npm audit --json` y `npm audit --omit=dev --json` en los dos proyectos;
  - `npm audit fix --dry-run --json` (con y sin `--legacy-peer-deps`);
  - `npm ls`, `npm view` y la API pública de avisos de GitHub y del registro de npm;
  - `npm ci --dry-run --ignore-scripts` sobre **copias** de `package.json`/`package-lock.json` en un directorio
    temporal.
- Además se descargaron a un directorio temporal, para leerlos sin ejecutarlos, los tarballs de
  `@nestjs/swagger@11.4.8`, `@nestjs/config@4.0.4` y `multer@2.5.0`, y los archivos `nudge.js` y
  `prepare-upgrade.js` de `next@16.4.6` (jsDelivr).
- Se comprobó con SHA-1 antes y después que `package.json` y `package-lock.json` de los dos proyectos quedaron
  intactos. No se tocaron `node_modules`, código, la base, los puertos 3000/3001 ni `.env`.
- Línea base de lint, antes de cualquier cambio y sin `--fix`:
  - backend: 726 errores y 153 advertencias;
  - frontend: 140 errores y 42 advertencias.

  Son deuda previa. El criterio 7 se mide como "sin errores nuevos" respecto de esta base.

## 2. Estado actual de `npm audit`

| Proyecto | Alcance | Crítico | Alto | Moderado | Bajo | Total |
|---|---|---|---|---|---|---|
| backend | todo | 2 | 18 | 15 | 4 | 39 |
| backend | `--omit=dev` | 1 | 8 | 6 | 0 | 15 |
| frontend | todo | 0 | 6 | 9 | 0 | 15 |
| frontend | `--omit=dev` | 0 | 1 | 1 | 0 | 2 |

### 2.1 Backend: dependencias de producción

Columnas:
- **"audit fix":** si lo corrige `npm audit fix` sin `--force` (en el backend hace falta `--legacy-peer-deps`; ver 2.4);
- **"Major":** si la corrección exige cambiar de versión mayor.

| Paquete (instalado) | Sev. | Avisos | Lo trae | Corregida | audit fix | Major | ¿Explotable aquí? |
|---|---|---|---|---|---|---|---|
| `proxy-addr` 2.0.7 | **crítico** | GHSA-jqcg-44mw-7w3h | `@nestjs/platform-express` → `express` 4.22.1 (`~2.0.7`) | 2.0.8 | **Sí** | No | **No.** Hace falta una subred de confianza IPv4 mapeada en IPv6 configurada en `trust proxy`, y no hay `trust proxy` (Express usa `false` por defecto y nadie llama `app.set('trust proxy')`). El login usa `req.socket.remoteAddress` (`auth-controller.ts`) y nunca `req.ip` ni `X-Forwarded-For` (012) |
| `body-parser` 1.20.4 | **alto** | GHSA-27r3-jxmh-p828 (alto), GHSA-v422-hmwv-36x6 (bajo) | `@nestjs/platform-express` (fija **exacto** 1.20.4) y `express` (`~1.20.3`) | 1.20.9 | **No** | No (parche) | **Sí, GHSA-27r3:** `configureBodyParser` registra `json` y `urlencoded` con `inflate` por defecto (activo), y el parseo corre antes del ruteo y de los guards, así que un request anónimo comprimido con bytes de más deja un error sin manejar y **el proceso termina**. GHSA-v422: no, porque `parseBodySizeLimit` valida `BODY_SIZE_LIMIT` y el backend no arranca con un valor inválido |
| `express` 4.22.1 | moderado | (por `qs`) | `@nestjs/platform-express` (fija **exacto** 4.22.1); `swagger-ui-express` (peer) | 4.22.3 | **No** | No (parche) | Por `qs`; ver esa fila |
| `qs` 6.14.1 | moderado | GHSA-w7fw-mjwx-w883 (bajo), GHSA-q8mj-m7cp-5q26, GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw; 6.14.3 además cae en GHSA-x5fp-wj9c-mxmx | `express`/`body-parser` (`~6.14.0`), `superagent` (dev, `^6.14.1`) | ≥ 6.16.1 (queda 6.16.2) | **No** (sube solo a 6.14.3, que sigue vulnerable) | No (menor 6.x) | **No.** q8mj, 6pq8 y 4mjr afectan a `qs.stringify` (4mjr, en un ciclo parse → stringify con `allowPrototypes`), y el backend no serializa entradas con `qs`. w7fw y x5fp requieren `comma: true`, que ni Express ni `body-parser` usan |
| `multer` 2.0.2 | alto | GHSA-xf7r, -v52c, -5528, -72gw, -3p4h, -wc9g, -qvfw, -535w, -q7qp | `@nestjs/platform-express` (fija **exacto** 2.0.2) | 2.5.0 | **No** | No (menor 2.x) | **No.** No hay subidas de archivos: no se usan `FileInterceptor`, `MulterModule`, `UploadedFile` ni `ParseFilePipe`. Nest carga `multer` pero nunca crea una instancia |
| `path-to-regexp` 0.1.12 y 8.3.0 | alto | GHSA-37ch-88jc-xwx2 (0.1.x); GHSA-j3q9-mxjg-w52f y GHSA-27v5-c462-wpq7 (8.x) | `express` (`~0.1.12`); `@nestjs/swagger` 11.2.5 (fija 8.3.0) | 0.1.13 y 8.4.2 | **Sí** (0.1.13 por rango; 8.4.2 porque `@nestjs/swagger` sube a 11.4.8) | No | **No.** El riesgo está en las expresiones generadas a partir de los patrones de ruta, que los define el código: ninguna ruta tiene 3 o más parámetros en un segmento ni grupos opcionales seguidos. `@nestjs/core` usa la 3.3.0, que no tiene avisos |
| `@nestjs/swagger` 11.2.5 | alto | (por `js-yaml`, `lodash` y `path-to-regexp`, fijados exactos) | directa | 11.4.8 | **Sí** (con `--legacy-peer-deps`) | No (menor 11.x) | **No.** `js-yaml` solo serializa el documento de `/docs` (no parsea), `lodash` no recibe entradas de usuarios y `/docs` existe solo con `NODE_ENV` `development` o `test` |
| `lodash` 4.17.21 | alto | GHSA-r5fr-rjxr-66jc (alto), GHSA-xxjr-mmjv-4gpg | `@nestjs/config` 4.0.2 y `@nestjs/swagger` 11.2.5 (exactos) | 4.18.1 | **Sí** (sube `@nestjs/config` a 4.0.4 y `@nestjs/swagger` a 11.4.8) | No | **No:** el código no usa `lodash`, y las librerías no le pasan a `_.template` claves de `imports` que vengan de afuera |
| `js-yaml` 4.1.1 | alto | GHSA-h67p, -52cp, -5p4m, -2883 | `@nestjs/swagger` (exacto); en dev, `@eslint/eslintrc`, `cosmiconfig` e `istanbul` (3.14.2) | 4.3.2 en la raíz; 5.5.0 dentro de `@nestjs/swagger`; 3.15.2 | **Sí** | No (la 5.x la elige `@nestjs/swagger` 11.4.8) | **No:** no se parsea YAML externo |
| `@nestjs/config` 4.0.2 | alto | (por `lodash`) | directa | 4.0.4 | **Sí** | No (parche) | No. Trae `dotenv` 17.4.1 anidado, pero usa `dotenv.parse`, que no escribe logs (verificado en el tarball) |
| `fflate` 0.8.2 | moderado | GHSA-px8p-9vwx-vf98 | `@nestjs/common` → `file-type` → `@tokenizer/inflate` | 0.8.3 | **Sí** | No | No |
| `file-type` 20.4.1, a través de `@nestjs/common` 10.4.22 | moderado | GHSA-5v7r-6r5c-r473, GHSA-j47w-4g3g-c36v | `@nestjs/common` (exacto) | 21.3.2 o superior (**major**), o Nest 11.1.17 o superior | No | **Sí** | **No:** solo lo usan `FileTypeValidator`/`ParseFilePipe` (con un `import()` dinámico), y no se usan → **022** |
| `@nestjs/core` 10.4.22 | moderado | GHSA-36xv-jgw5-4q75 (SSE) | directa | 11.1.18 | No | **Sí (Nest 11)** | **No:** no hay `@Sse` ni `MessageEvent` → **022** |
| `@nestjs/platform-express` 10.4.22 | alto (suma de los anteriores) | — | directa | después de los `overrides` queda moderado, por `@nestjs/core` | — | — | Ver las filas anteriores |

### 2.2 Backend: dependencias de desarrollo (no corren en el API)

| Paquete | Sev. | Lo trae | ¿Lo corrige `npm audit fix`? | Pendiente / explotabilidad |
|---|---|---|---|---|
| `handlebars` 4.7.8 | **crítico** | `ts-jest` | **Sí** → 4.7.10 | No es explotable: no compila plantillas externas |
| `brace-expansion`, `minimatch` (3.x, 9.x), `picomatch` 2.3.1, `fast-uri`, `flatted`, `browserslist`, `serialize-javascript`, `terser-webpack-plugin`, `baseline-browser-mapping`, `@humanfs/node`, `@babel/core`, `ajv` 6.12.6 / 8.17.1 (no el de `@angular-devkit`), `js-yaml` 3.x | alto/moderado/bajo | jest, eslint, typescript-eslint, `@nestjs/cli` | **Sí**. `serialize-javascript` desaparece porque `terser-webpack-plugin` 5.6.1 ya no lo usa | No explotables: son herramientas locales |
| `@nestjs/cli` 10.4.9 → `glob` 10.4.5 | alto | fijado exacto en la CLI | No | GHSA-5j98: inyección **solo por la CLI de `glob`** (`-c`), que no se usa → **022** (CLI 11) |
| `@nestjs/cli` → `inquirer` 8 → `external-editor` → `tmp` 0.0.33 | alto/bajo | fijado en la CLI | No (0.0 → 0.2 es incompatible) | Solo se usa en los prompts interactivos de `nest new`/`generate` → **022** |
| `@nestjs/cli` → `@angular-devkit/*` 17.3.11 (con `ajv` 8.12 y `picomatch` 4.0.1) y `@nestjs/schematics` 10 | alto/moderado | fijados exactos | No (requiere `@nestjs/schematics` 12, major) | Solo `nest generate` → **022** |
| `@nestjs/cli` → `webpack` 5.97.1 | bajo | fijado exacto | No | `nest-cli.json` no tiene `webpack: true`: la build usa `tsc` y webpack no corre → **022** |
| `@nestjs/testing` 10.4.22 | moderado | directa | No | Por `@nestjs/core` → **022** |

### 2.3 Frontend

| Paquete (instalado) | Sev. | Avisos | Lo trae | Corregida | audit fix | Major | ¿Explotable aquí? |
|---|---|---|---|---|---|---|---|
| `next` 16.4.3 | moderado | GHSA-mfr8-8qww-v76h, GHSA-vc7v-qv4w-wrv8; 16.4.5 corrige además GHSA-vvgp, -rhh4, -pc58, -7qx7 y -f3mh (notas de la versión) | directa, **versión exacta** | 16.4.5; objetivo **16.4.6** | No: está fijada exacta, hay que editarla | No | **No:** los dos avisos requieren `'use cache'`/Cache Components con parámetros raíz, y `next.config.ts` está vacío |
| `source-map-js` 1.2.1 (#36) | **alto** | GHSA-68fv-2mgg-jv7q | `postcss` 8.5.23 (de `next` y `@tailwindcss/postcss`) y `@tailwindcss/node` | 1.2.2 | **Sí** | No | **No:** solo procesa los source maps del propio CSS durante la build |
| `minimatch`, `brace-expansion`, `picomatch`, `flatted`, `js-yaml`, `ajv`, `@humanfs/node`, `typescript-eslint` y `@typescript-eslint/*` 8.72.1 | alto/moderado | varios | ESLint y `eslint-config-next` | según `npm audit fix` | **Sí** (`@typescript-eslint/*` → 8.73.0) | No | No: herramientas de lint |

Resultado esperado: después de subir Next y correr `npm audit fix`, `npm audit` da 0 avisos (también con `--omit=dev`).

### 2.4 Hallazgo previo: conflicto de peers en el backend

`@nestjs/swagger` 11.x declara el peer `@nestjs/common`/`@nestjs/core` `^11.0.1`, y el backend está en Nest 10.4.22.

Consecuencias:
- `npm ls` ya marca `invalid`;
- `npm audit fix` y `npm ci` **sin** `--legacy-peer-deps` fallan con ERESOLVE (comprobado en una copia).

Por eso `dev.ps1`, el `Dockerfile` y la pista de `-CheckMigrations` usan `npm install --legacy-peer-deps`. En este
feature:
- todo comando npm del backend lleva `--legacy-peer-deps`;
- "`npm ci` desde cero" (criterio 6) se cumple con `npm ci --legacy-peer-deps` en el backend, igual que el resto del
  proyecto.

El conflicto desaparece con Nest 11 (022).

## 3. Enfoque elegido y alternativas descartadas

### 3.1 Backend

- **D1. `npm audit fix --legacy-peer-deps` sin `--force`.** Es el mecanismo que pide la spec. Según el `--dry-run`:
  - sube `proxy-addr` 2.0.8, `path-to-regexp` 0.1.13 y 8.4.2, `lodash` 4.18.1, `js-yaml` 4.3.2 (raíz) y 5.5.0
    (anidado en swagger), `fflate` 0.8.3, `handlebars` 4.7.10 y el resto de la tabla 2.2 marcado "Sí";
  - sube `@nestjs/swagger` 11.2.5 → 11.4.8 y `@nestjs/config` 4.0.2 → 4.0.4, dentro de los rangos `^` declarados;
  - agrega 3 paquetes: `@humanfs/types`, `argparse@3` y `js-yaml@5`;
  - quita 2: `serialize-javascript` y `randombytes`.

  Compatibilidad de `@nestjs/swagger` 11.4.8 con Nest 10:
  - todos los símbolos de `@nestjs/common` y `@nestjs/core` que importa existen en 10.4.22, incluido
    `@nestjs/core/router/legacy-route-converter`, que ya usaba la 11.2.5 (verificado contra el tarball);
  - en tiempo de ejecución el API usa solo los decoradores (`ApiProperty`, `ApiPropertyOptional`, `ApiTags`,
    `ApiOperation`, `ApiResponse`, `ApiBearerAuth`, `ApiExcludeController`);
  - `SwaggerModule` y `DocumentBuilder` corren solo en desarrollo.

  Plan B si 11.4.8 rompe algo (tests, `nest build` o `/docs`):
  - fijar `"@nestjs/swagger": "~11.2.7"` (11.2.7 ya trae `lodash` 4.18.1 y `path-to-regexp` 8.4.2);
  - agregar el override anidado `"@nestjs/swagger": { "js-yaml": "^4.3.2" }`.
- **D2. `overrides` de producción.** Hacen falta porque `@nestjs/platform-express` 10.4.22 fija versiones exactas;
  `10.4.22` es la última 10.x y no hay una 10.4.23. Bloque a agregar en `backend/package.json`:

  ```json
  "overrides": {
    "express": "^4.22.3",
    "body-parser": "^1.20.9",
    "multer": "^2.5.0"
  }
  ```

  Justificación, uno por uno:
  - **`express` 4.22.1 → `^4.22.3`** (parche dentro de 4.22; el rango excluye la 5).
    - 4.22.3 es la `latest-4` del registro.
    - Mismas dependencias que 4.22.1; solo suben `qs` a `~6.16.0`, `body-parser` a `~1.20.5` y `path-to-regexp` a
      `~0.1.13`.
    - Lo usan `ExpressAdapter` y `swagger-ui-express` (peer `>=4`).
  - **`body-parser` 1.20.4 → `^1.20.9`** (parche; excluye la 2.x, que Express 4 no usa).
    - Corrige el aviso **explotable** GHSA-27r3.
    - `ExpressAdapter` usa `bodyparser.json`/`urlencoded`/`raw`/`text`, y esa API no cambia.
    - Desde 1.20.6, un `limit` inválido lanza un error al construir el parser. Es compatible: `parseBodySizeLimit` ya
      rechaza esos valores al arrancar.
  - **`multer` 2.0.2 → `^2.5.0`** (menor dentro de 2.x; excluye `3.0.0-alpha`).
    - Exporta lo mismo que usa Nest (`multer()`, `.single`/`.array`/`.fields`/`.none`/`.any`, `MulterError`;
      verificado en `index.js` de 2.5.0).
    - Tiene menos dependencias: deja `concat-stream`, `mkdirp`, `object-assign` y `xtend`.
    - Sin subidas de archivos, el riesgo de comportamiento es nulo.
  - **`qs` sin override.** Con `express` 4.22.3 y `body-parser` 1.20.9, los dos piden `~6.16.0` y se resuelve a 6.16.2,
    que no tiene avisos; `superagent` (`^6.14.1`) queda satisfecho con esa misma versión.
    - Si después de instalar aparece un `qs` < 6.16.1 anidado, agregar `"qs": "~6.16.2"`.
    - **No usar `^6.16.2`:** forzaría 6.17.x por encima del `~6.16.0` de Express.
  - **`proxy-addr` sin override:** lo resuelve D1 dentro del rango de Express. El lockfile lo fija en 2.0.8 y `npm ci`
    respeta el lockfile.
  - Rangos con `^` en lugar de versiones exactas: ninguno puede bajar de la versión corregida (cumple el criterio 8) y
    los parches futuros entran solos.
- **D3. Se descartan `overrides` en la cadena de desarrollo de `@nestjs/cli` 10** (`glob`, `tmp`, `webpack`,
  `@angular-devkit/*` con su `ajv`/`picomatch`).
  - Ninguno corre en el API ni recibe entradas externas. Las imágenes Docker los incluyen porque no se podan las
    dependencias de desarrollo, pero tampoco se ejecutan.
  - Forzar versiones que los autores de la CLI no probaron pone en riesgo `nest start --watch` y `nest build`, que
    `dev.ps1` necesita, sin ganar seguridad.
  - Se corrigen solos con `@nestjs/cli` 11 en el 022 (ver Pregunta 2).
- **D4. #61: quitar `axios` y `@nestjs/axios` con `npm uninstall`.** Verificación hecha:
  - ningún `import`/`require` en `backend/src`, `backend/test`, `backend/prisma`, `scripts/` ni el frontend;
  - ningún módulo registra `HttpModule` ni inyecta `HttpService`;
  - solo aparecen en `package.json` y `package-lock.json`, y en el test `no existe el filtro de axios` de
    `security-invariants.spec.ts`, que busca un archivo que ya no existe y sigue siendo válido.

  `npm ls axios` muestra que solo los usan la raíz y `@nestjs/axios`. Al quitarlos salen también `axios` 1.20.0 y sus
  transitivas exclusivas (`follow-redirects`, `proxy-from-env`); `form-data` se queda si la sigue usando `superagent`.
- **Alternativas descartadas:**
  - `npm audit fix --force`: instala `@nestjs/platform-express`/`@nestjs/core` 12.5.1 y `@nestjs/schematics` 12, que
    son major y van al 022;
  - un `backend/.npmrc` con `legacy-peer-deps=true`: ocultaría futuros conflictos de peers en todo el proyecto, y la
    convención actual es pasar la bandera de forma explícita;
  - `inflate: false` en `body-parser`: es el workaround del aviso, pero rechaza los cuerpos comprimidos y cambia el
    comportamiento, y el parche lo hace innecesario. Queda como plan C si el override fallara.

### 3.2 Frontend

- **D5.** `npm install --save-exact next@16.4.6 eslint-config-next@16.4.6`. Mantiene la convención de versión exacta.
  `@next/env`, `@next/swc-*` (todas las plataformas, incluida `linux-x64-musl` para Docker) y
  `@next/eslint-plugin-next` siguen a esa versión automáticamente porque `next` y `eslint-config-next` las fijan
  exactas. Después, `npm audit fix` sin `--force`.

  Según el `--dry-run`:
  - `source-map-js` 1.2.2 (#36) y `@typescript-eslint/*` 8.73.0;
  - `minimatch` 11.0.9 anidado en `typescript-estree` (por el rango de esa librería);
  - entran `@isaacs/nonrecursive-glob-match` y `@humanfs/types`;
  - salen 4 paquetes opcionales de wasm de `unrs-resolver`.
- `react`/`react-dom` (19.2.3) y `typescript` no cambian. `next@16.4.6` acepta `react ^19` y pide Node ≥ 20.9.
- Cambios de 16.4.6 (notas de la versión):
  - compresión automática de las respuestas de *route handlers*: no hay ninguno (`src/` solo tiene `middleware.ts`);
  - correcciones de GC de Turbopack en desarrollo;
  - versión de Tailwind fijada en `create-next-app`, que no aplica.

### 3.3 Next: `SecurityFatalError` (criterio 1)

Comportamiento leído en `node_modules/next/dist/lib/upgrade/nudge.js` y `prepare-upgrade.js` de 16.4.3. El `nudge.js`
de 16.4.6 es idéntico salvo por la versión embebida, y `prepare-upgrade.js` no cambia.

- La política por defecto es `experimental.agentUpgrade: 'security'` (`config-shared.js`).
- `next build` (`build/index.js`) y `next dev` (`cli/next-dev.js`, `router-server.js`) consultan
  `POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` con la versión instalada.
  - Si la versión cae en el rango de un aviso y el proceso lo lanza un **agente de IA** (lo detecta
    `@vercel/detect-agent`, por ejemplo una sesión de Claude Code), el comando aborta con `SecurityFatalError` y deja un
    recibo en `.next/cache/next-agentic-upgrade-retries`.
  - Repetir el comando dentro de 5 minutos lo deja pasar. Por eso "el primero falla y el segundo funciona" (#103).
  - Si lo lanza una persona en una terminal interactiva, muestra un menú de actualización.
- Con 16.4.6: el registro no devuelve avisos para 16.4.5 ni 16.4.6 (consultado hoy), así que `assessUpgrade` devuelve
  `null` y no hay ni error ni menú. Si el registro no responde (red o TLS), Next escribe *"Could not check Next.js
  security advisories"* y **sigue**, sin abortar.
- **Riesgo residual:** el mecanismo es dinámico. Si mañana se publica un aviso que afecta a 16.4.6, el primer arranque
  bajo un agente vuelve a cortarse hasta subir de versión. Se puede apagar con `experimental: { agentUpgrade: false }`
  en `next.config.ts` (ver Pregunta 1). **Nunca** se ejecuta `next upgrade` ni el comando que sugiera el aviso.

## 4. Archivos a modificar

| Archivo | Cambio |
|---|---|
| `backend/package.json` | Quitar `@nestjs/axios` y `axios`; agregar `overrides` (D2); `npm audit fix` puede reescribir los rangos de `@nestjs/swagger` (`^11.4.8`) y `@nestjs/config` (`^4.0.4`) |
| `backend/package-lock.json` | Regenerado por npm (nunca a mano) |
| `frontend/package.json` | `next` y `eslint-config-next` en `16.4.6` exacto |
| `frontend/package-lock.json` | Regenerado por npm |
| `backend/test/dependency-floors.spec.ts` (nuevo, recomendado) | Test estructural de versiones mínimas (ver sección 9) |
| Opcional, según el PO: `frontend/next.config.ts` | `experimental.agentUpgrade: false` (Pregunta 1) |

- No hay cambios de schema, de modelos de datos, de contratos del API, de DTOs, de builders (`request-bodies.ts`) ni de
  la fixture de contrato.
- No cambia `dev.ps1`: sigue con `npm install --legacy-peer-deps` / `npm install` y vuelve a instalar solo porque cambió
  el hash del lockfile.
- Tampoco cambian los Dockerfiles.

## 5. Procedimiento para el desarrollador (PowerShell, desde la raíz)

Reglas:
- no ejecutar `next upgrade` ni nada que sugieran los avisos;
- no usar `--force`;
- no desactivar TLS;
- no imprimir `.env`;
- no levantar nada en los puertos 3000/3001 (el frontend del usuario usa `FRONTEND_PORT`=3002);
- no correr `.\dev.ps1 -Docker` ni `docker compose up` (el frontend Docker publica el 3001).

```powershell
# --- 0. Preparación ---
cd C:\Repositorios\healthops-gem
.\dev.ps1 -Stop                                  # libera los locks de Prisma y node; avisar al usuario
$env:NODE_OPTIONS = '--use-system-ca'            # solo en esta sesión (Node 24 lo soporta)
git status --short -- backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json   # debe salir vacío
$work = Join-Path $env:TEMP 'solidus-021'; New-Item -ItemType Directory -Force $work | Out-Null
Push-Location backend;  npm audit --json > "$work\be-before.json"; Pop-Location
Push-Location frontend; npm audit --json > "$work\fe-before.json"; Pop-Location

# --- 1. Backend ---
cd backend
git grep -n -E "axios|HttpModule|HttpService" -- src test prisma ../scripts ../frontend/src   # solo debe aparecer security-invariants.spec.ts (AxiosFilter)
npm uninstall @nestjs/axios axios --legacy-peer-deps
# Editar package.json: agregar el bloque "overrides" de D2 (al final, después de "prisma").
npm install --legacy-peer-deps
npm audit fix --legacy-peer-deps                 # SIN --force
npm ls proxy-addr body-parser express multer qs path-to-regexp @nestjs/swagger @nestjs/config lodash js-yaml dotenv axios
#   Esperado: proxy-addr 2.0.8; body-parser 1.20.9; express 4.22.3; multer 2.5.0; qs 6.16.x (ninguno < 6.16.1);
#   path-to-regexp 0.1.13 (express), 8.4.2 (swagger) y 3.3.0 (core); @nestjs/swagger 11.4.8; @nestjs/config 4.0.4;
#   lodash 4.18.1; dotenv 16.x en la RAÍZ (17.x solo anidado en @nestjs/config); axios: vacío.
#   npm ls sale con error por el peer inválido de swagger, que ya existía: es lo esperado.
npm audit; npm audit --omit=dev
#   Esperado --omit=dev: 0 críticos, 0 altos; moderados solo @nestjs/core, @nestjs/common, file-type y
#   @nestjs/platform-express (por core). Si aparece otra cosa, parar y reportar.
cd ..

# --- 2. Frontend ---
cd frontend
npm install --save-exact next@16.4.6 eslint-config-next@16.4.6
npm audit fix                                    # SIN --force
npm ls next eslint-config-next @next/env @next/eslint-plugin-next @next/swc-win32-x64-msvc source-map-js
#   Esperado: todo 16.4.6; source-map-js 1.2.2 en todas las ramas.
npm audit; npm audit --omit=dev                  # esperado: 0 y 0
cd ..

# --- 3. Revisión de cambios de dependencias (criterio 8) ---
git diff --stat
node -e "for (const d of ['backend','frontend']) { const l=require('./'+d+'/package-lock.json'); const s=[], o=[]; for (const [k,v] of Object.entries(l.packages)) { if (v.hasInstallScript) s.push(k.replace(/^.*node_modules\//,'')+'@'+v.version); if (v.resolved && !v.resolved.startsWith('https://registry.npmjs.org/')) o.push(k); } console.log(d, 'scripts:', s.join(', ')); console.log(d, 'fuera del registro:', o.length ? o.join(', ') : 'ninguno'); }"
#   Esperado backend: @nestjs/core, @prisma/client, @prisma/engines, @scarf/scarf, bcrypt, fsevents, prisma (los mismos de hoy).
#   Esperado frontend: unrs-resolver (el mismo de hoy). Fuera del registro: ninguno.

# --- 4. npm ci desde cero (copias en un directorio temporal, sin .env) ---
$tmp = Join-Path $env:TEMP ('solidus-021-ci-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory "$tmp\backend", "$tmp\frontend" | Out-Null
Copy-Item backend\package.json, backend\package-lock.json "$tmp\backend"
Copy-Item -Recurse backend\prisma "$tmp\backend\prisma"
Copy-Item frontend\package.json, frontend\package-lock.json "$tmp\frontend"
Push-Location "$tmp\backend";  npm ci --legacy-peer-deps; "backend npm ci: $LASTEXITCODE";  npm audit --omit=dev; Pop-Location
Push-Location "$tmp\frontend"; npm ci;                    "frontend npm ci: $LASTEXITCODE"; npm audit --omit=dev; Pop-Location
Remove-Item -Recurse -Force $tmp
git status --short -- backend/package-lock.json frontend/package-lock.json   # npm ci no debe cambiar los lockfiles
```

Para regenerar los lockfiles hay que usar siempre `npm install` / `npm uninstall` / `npm audit fix` con
`--legacy-peer-deps` en el backend. Nunca se editan a mano ni se borran para regenerarlos desde cero: eso movería cientos
de transitivas sin control. Si un paso deja el lockfile incoherente, se vuelve atrás con
`git checkout -- backend/package.json backend/package-lock.json` (o `frontend/...`), luego `npm ci` (con
`--legacy-peer-deps` en el backend) y se repite.

### 5.1 Verificaciones (criterio 7), en orden

```powershell
# Backend (con .\dev.ps1 -Stop hecho)
cd C:\Repositorios\healthops-gem\backend
npx tsc --noEmit
npx nest build
npm test                                         # 45 suites / 815 tests hoy, más el test nuevo
npx prisma validate
npx prisma generate
npx eslint "{src,apps,libs,test}/**/*.ts"        # sin --fix; comparar con la base (726 errores / 153 advertencias)
cd ..; .\dev.ps1 -CheckMigrations; "CheckMigrations: $LASTEXITCODE"   # debe dar 0

# Frontend
cd frontend
npx tsc --noEmit
npm test                                         # 87 tests hoy
npm run lint                                     # comparar con la base (140 errores / 42 advertencias); sin errores nuevos
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue      # build en frío, sin recibos de reintento
npm run build 2>&1 | Tee-Object "$env:TEMP\solidus-021\fe-build.txt"
#   Si falla Google Fonts por TLS: $env:NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS='1'; npm run build
Select-String -Path "$env:TEMP\solidus-021\fe-build.txt" -Pattern 'SecurityFatalError','known security vulnerability' # debe salir vacío
cd ..

# Arranque en frío y prueba de humo, a la primera
.\dev.ps1 -Stop
Remove-Item -Recurse -Force frontend\.next -ErrorAction SilentlyContinue
.\dev.ps1                                        # una sola vez; reinstala dependencias porque cambió el hash del lockfile
.\dev.ps1 -Smoke; "Smoke: $LASTEXITCODE"         # 0, "Login OK" (cookie solidus_session HttpOnly)
#   Revisar en la ventana del frontend que no aparezcan SecurityFatalError ni el menú de actualización.
#   Swagger en desarrollo: abrir http://localhost:8080/docs y comprobar que carga (valida @nestjs/swagger 11.4.8).

# Docker: solo build (sin up: el frontend publicaría el 3001)
docker compose build backend frontend
#   Si hay CA extra exportada (.dev\certs\extra-ca.pem): docker compose -f docker-compose.yml -f docker-compose.extra-ca.yml build backend frontend
#   Si buildx corta con "additional privileges requested: --allow=fs.read" (#104): reportar "no verificable", no forzar.
```

- Si `-CheckMigrations` levanta un contenedor descartable, no escribe en la base del usuario.
- `.\dev.ps1` aplica `prisma migrate deploy` sobre la base del usuario; no hay migraciones nuevas, así que no escribe
  nada.
- `-Smoke` no escribe.

## 6. Revisión de seguridad de dependencias nuevas o cambiadas (criterio 8)

Revisado con `npm view <paquete>@<versión> scripts repository dist`:

| Paquete | Nuevo/cambia | Scripts de instalación | Origen | Provenance npm |
|---|---|---|---|---|
| `proxy-addr` 2.0.8, `body-parser` 1.20.9, `express` 4.22.3, `multer` 2.5.0 | cambia | ninguno | registry.npmjs.org; repos de `jshttp`/`expressjs` | sí |
| `qs` 6.16.2, `path-to-regexp` 0.1.13 | cambia | ninguno | registro oficial; `ljharb/qs` y `pillarjs` | no |
| `@nestjs/swagger` 11.4.8, `@nestjs/config` 4.0.4, `@nestjs/mapped-types` 2.1.1 | cambia | solo `prepare`, que **no** corre al instalar desde el registro | registro oficial; repos de `nestjs` | no |
| `js-yaml` 5.5.0 y `argparse` 3.0.4 (nuevos, anidados en swagger) | nuevo | ninguno | registro oficial; `nodeca` (mismo autor que las versiones actuales) | no |
| `lodash` 4.18.1, `handlebars` 4.7.10, `fflate` 0.8.3, `dotenv` 17.4.1 (anidado), `dotenv-expand` 12.0.3, `@microsoft/tsdoc` 0.17.1, `swagger-ui-dist` 5.34.1 | cambia | ninguno | registro oficial | `swagger-ui-dist`: sí; el resto: no |
| `@humanfs/types` 0.15.0 (nuevo, en los dos proyectos) | nuevo | solo `prepare` | registro oficial; `humanwhocodes/humanfs` (lo trae `@humanfs/node` de ESLint) | no |
| `next`, `@next/env`, `@next/swc-*`, `eslint-config-next`, `@next/eslint-plugin-next` 16.4.6 | cambia | ninguno | registro oficial; `vercel/next.js` | sí |
| `source-map-js` 1.2.2, `typescript-eslint` 8.73.0, `minimatch` 11.0.9 | cambia | ninguno (`minimatch`: solo `prepare`) | registro oficial | `typescript-eslint` y `minimatch`: sí |
| `@isaacs/nonrecursive-glob-match` 1.1.0 (nuevo en el frontend) | nuevo | solo `prepare` | registro oficial; mantenedor `isaacs`, el mismo de `minimatch`, que lo trae. **Sin `repository` en el manifiesto:** lo revisa seguridad | no |

- **Sin scripts de instalación nuevos.** La lista de paquetes con `hasInstallScript` debe ser la misma de hoy. En el
  backend son `@nestjs/core`, `@prisma/client`, `@prisma/engines`, `@scarf/scarf`, `bcrypt`, `fsevents` y `prisma`;
  en el frontend, `unrs-resolver`.
- **Todos los `resolved` salen de `https://registry.npmjs.org/`**, hoy y después del cambio; el paso 3 de la sección 5
  lo verifica.
- **Observación previa, fuera de alcance:** `@scarf/scarf` 1.4.0, que llega con `swagger-ui-dist`, tiene un
  `postinstall` que manda telemetría de instalación. Ya estaba y sigue igual. Ver la Pregunta 3.
- Rangos: ningún rango nuevo permite una versión vulnerable (los `overrides` tienen como piso la versión corregida;
  `next` está fijado exacto en 16.4.6). El test de la sección 9 lo vigila.

## 7. Manejo de errores, rendimiento y compatibilidad

- **Errores:** no cambia el contrato de errores. Los errores del parser (`entity.*`, `encoding.*`) los siguen
  respondiendo `bodyParserErrorHandler` y el contrato genérico. Con 1.20.9, un cuerpo comprimido con bytes de más ya no
  tira abajo el proceso; si `body-parser` devuelve 400, sale como `bad-request`/`validation-failed` según el tipo actual.
  El tester lo comprueba (sección 9).
- **Rendimiento:** sin impacto apreciable. Las correcciones de `qs` y `path-to-regexp` solo agregan límites. La
  compresión de route handlers de Next 16.4.6 no aplica.
- **Compatibilidad:**
  - Node 24 (host) y Node 22 (Docker) cumplen los `engines`, incluido `minimatch` 11 (`20||>=22`);
  - sin cambios de API para el frontend ni para clientes;
  - `dotenv` de la raíz queda en 16.x: `main.ts` hace `import 'dotenv/config'`, y si pasara a 17 empezaría a escribir
    una línea de log por defecto. Se verifica con `npm ls dotenv`.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| `@nestjs/swagger` 11.4.8 sobre Nest 10 se comporta distinto (como ya ocurre con 11.2.5) | Símbolos de Nest verificados; `npm test` (los DTO cargan los decoradores), `nest build` y `/docs` en el smoke. Plan B de D1 |
| Los `overrides` de `express`/`body-parser`/`multer` divergen de lo que probó Nest 10.4.22 | Parches y menores dentro de la misma versión mayor; Express 4.22.3 y `body-parser` 1.20.9 son versiones `latest-4`/`latest-1.x` mantenidas juntas; suites de body parser, CORS, guards, `access-log`, `error-filters` y `pipes-config` con `supertest` sobre Express real |
| `npm audit fix` mueve transitivas de las herramientas (`@babel/*`, `typescript-eslint`) y cambia el lint o ts-jest | Comparar el lint con la base; `npm test` completo |
| Un aviso futuro contra Next 16.4.6 vuelve a cortar el primer arranque bajo un agente | Pregunta 1; documentado en COMANDOS |
| Red o TLS del antivirus | `--use-system-ca`; para Docker, `-ExportCa`. Nunca `NODE_TLS_REJECT_UNAUTHORIZED` |
| `-Stop` corta la sesión de desarrollo del usuario (puerto 3002) | Avisarle antes; levantar de nuevo con `.\dev.ps1` al terminar |
| `npm ci` del backend sin `--legacy-peer-deps` falla (ya pasaba) | Documentado; lo resuelve el 022 |

## 9. Estrategia de tests

- Suites existentes completas en los dos proyectos (criterio 7). En el backend son clave:
  - `error-filters.spec.ts`, `access-log.spec.ts` y `pipes-config.spec.ts`: usan `configureBodyParser` y Express real;
  - `guard-chain.spec.ts` y `login-rate-limit.spec.ts` (la IP sale de `remoteAddress`; `X-Forwarded-For` se ignora);
  - `org-isolation.spec.ts` y `request-dto-invariants.spec.ts`.
- **Nuevo, recomendado: `backend/test/dependency-floors.spec.ts`.** Es un test estructural, del mismo estilo que
  `nest-build-compat.spec.ts`, que deja fijo el criterio 8 y evita que un lockfile regenerado reabra los avisos.
  - Lee el `package.json` **instalado**, resolviendo cada paquete desde quien lo usa: por ejemplo
    `require.resolve('proxy-addr/package.json', { paths: [dirname(require.resolve('express/package.json'))] })`.
  - Comprueba estos mínimos:
    - `proxy-addr` ≥ 2.0.8;
    - `body-parser` ≥ 1.20.9 y `express` ≥ 4.22.3, los dos tal como los resuelve `@nestjs/platform-express`;
    - `multer` ≥ 2.5.0;
    - `qs` ≥ 6.16.1, tal como lo resuelven `express` y `body-parser`;
    - `path-to-regexp` ≥ 0.1.13, tal como lo resuelve `express`.
  - Comprueba también que `axios` y `@nestjs/axios` no estén en `package.json`.
  - Compara versiones con un helper numérico local, sin agregar `semver` como dependencia directa.
- **Deseable: regresión de GHSA-27r3 en `error-filters.spec.ts`.**
  - Se arma con la app de prueba que ya usa `configureBodyParser`.
  - Se hace un `POST` con `Content-Type: application/json`, `Content-Encoding: gzip` y como cuerpo
    `gzipSync('{"a":1}')` seguido de bytes extra.
  - Después se espera un ciclo del event loop y se hace un segundo request.
  - Se aserta que no hubo `uncaughtException`, con un listener temporal en `process`, y que el segundo request
    responde.
  - Se escribe **antes** de aplicar los `overrides`, para verlo fallar con 1.20.4. Si el entorno de Jest no permite
    observarlo de forma estable, se reemplaza por una prueba manual del tester con `curl --data-binary` y se documenta.
- Frontend: `npm test`, `tsc`, `build` y lint. Next no necesita un test nuevo: la versión exacta en `package.json` y
  `npm audit` cubren el criterio.
- Tester:
  - arranque en frío (`-Stop`, borrar `.next`, `.\dev.ps1`, `-Smoke`) sin `SecurityFatalError`;
  - `/docs` carga;
  - `npm audit` final de los dos proyectos, adjuntado como resumen en `07-testing.md`;
  - build Docker, o "no verificable" por #104.

## 10. Plan de implementación en pasos chicos

1. Línea base (`npm audit` antes del cambio; los conteos de lint están en la sección 1).
2. Backend #61: `npm uninstall` → `tsc`, `nest build` y `npm test`.
3. Backend: test `dependency-floors` (y la regresión de `body-parser` si es viable). Tienen que fallar.
4. Backend: `overrides` → `npm install --legacy-peer-deps` → `npm audit fix --legacy-peer-deps` → `npm ls` y
   `npm audit`. Los tests del paso 3 pasan.
5. Backend: verificaciones completas de la sección 5.1.
6. Frontend: Next 16.4.6 y `eslint-config-next` → `npm audit fix` → `npm ls`, `npm audit` y las verificaciones del
   frontend.
7. Revisión de scripts y orígenes (sección 5, paso 3) y `npm ci` desde cero (paso 4).
8. Arranque en frío con `-Smoke`, `/docs` y build Docker.
9. `04-implementacion.md` con los resultados de `npm audit`, antes y después, por proyecto, y la lista de lo que queda.

## 11. Qué queda para el 022 (y otros pendientes)

| Paquete | Sev. | Prod/dev | Explotable | Por qué no se corrige acá |
|---|---|---|---|---|
| `@nestjs/core` 10.4.22 (GHSA-36xv, SSE) | moderado | prod | No (no hay SSE) | Corregido en 11.1.18 |
| `@nestjs/common` 10.4.22 → `file-type` 20.4.1 (GHSA-5v7r, GHSA-j47w) | moderado | prod | No (sin `ParseFilePipe`) | `file-type` 21 (major, fijado por Nest) o Nest 11.1.17 o superior |
| `@nestjs/platform-express`, `@nestjs/testing` | moderado | prod/dev | No | Solo por `@nestjs/core` |
| `@nestjs/cli` 10.4.9: `glob` 10.4.5, `tmp` 0.0.33, `webpack` 5.97.1, `@angular-devkit/*` 17 (con `ajv` y `picomatch` 4.0.1), `@nestjs/schematics` 10, `inquirer`/`external-editor` | alto/moderado/bajo | dev | No (herramientas locales; webpack no corre) | Fijados por la CLI 10; se corrigen con `@nestjs/cli` 11 y `@nestjs/schematics` 11 |
| Conflicto de peers de `@nestjs/swagger` 11 con Nest 10 (obliga a `--legacy-peer-deps`) | — | — | — | Desaparece con Nest 11 |

Para registrar en BACKLOG, fuera del 022:
- el riesgo residual del aviso dinámico de Next (si no se resuelve con la Pregunta 1);
- la telemetría de `@scarf/scarf` (Pregunta 3);
- `frontend/AGENTS.md` (Pregunta 4).

## 12. Preguntas al PO (ninguna bloquea el diseño)

1. **Aviso de actualización de Next.** Con 16.4.6 se cumple el criterio 1 hoy. Pero el aviso se calcula en cada
   arranque contra el registro: cuando aparezca un aviso nuevo que afecte a 16.4.6, el primer `next build`/`next dev`
   bajo un agente vuelve a cortarse, y una persona en una terminal ve un menú. Opciones:
   - **A (por defecto si no hay respuesta):** no tocar `next.config.ts`; se documenta el comportamiento en COMANDOS y se
     abre un ítem en BACKLOG;
   - **B:** agregar `experimental: { agentUpgrade: false }` en `next.config.ts` (1 línea, sin efecto funcional). El
     arranque deja de depender del registro y los avisos de Next se siguen viendo con `npm audit`, que es la vía
     acordada; además es coherente con la decisión de no ejecutar comandos que pidan los avisos.

   El arquitecto se inclina por B, porque cumple "arranque siempre a la primera", pero es un cambio de configuración que
   la spec no lista.
2. **Cadena de desarrollo de `@nestjs/cli` 10** (`glob`/`tmp` altos, entre otros): se propone **diferirla al 022** (D3).
   Ninguno corre en el API, y forzar versiones arriesgaría `nest start --watch`. ¿Confirma?
3. **`@scarf/scarf`** (preexistente): su `postinstall` manda telemetría al instalar. ¿Se registra en BACKLOG para
   desactivarla (`"scarfSettings": { "enabled": false }` en `backend/package.json`, o `SCARF_ANALYTICS=false` en los
   builds) en un feature aparte?
4. **`frontend/AGENTS.md`** (sin seguimiento en git): lo escribe y lo vuelve a escribir `next dev`
   (`generate-agent-files.js`). El arranque en frío del tester lo va a recrear. ¿Se ignora en `.gitignore`, se versiona
   o se deja como está? Se propone dejarlo fuera del 021 y registrarlo en BACKLOG.

**`proxy-addr` no requiere decisión:** se corrige sin Nest 11 (2.0.8 con `npm audit fix`) y además no es explotable.

## 13. Notas para el documentador

- **BACKLOG:**
  - cerrar #36, #61 y #103;
  - en #25, marcar hecha la parte de `npm audit fix` y dejar el plan de Nest/Prisma en el 022;
  - en #35, actualizar la lista de lo que queda (sección 11).
- **COMANDOS:**
  - reemplazar la fila de problemas "`-Smoke` da Frontend FALLO… `SecurityFatalError`" por la explicación de la sección
    3.3 (cuándo vuelve a aparecer y que nunca se ejecuta `next upgrade`);
  - indicar que `npm ci` del backend lleva `--legacy-peer-deps`.
- **`CLAUDE.md`:** Next pasa de 16.1 a 16.4.6 en "Stack", y hay que actualizar el conteo de tests del backend si se
  agrega el test.

VEREDICTO: APROBADO
