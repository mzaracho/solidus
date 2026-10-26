# Estado del proyecto — build, lint, tests y deuda técnica

> Ejecutado el 2026-10-26 en Windows 11, Node v24.13.0, npm 11.6.2.
> Dependencias ya instaladas en ambos repos (`node_modules` presente). No se instaló nada.
> No se levantó base de datos ni Docker.

## Resumen

| Repo | Type-check | Build | Lint | Tests | Cobertura |
|---|---|---|---|---|---|
| backend | OK (exit 0) | OK (exit 0) | **FALLA**: 768 errores, 19 warnings | **FALLA**: "No tests found" (exit 1) | 0 % |
| frontend | OK (exit 0) | Falla con config por defecto (Google Fonts/TLS); **OK** con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` | **FALLA**: 133 errores, 54 warnings | No hay framework de tests | 0 % |

## Backend

### Type-check
`npx tsc --noEmit -p tsconfig.json` → exit 0, sin errores.
El cliente Prisma generado en `node_modules/.prisma/client` está al día con el schema
(contiene `canLoadActivities` y `createdByUserId`).

### Build
El script `npm run build` es `tsc --noEmit && nest build`, y `nest build` borra y reescribe
`dist/`. Para no tocar artefactos existentes se ejecutó la compilación equivalente hacia una
carpeta temporal:

```
npx tsc -p tsconfig.build.json --outDir <scratchpad>/be-build
```
Resultado: exit 0; genera `src/api/main.js`. Se considera que `npm run build` compila.

### Lint
`npm run lint` ejecuta `eslint ... --fix` **y modifica archivos**; por eso se corrió sin `--fix`:

```
npx eslint "{src,apps,libs,test}/**/*.ts"
```
Resultado: exit 1. 125 archivos analizados, 73 con problemas, **768 errores y 19 warnings**.

| Regla | Cantidad |
|---|---|
| prettier/prettier (E) | 541 |
| @typescript-eslint/no-unsafe-member-access (E) | 87 |
| @typescript-eslint/no-unsafe-assignment (E) | 64 |
| @typescript-eslint/no-unused-vars (E) | 46 |
| @typescript-eslint/no-unsafe-argument (W) | 19 |
| @typescript-eslint/no-unsafe-call (E) | 10 |
| @typescript-eslint/no-unsafe-return (E) | 7 |
| @typescript-eslint/no-unnecessary-type-assertion (E) | 6 |
| @typescript-eslint/require-await (E) | 6 |
| @typescript-eslint/no-empty-object-type (E) | 1 |

El 70 % es formato (Prettier); con `--fix` bajaría a unos 230 errores reales de tipado `any`.

### Tests
`npx jest` → exit 1:
```
No tests found, exiting with code 1
  126 files checked. testRegex: .*\.spec\.ts$ - 0 matches
