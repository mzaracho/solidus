# 05 — Revisión: 013-errores-sin-details

> Autor: agente revisor. El agente devolvió el informe en su respuesta sin escribir el archivo, así que el PO lo
> transcribe sin cambios de fondo. Una sesión anterior de revisión se cortó por límite de uso y esta es la revisión
> completa. No se modificó código.

## Resultados de calidad
- **Backend:** `npx tsc --noEmit` sin errores; `npm test` con 39 suites y 682 tests en verde.
- **Frontend:** `npx tsc --noEmit` sin errores; `npm test` con 53 tests y 0 fallas; `npm run build` OK.
- **ESLint del backend** sobre los archivos tocados:
  - sin `prettier/prettier`, no hay errores nuevos propios del feature;
  - hay avisos de `eslint-disable` sin efecto en specs nuevos (M-1);
  - un `no-unnecessary-type-assertion` (línea 292) que no se ubicó;
  - con prettier activo aparece el ruido de CRLF preexistente.

## Cumplimiento de los criterios
1. **Contrato único (`error-contract.ts`).**
   - Solo `code` y `errors`, sin `details`.
   - 401, 403 y 404 con mensaje genérico y código curado; 5xx con el genérico del 500.
   - Los demás 4xx dejan pasar el mensaje solo si traen un código curado válido, con tope de 300 caracteres.
   - `mapException` no lanza.
2. **Validación:** `validation-failed`, con un tope de 20 mensajes de 200 caracteres.
3. **500.**
   - El body es genérico.
   - El log queda con este formato: `error id=<uuid> METHOD ruta status descripción`.
   - `X-Error-Id` solo en 5xx.
   - De Prisma solo se registran la clase y el código. El stack va por `logDebug` y únicamente para errores que no son
     de Prisma.
4. **Negocio.**
   - Solo quedan como `Error` el arranque, la configuración y `dispatcher.ts`; el invariante lo verifica.
   - Status nuevos: 409 por CUIT duplicado, 400 `first-load-required`, 400 por falta de profesional y 500 genérico en
     `fee-resolution`.
   - Los textos quedan en español.
5. **Falla de base en el guard:** responde un 500 genérico, con test.
6. **Manejador final:** `app.init()`, después `app.use(finalErrorHandler)` y después `listen`. Maneja `headersSent` y
   nunca devuelve HTML ni stack.
7. **`axios-filter.ts`:** eliminado, sin referencias, con un invariante que lo vigila.
8. **Frontend.**
   - `api-errors.ts` coincide con el diseño.
   - `data.ts` ya no tiene `Failed to`, `.text()`, `details` ni `new Error(`; sus 35 ramas usan `toApiError`.
   - `apiFetch`, `login` (con el 429 del 012), `ApiForbiddenError` e `isHandledApiError` no cambian.
   - Los 9 componentes usan `errorMessageOf`.
   - Se quitó la heurística de `Foreign key`.
9. **Tests.**
   - Specs nuevos de contrato, filtros, manejador final y `fee-resolution`, más invariantes.
   - El helper `call` valida el contrato.
   - Los tests ajustados no se debilitaron; algunos se reforzaron.
10. **Calidad:** se cumple, con las salvedades de ESLint de arriba.
11. **Verificación en vivo:** le corresponde al tester.

**Borrar una prestación con registros (400 → 409):** es correcto y estaba previsto en el diseño (§3.2). Ahora
`ActivityTypesManager.tsx` muestra el mensaje del backend.

## Hallazgos
**Bloqueantes:** ninguno. **Mayores:** ninguno.

**Menores:**
- **M-1:** avisos de `eslint-disable` sin efecto en `error-filters.spec.ts`, `final-error-handler.spec.ts` y otro spec.
- **M-2 (B-1 de seguridad):** `activity-type-commands.ts:~89` refleja `role.roleLabel` en el 400.
- **M-3:** `describeForLog` duplica el saneado de `neutralizeUnsafeChars`. En producción registra `error.message` de
  errores que no son de Prisma (B-3 de seguridad).
- **M-4:** el orden `init()` → `app.use(finalErrorHandler)` de `bootstrap.ts` no tiene un test sobre el bootstrap real.
- **M-5:** acoplamiento circular de capas entre `body-parser-config` y `error-contract`, sin un ciclo de módulos en
  runtime.
- **M-6 (B-2 de seguridad, preexistente):** el CUIT de una organización en `payer-commands.ts:162-167` permite
  enumerar entre organizaciones.
- **M-7:** inconsistencias de indentación en `fee-rule-splits.ts` y en un import largo. Es ruido de formato.
- **M-8:** `AtencionesTable.tsx:145` muestra un toast y relanza el error, y `WorkItemForm.tsx:456` muestra otro, así
  que el aviso sale duplicado. Ya pasaba antes, pero ahora se ve más con los mensajes de negocio.

**Sugerencias:**
- `axios` y `@nestjs/axios` quedan sin uso (BACKLOG).
- Los mensajes de class-validator salen en inglés, aceptado (decisión 4).
- Los 4xx pasan a `logDebug`, porque la línea de acceso del 010 ya registra el status.

Veredicto de la primera revisión (historial): APROBADO.

## Re-revisión (vuelta 1)

> Autor: agente revisor. No se modificó código.

### Verificación
- **M-2 / B-1:** `activity-type-commands.ts` ya no interpola `roleLabel`. El mensaje es fijo ("Un rol con porcentaje fijo no tiene porcentaje definido.") y conserva `code: 'bad-request'`. Cerrado.
- **M-8:** `AtencionesTable.tsx` `handleSave` solo relanza, sin toast. `WorkItemForm.tsx` (catch ~452) es el único que avisa y omite el aviso si `isHandledApiError`. `AdmisionesTable.handleSave` y `PacientesTable.handleNewEntry` no capturan ni muestran toast. Los 3 usos de `WorkItemForm` muestran el error una sola vez. Cerrado.
- **M-1:** `error-filters.spec.ts` y `final-error-handler.spec.ts` sin directivas inútiles (`--report-unused-disable-directives`, 0 hallazgos en specs y `error-contract.ts`). Cerrado.
- **M-3:** parcial. El comentario en `describeForLog` explica por qué no se reutiliza `neutralizeUnsafeChars`. Sigue el registro de `error.message` en producción (B-3 de seguridad, aceptado). Cerrado como documentado.
- **M-4, M-5, M-6, M-7:** sin cambios, siguen como menores abiertos y no bloqueantes.

### Calidad
- Backend: `npx tsc --noEmit` sin errores; `npm test` 39 suites / 682 tests en verde.
- Frontend: `npx tsc --noEmit` sin errores; `npm test` 53 pasan, 0 fallan.
- ESLint (con unused-directives): sin hallazgos en los specs de filtros ni en `error-contract.ts`. `activity-type-commands.ts`, `AtencionesTable.tsx` y `WorkItemForm.tsx` muestran errores preexistentes (`no-unsafe-*`, `no-explicit-any`, prettier) ajenos a las líneas cambiadas.

### Hallazgos nuevos
- **Menor:** el comentario del catch de `WorkItemForm.tsx` (~líneas 453-454) dice que el padre (`AtencionesTable`) ya muestra el error. Quedó desactualizado; conviene borrarlo.

Bloqueantes: ninguno. Mayores: ninguno.

VEREDICTO: APROBADO
