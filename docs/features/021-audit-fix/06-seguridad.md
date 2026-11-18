# 021 — Revisión de seguridad

Revisor: seguridad. Fecha: 2026-11-18. Alcance: `git diff` contra HEAD (75fae4c). Solo lectura; TLS nunca se desactivó (`NODE_OPTIONS=--use-system-ca`).

## Resumen

Cambio de dependencias y de una opción de config. No toca autenticación, autorización, validación, sesiones ni CORS. Reduce superficie: corrige un DoS anónimo (body-parser, GHSA-27r3) y un crítico (proxy-addr). Sin bloqueantes.

## Verificaciones

| Comprobación | Resultado |
|---|---|
| backend `npm audit --omit=dev` | 0 críticos, 0 altos, 4 moderados (@nestjs/core, @nestjs/platform-express, @nestjs/common, file-type) |
| backend `npm audit` (todo) | 18: 0 críticos, 4 altos, 11 moderados, 3 bajos (todos de desarrollo) |
| frontend `npm audit` y `--omit=dev` | 0 vulnerabilidades |
| `resolved` fuera de registry.npmjs.org (diff de ambos lockfiles) | ninguno |
| Paquetes nuevos o cambiados con `hasInstallScript` | ninguno nuevo. Los existentes con script: backend `@nestjs/core`, `@prisma/*`, `prisma`, `@scarf/scarf`, `bcrypt`, `fsevents`; frontend `unrs-resolver` (sin cambios de versión) |
| Secretos en el diff | ninguno (`.vscode/settings.json` solo tiene `python.terminal.useEnvFile`) |
| backend `npx tsc --noEmit` | sin errores |
| backend `npm test` | 58 suites, 1032 tests, todo verde |

## Evaluación de lo que queda

Backend, producción (4 moderados), no explotables en este uso:
- `file-type` (bucle infinito en ASF, bomba ZIP): lo usa `@nestjs/common` solo en `FileTypeValidator`/`ParseFilePipe`. Ni `src/` ni los DTOs usan subida de archivos ni esas clases (`grep` de `FileInterceptor`, `multer`, `file-type` en `src/`: sin resultados). No alcanzable.
- `@nestjs/core` GHSA-36xv (neutralización de salida): afecta al uso de SSE (`@Sse`/`SseStream`). `src/` no usa SSE. No alcanzable. Se cierra con Nest 11/12 (item 022).
- `@nestjs/platform-express`: es el arrastre de `@nestjs/core`.
- `multer` 2.5.0 por override igualmente (sin subidas, defensa en profundidad).

Backend, desarrollo (altos: cadena `@nestjs/cli` 10: `glob`, `minimatch`, `tmp`, `webpack`, `ajv`, `picomatch`): son herramientas de build. El Dockerfile las usa solo en la etapa `builder` (`npm install` + `npm run build`), pero **copia todo `node_modules` al runner** (comentado: para tener la CLI de prisma). El proceso de producción es `node dist/src/api/main.js`; la cadena de `@nestjs/cli` no se ejecuta en runtime ni procesa entrada de usuarios. Riesgo residual: solo presencia en la imagen (ver H-2).

## Paquetes nuevos mencionados

- `@isaacs/nonrecursive-glob-match` 1.1.0: legítimo. Autor isaacs (mantenedor de minimatch/glob), licencia BlueOak-1.0.0, descripción "single-path-portion glob matcher not subject to recursive backtracking ReDoS". Lo trae `minimatch` 11 anidado bajo `@typescript-eslint/typescript-estree` (backend, línea 2757 del lock; ídem frontend). Solo desarrollo (`dev: true`), sin script de instalación (los `prepare`/`prepublishOnly` del package.json son de publicación y no corren al instalar como dependencia). `backend/package-lock.json:1126`.
- `@humanfs/types` 0.15.0: Apache-2.0, solo dev, sin scripts (lock backend:985, frontend:555). Del ecosistema `eslint/humanfs`.
- `js-yaml` 5.5.0 y `argparse` 3.0.4: anidados en `@nestjs/swagger` (producción, backend lock ~1919). Sin scripts, `resolved` del registry, con integridad. Swagger solo se sirve en development/test; igualmente son de rango compatible con swagger 11.4.8. Sin hallazgo.
- `@scarf/scarf` (telemetría en postinstall): ya existía y está decidido en BACKLOG.

## `experimental.agentUpgrade: false` (`frontend/next.config.ts:10-14`)

Leído en `node_modules/next/dist`: el esquema acepta `'security' | 'latest' | 'experimental-future' | false` (`server/config-schema.js:202`), por defecto `'security'` (`config-shared.js:192`). `build/index.js:545` y `server/lib/router-server.js:173` solo ejecutan la lógica de aviso/`SecurityFatalError` si la política es una de las tres cadenas (o por variable `__NEXT_AGENT_UPGRADE`, que fija `next upgrade`). Con `false` se desactiva únicamente el aviso de actualización y el corte para agentes; no toca cabeceras, CSP, validación de config ni otras comprobaciones. No oculta nada más.

Trade-off: se pierde el aviso temprano de seguridad de Next al correr `dev`/`build`; mitigado porque `npm audit` (0 en frontend) sigue mostrando los avisos de Next, y el aviso del propio Next es un canal en tiempo real que hoy no aporta nada nuevo. Aceptable, siempre que `npm audit` se corra periódicamente (ver M-1).

## Overrides y pisos

`express ^4.22.3`, `body-parser ^1.20.9`, `multer ^2.5.0` (`backend/package.json:68-72`): ningún override fija una versión vulnerable; el `^` solo admite parches/menores de la misma mayor posteriores al piso corregido, así que no reabre avisos (los rangos aceptan versiones más nuevas, no más viejas). `test/dependency-floors.spec.ts` verifica versiones instaladas (express, body-parser desde Nest y express, multer, proxy-addr, qs, path-to-regexp), ausencia de `axios`/`@nestjs/axios` y los valores de `overrides`; el desarrollador comprobó que falla sin los overrides. `body-parser-gzip.spec.ts` cubre la regresión funcional del DoS. Los `invalid` de `npm ls` son un efecto conocido de npm con overrides sobre `express`; `npm ci` funciona.

## Hallazgos

### CRÍTICA
Ninguno.

### ALTA
Ninguno.

### MEDIA
Ninguno.

### MENOR
- **M-1** `frontend/next.config.ts:10`: al desactivar el aviso de Next, la detección depende de correr `npm audit`. Remediación: incluir `npm audit --omit=dev` de ambos proyectos en la rutina periódica/CI (backlog), y revisar `agentUpgrade` al subir de versión de Next.
- **M-2** `backend/package.json:68-72`: los overrides son permanentes y sin comentario en el JSON (no admite comentarios). Remediación: dejar anotado en el 022 (Nest 11) que se deben retirar y re-verificar `dependency-floors.spec.ts` entonces.

### INFO
- **H-2 (INFO)** `backend/Dockerfile:42-45` (`COPY --from=builder /app/node_modules`): la imagen de runtime incluye dependencias de desarrollo (cadena `@nestjs/cli`, `@scarf/scarf`). No son alcanzables en ejecución, pero amplían la imagen. Ya estaba así y el comentario del Dockerfile lo justifica. Remediación futura: `npm prune --omit=dev` conservando `prisma` (moverlo a `dependencies`).
- **I-3** El `npm audit fix` del backend necesita dos pasadas para converger (documentado en 04-implementacion.md).
- **I-4** Los moderados de producción restantes se cierran solo con Nest 11/12 (breaking): corresponde al item 022.

VEREDICTO: APROBADO
