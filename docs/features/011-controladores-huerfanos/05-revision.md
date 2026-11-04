# 011 — Revisión

## Resultados
- `npx tsc --noEmit` (backend): sin errores.
- `npm test` (backend): 32 suites, 567 tests, todos en verde (incluye `org-isolation.spec.ts` con el test `(a2)`).
- ESLint de `security-invariants.spec.ts` y `test/org-isolation.spec.ts`: 85 errores, todos `prettier/prettier` por fin de línea CRLF en
  el working tree (HEAD está en LF) y líneas largas anteriores; más 3 warnings de eslint-disable sin uso. Ningún error de
  regla de tipos ni de lógica. No hay errores nuevos atribuibles al feature.
- Grep en `backend/` (sin `node_modules` ni `dist`): ninguna referencia en código a `ProductionController`, `ReportingController`,
  `GetMyProductionQuery`, `GetDaily/Debtors/MonthlyReportQuery` ni a los archivos de queries. Sin uso en `frontend/src`.
  Los 4 archivos borrados no tenían módulo que los registrara.

## Spec
1. Archivos eliminados y entradas de `security-invariants.spec.ts` quitadas: cumple.
2. Guardia estructural `(a2)`: cumple. Lista blanca vacía y justificada en comentario.
3. Sin cambios de comportamiento: cumple (las rutas ya daban 404; el test estructural de rutas con parámetros sigue verde).
4. Calidad: cumple.
5. Verificación del tester: pendiente (no es de este rol).

## Invariantes de `security-invariants.spec.ts`
Se quitaron solo: las 4 entradas `*.userId` de `ID_FIELDS` (clases borradas), `NOT_REGISTERED_ALLOWLIST`, su `continue` y su test de
entradas obsoletas. El test "ID_FIELDS coincide con lo encontrado" sigue exigiendo igualdad exacta con las clases reales, así que la
eliminación es coherente (si hubiera quedado una entrada de más, fallaría). El test 009 de campos `controller` ya no tiene
excepciones, es decir, es más estricto. No se debilitó ninguna otra invariante.

## Hallazgos
- BLOQUEANTE: ninguno.
- MAYOR: ninguno.
- MENOR 1 — `test/org-isolation.spec.ts` (test `(a2)`): solo detecta clases **exportadas**. Un `@Controller` declarado sin `export`
  quedaría fuera, pero tampoco podría registrarse en un módulo desde otro archivo, así que el riesgo es nulo en la práctica. Opcional:
  comentarlo.
- MENOR 2 — `(a2)`: la comparación es por identidad de clase entre el `require` del test y el `metatype` del `ModulesContainer`.
  Funciona porque Jest resuelve el alias `@src/*` y la ruta relativa al mismo archivo (el test pasa y la guardia detectó los dos
  huérfanos antes del borrado, según 04). Si cambiara el `moduleNameMapper`, daría falsos positivos (no falsos negativos), por lo que
  falla del lado seguro.
- MENOR 3 — `(a2)`: `require` de todos los archivos de `src/api/controllers/**` solo ejecuta imports y decoradores; hoy no hay
  efectos secundarios (no hay código a nivel de módulo más allá de definiciones). `base-controller.ts` no tiene `@Controller`, por lo
  que no se cuenta. Los `.ts` que no son controladores (DTOs, helpers) se ignoran porque exigen `PATH_METADATA` propia en una
  función exportada. `Reflect.hasOwnMetadata` evita heredar metadata de una clase base. Sin falsos negativos obvios.
- MENOR 4 — La guardia comprueba "registrado en algún módulo que AppModule carga", no que el módulo sea alcanzable por rutas
  (correcto para el criterio 2). Un módulo huérfano completo (no importado por AppModule) también se detecta, porque sus
  controladores no aparecen en `ModulesContainer`.
- MENOR 5 — Documentación desactualizada (de la etapa del documentador): `backend/docs/API_DOCUMENTATION.md` y
  `API_DOCUMENTATION_ES.md` línea 17 listan `GET /my-production`; además `docs/auditoria/ARQUITECTURA.md`, `BACKLOG.md` y
  `RIESGOS.md` mencionan los controladores. Sugerencia: quitar la línea de `my-production` de ambos API_DOCUMENTATION y sumarlos al
  alcance del documentador.
- SUGERENCIA — Los imports `fs` y `path` quedaron entre `@nestjs/testing` y `crypto`; se puede ordenar, sin impacto.

## Veredicto
Borrado de código muerto limpio y guardia estructural correcta y verificada. Sin bloqueantes ni mayores.

Veredicto de la primera revisión (historial): APROBADO.

## Re-revisión (vuelta 1)

- Borrado de `profile-controller.ts`, `update-profile-command.ts` y `update-profile.dto.ts`: grep en `backend/src` y `backend/test` sin referencias a `ProfileController`, `UpdateProfile*` ni a las rutas de archivo. Correcto.
- `config-module.ts`: import y entrada de `ProfileController` quitados; `controllers: [OrgController, ProController]`. Sin otros cambios.
- Guardia `(a2)` sobre todo `backend/src`: excluye `*.spec.ts`, `*.d.ts`, `api/main.ts` (ejecuta `void bootstrap()`) y `infrastructure.bootstrap/bootstrap.ts` (crea la app y hace `listen`). Verifiqué con grep que no hay otros archivos con `listen`, `NestFactory.create` ni llamadas a nivel de módulo; la exclusión está justificada. La lista blanca sigue vacía y se valida contra entradas obsoletas.
- Imports ordenados (`crypto`, `fs`, `path` antes de `@nestjs`). Sugerencia previa resuelta.
- `npx tsc --noEmit`: sin errores. `npm test`: 32 suites, 567 tests en verde. `npx eslint` sobre los archivos tocados: solo errores de prettier preexistentes (CRLF, formato ajeno), ninguno nuevo.
- Hallazgos nuevos: ninguno. MENOR 5 (documentación `API_DOCUMENTATION*.md`) sigue pendiente para el documentador.

VEREDICTO: APROBADO
