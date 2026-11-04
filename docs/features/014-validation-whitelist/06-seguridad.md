# 06 — Revisión de seguridad: 014-validation-whitelist

> Autor: agente de seguridad. El agente devolvió el informe en su respuesta sin escribir el archivo, así que el PO lo
> transcribe sin cambios de fondo. Solo lectura.
> - Comandos: `npx tsc --noEmit` del backend sin errores; `npm test` del backend con 42 suites y 770 tests en verde;
>   `npm test` del frontend con 87 tests; `npm audit --omit=dev` del backend.
> - Además, una prueba de humo en el scratch con las opciones reales del pipe.

## Resumen
No hay hallazgos críticos, altos ni medios: hay 3 bajos y 4 informativos. Todos los bodies y queries pasan ahora por el
pipe global, lo que es una mejora neta de seguridad.

## Revisión por punto
1. **Mass assignment: sin hallazgos.**
   - **Bodies:** `whitelist` más `forbidNonWhitelisted`, así que un campo no declarado da 400.
   - **Queries:** `whitelist` descarta lo que sobra, y los números van con `@Type(() => Number)`.
   - **Campos con `declare`** (`id`, `organizationId`, `orgId`, `userId`): en el body dan 400 y en la query se
     descartan. El controlador los asigna después del pipe.
   - `useDefineForClassFields: true` en Jest reproduce producción (ES2023).
   - **Objetos anidados:** `@ValidateNested` con `@Type`, con whitelist aplicada.
   - **Settings:** el handler copia 7 claves, así que hay doble barrera.
   - **`splits`:** `@IsArray` más `validateFeeRuleSplits`.
   - **Prototype pollution:** `__proto__` y `constructor` se descartan sin quedar en el objeto, y el prototipo no cambia.
2. **Tipos: sin hallazgos.**
   - Sin conversión implícita: un string que llega como número u objeto da 400.
   - Validadores: `IsUUID('loose')`, `IsDateString({ strict: true })` y enums de dominio.
   - Montos de 0 a 99.999.999,99, sin NaN ni Infinity; `MaxLength` en los strings.
   - `forbidUnknownValues`: un array o un primitivo como body da 400.
3. **Convivencia con los guards: sin hallazgos.**
   - Los guards leen el request crudo antes del pipe, y ningún DTO declara `mode` ni la organización.
   - El desvío 2 (organización ajena da 403, propia da 400) no abre un oráculo: el guard responde igual a una
     organización ajena y a una inexistente.
4. **Mensajes:** `validationError` con `target: false` y `value: false`, así que no se refleja ningún valor (ver
   B-1). Cumplen el contrato del 013.
5. **Invariante `request-dto-invariants.spec.ts`: efectivo.**
   - Usa el `AppModule` real y revisa todo `@Body()` y `@Query()`, incluidos los anidados.
   - Cubre 20 bodies y 8 queries, sin allowlist.
   - Los invariantes nuevos prohíben `enableImplicitConversion: true` y `@Allow(`.
6. **Frontend: sin hallazgos.** Los builders usan listas explícitas, no agregan identidad salvo `organizationId` en
   `POST activity` (I-2) y mandan `mode` por header o query.
7. **Secretos y datos reales:** sin hallazgos. El fixture usa datos ficticios obvios.

## Hallazgos

### Críticos, altos y medios
Ninguno.

### Bajos
- **B-1:** con `forbidNonWhitelisted`, el mensaje `property <clave> should not exist` refleja el nombre de la clave que
  mandó el cliente. Es JSON y sonner lo muestra como texto, así que no hay XSS. Recomendación: reemplazar esos
  mensajes por un texto genérico.
- **B-2:** el array `roles` de los tipos de actividad no tiene `@ArrayMaxSize` (`activity-type-commands.ts:63-68` y
  `133-138`). Recomendación: `@ArrayMaxSize(20)`.
- **B-3:** `@IsOptional()` admite `null` en campos que Prisma no acepta como nulos: `UpdateOrganizationCommand.name`,
  `UpdatePatientCommand.firstName` y `lastName`, y `UpdateProProfileDto`. Termina en un 500 genérico. Recomendación:
  `@ValidateIf((_o, v) => v !== undefined)` o normalizar el valor en el handler.