```
- No existe ningún `*.spec.ts`.
- `test/app.e2e-spec.ts` es el boilerplate de Nest (espera `GET /` → "Hello World!", que no
  existe: `/` sirve Swagger). Además `test/jest-e2e.json` no tiene `moduleNameMapper` para
  `@src/*`, así que fallaría al resolver imports. No se ejecutó porque `AppModule` conecta a
  PostgreSQL en `onModuleInit` (requiere DB levantada).

### No ejecutado
| Comando | Motivo |
|---|---|
| `npm run test:e2e` | Requiere PostgreSQL en 5433; además el test está roto (ver arriba) |
| `npx prisma migrate status` | Requiere DB |
| `npm run start:dev` | Requiere DB |
| `docker compose up --build` | Levanta servicios externos; fuera del alcance de una auditoría de solo lectura |

## Frontend

### Type-check
`npx tsc --noEmit` → exit 0. (Los archivos versionados `tsc_error.txt`, `tsc_errors*.log`,
`tsc_output*.txt`, `build_log.txt`, `lint_output.txt` son logs viejos de feb-2026 y **no**
reflejan el estado actual.)

### Build
`npx next build`:
- Primer intento → **exit 1**:
  ```
  next/font: error: Failed to fetch `Inter` from Google Fonts.
  ... Hint: It looks like this error was TLS-related. Try enabling system TLS certificates
  with NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1
  ```
  El build depende de red hacia `fonts.googleapis.com` (`src/app/layout.tsx` usa `next/font/google`).
- Segundo intento con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` → **exit 0**,
  18 rutas generadas (incluida `/test-suite`).
- Warning: `The "middleware" file convention is deprecated. Please use "proxy" instead.`
- El build sobrescribió `.next/` (artefacto ignorado por git); no cambió archivos versionados.

### Lint
`npx eslint .` (equivale a `npm run lint`, que no usa `--fix`) → exit 1.
84 archivos, 37 con problemas, **133 errores y 54 warnings**.

| Regla | Cantidad |
|---|---|
| @typescript-eslint/no-explicit-any (E) | 120 |
| @typescript-eslint/no-unused-vars (W) | 38 |
| react-hooks/exhaustive-deps (W) | 14 |
| react/no-unescaped-entities (E) | 4 |
| react-hooks/preserve-manual-memoization (E) | 4 |
| react-hooks/set-state-in-effect (E) | 4 |
| prefer-const (E) | 1 |
| react-hooks/incompatible-library (W) | 1 |

Hay además varios `// eslint-disable-next-line react-hooks/exhaustive-deps` en `WorkItemForm.tsx`.

### Tests
No hay Jest/Vitest/Playwright configurados ni tests. La única "suite" es `src/app/test-suite/page.tsx`,
una página que ejecuta llamadas reales contra la API (crea pacientes, reglas y atenciones,
renombra la organización). No es un test automatizado.

## Cobertura aproximada
- Backend: **0 %** (sin tests unitarios ni e2e funcionales).
- Frontend: **0 %**.
- La lógica más sensible sin cobertura: `ActivityService.createActivity` (montos y splits),
  `FeeResolutionService`, `DashboardService` (KPIs), `CalculateSettlementsQuery`,
  `MergePatientCommand`, `DeleteStaffCommand`.

## Tamaño
- Backend: ~6.900 líneas TS en `src/` (125 archivos).
- Frontend: ~10.700 líneas TS/TSX en `src/` (83 archivos); `services/data.ts` 949 líneas,
  `WorkItemForm.tsx` 858 líneas.

## Deuda técnica

### Transversal
- Repo raíz sin `.gitmodules` ni remoto: los gitlinks `backend`/`frontend` no son submódulos
  funcionales; el puntero de `backend` está desactualizado (`M backend`).
- Mensajes de commit poco descriptivos ("cambios", "Testeos").
- Seeds en SQL plano generados por scripts Python con rutas absolutas locales
  (`C:\Users\Administrador\Downloads\Psico_LSA.xlsx`).
- Archivos de log viejos versionados en `frontend/`.
- READMEs con placeholders (`[PENDIENTE - actualizar]`); el README del backend indica
  `prisma db push` aunque el proyecto usa migraciones (`migrate deploy` en Docker).

### Backend
- Autenticación/autorización incompleta (detalle en `RIESGOS.md`).
- `CORS_ORIGIN`/`CORS_METHODS` se leen pero se ignoran (`origin: true` "Temporary Debug").
- Dos `JwtModule` con secretos y expiraciones distintas (global `JWT_SECRET`/1d vs
  `AuthModule` con un secreto de fallback hardcodeado, eliminado en el feature 002; expiración 8h);
  ahora `JWT_SECRET` es obligatorio.
- `VerifyTokenService`, `ApiKeyGuard`, `LogoutCommandHandler`, `UpdateProfileCommandHandler` son stubs.
- `ConfigController` duplica CRUD de categorías y activity types de `OrgController` sin guards.
- Lógica de negocio en controladores (`ProController`, `OrgController.lookupStaffByCuit` usan Prisma directo).
- Operaciones multi-paso sin transacción (alta de actividad, merge de pacientes).
- Errores de negocio con `throw new Error(...)` → HTTP 500 en vez de 4xx.
- Montos `Decimal` convertidos a `Number` (float) en cálculos de splits y KPIs.
- `ValidationPipe` sin `whitelist`/`forbidNonWhitelisted`; `FeeRulesController.create` pasa el
  body directo como `Prisma.FeeRuleCreateInput`.
- `console.log` de diagnóstico en servicios y dispatcher (incluye payloads completos).
- `PrismaService` registrado en `PrismaModule` y otra vez en `ConfigModule` (dos clientes/pools).
- Dashboard agrega en memoria todos los WorkItems del rango (no escala).
- Dos valores para "modo profesional" (`PROFESSIONAL` y `pro`) y el modo llega por header o query.
- Frontend usa `PAYMENT_STATUS.PENDING`, que no existe en el enum Prisma.
- `Notification`, `Settlement.status` sin enum, `@nestjs/axios` sin uso real.
- Dependencias principales con una o dos majors de atraso (Nest 10 → 12, Prisma 5 → 7).

### Frontend
- Toda la capa de datos en un archivo (`services/data.ts`), sin react-query real pese a tenerlo.
- Token JWT manejado en cookie escrita por JS; `middleware.ts` solo verifica presencia.
- Componentes grandes con mucho `any` y efectos con deps desactivadas (`WorkItemForm.tsx`).
- `src/app/test-suite` desplegado en producción.
- Build dependiente de Google Fonts en tiempo de build.
- `middleware.ts` usa una convención deprecada en Next 16 (`proxy`).