### Informativos
- **I-1:** `__proto__` y `constructor` se descartan en lugar de rechazarse. Es seguro.
- **I-2:** `organizationId`, `professionalId`, `payerId` y `presetId` siguen aceptándose en el body de
  `POST activity`. Es intencional: el guard y `ActivityService` los verifican.
- **I-3:** `settings` en `PUT org` acepta un array y guarda `{}`. Recomendación: agregar `@IsObject()`.
- **I-4:** `npm audit` reporta 15 vulnerabilidades transitivas de Nest 10 y Express 4, que ya existían (va al 022,
  upgrade de Nest).

Veredicto de la primera revisión (historial): APROBADO.

## Re-revisión (vueltas 1 y 2)

Solo lectura. `npx tsc --noEmit` del backend sin errores; `npm test` del backend con 42 suites y 773 tests en verde.

### Confirmaciones
- **B-1: cerrado.** `pipes-config.ts:19-31`: `flattenErrors` reemplaza el constraint `whitelistValidation` por
  `NON_WHITELISTED_MESSAGE` en cada nivel, también en `children` (anidados). `error.property` solo se usa como prefijo de
  los demás constraints, que son nombres de campos declarados por el DTO, no claves del cliente (las claves no declaradas
  solo producen `whitelistValidation`). Se deduplica con `Set`. `validationError: { target: false, value: false }` se
  mantiene. El pipe de query no tiene `forbidNonWhitelisted`, así que no genera ese error.
- **B-2: cerrado.** `@ArrayMaxSize(MAX_ACTIVITY_TYPE_ROLES_INPUT = 20)` en `roles` de create (línea 88) y update (159).
- **B-3: cerrado en lo señalado.** `IsOptionalNotNull` (`dto-validators.ts:20`, `ValidateIf(v !== undefined)`) en
  `UpdateOrganizationCommand.name`, `UpdatePatientCommand.firstName` y `lastName`, `UpdateProProfileDto.displayName` y
  `UpdateActivityTypeCommand.name`. Revisé los demás `@IsOptional` de create y update: apuntan a columnas nulables
  (`cuit`, `phone`, `email`, `percentage` Float?, `cardValue`, `linkedType`) o el handler filtra (`UpdateActivityCommand`).
- **I-3: cerrado.** `@IsObject()` en `settings` (`update-organization-command.ts:110`).
- **Tope de `page`: correcto.** `@Max(MAX_PAGE_NUMBER = 10_000)` en actividades, pacientes y pagadores.
- **`normalizeActivityTypeRoles`: correcto.** Construye un objeto nuevo con solo `roleLabel`, `isRequired`,
  `feeStrategy` y `fixedPercentage`. No se puede guardar otra clave en el JSON, y el body ya rechaza claves de más
  (`forbidNonWhitelisted` sobre el DTO anidado). El cambio de la vuelta 2 (`isRequired ?? true`, `feeStrategy` sin
  clave si falta) no abre nada: replica la lectura de `ActivityService` y no relaja ninguna validación.

### Hallazgos nuevos
- **MENOR (M-1):** `UpdateStaffCommand.canLoadActivities` (`staff-commands.ts:156-158`, handler en `184-185`) admite
  `null` por `@IsOptional()` y lo pasa a Prisma (columna `Boolean` no nula, `schema.prisma:121`). Resultado: 500
  genérico, sin fuga de información (contrato del 013) y solo para ADMIN. Remediación: cambiar `@IsOptional()` por
  `@IsOptionalNotNull()` en ese campo. Mismo patrón que B-3; no bloquea.
- **MENOR (M-2, no verificado):** un elemento `null` dentro de `roles` (`[null]`) depende de que `@ValidateNested` lo
  rechace; no lo probé. Si pasara, `normalizeActivityTypeRoles` lanzaría un error y daría 500 genérico, sin impacto de
  seguridad. Conviene cubrirlo con un caso en el test (o).

### Nada nuevo abierto
Las vueltas no tocaron guards, aislamiento por organización ni secretos. No hay dependencias nuevas. Los hallazgos
informativos I-1, I-2 e I-4 siguen igual.

VEREDICTO: APROBADO
