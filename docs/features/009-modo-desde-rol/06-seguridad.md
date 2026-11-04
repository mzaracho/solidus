# 06 — Revisión de seguridad: 009-modo-desde-rol

> Autor: agente de seguridad. El agente devolvió el informe en su respuesta sin escribir el archivo, así que el PO lo
> transcribe sin cambios de fondo. Solo lectura: no se modificó código, no se levantó el stack ni se tocó la base.

## Alcance y método
- **Lectura:** `CLAUDE.md`, 00-estado (decisiones 1 a 11), 01, 03, 04 y 05, y el contexto del 007 (INFO-1, INFO-3).
- **Código:** `git diff`, los archivos nuevos y los controladores.
- **Resultados:**
  - `npx tsc --noEmit` del backend sin errores;
  - Jest: 30 suites y 517 tests en verde;
  - `npm test` del frontend: 35/35.
- **`npm audit --omit=dev` del backend:** 15 hallazgos (1 crítico, 8 altos, 6 moderados), los mismos que en el 007. El
  único `package.json` que cambió es el del frontend, que suma un test al script.

## Resumen por punto
1. **Lectura del modo: OK.**
   - Solo `ViewModeGuard` lee el header y la query (`view-mode-guard.ts:54-57`).
   - Ningún controlador ni servicio usa `@Headers('x-mode')` ni `@Query('mode')`, y ningún comando, query o DTO
     declara `mode`. Lo vigila `security-invariants.spec.ts`.
   - Un `mode` en el body o en la query no llega a ningún lado.
   - Sin `@UsesViewMode`, `requireViewScope` responde 403 en los 6 handlers que dependen del modo. El test (l) fija el
     conjunto de rutas.
   - Header y query repetidos o en conflicto, y valores desconocidos, dan 400 `invalid-mode`.
2. **Matriz: OK.**
   - org exige `OrganizationMember` en `primaryOrgId`;
   - pro exige un `Professional` `ACTIVE`, sin `deletedAt` y con `user.deletedAt` nulo, leído de la base;
   - `SOLO_PRACTICE` solo vale con rol `ADMIN`;
   - 403 sin degradar.
3. **Vista pro multi-organización: OK.** Los `professionalIds` salen de la base y los filtros del cliente solo
   restringen (se combinan con AND). No se reabre el aislamiento del 007.
4. **Financieros: OK.**
   - Dashboard con `@UsesViewMode({orgRole:'ADMIN'})`.
   - `settlements/calculate` con `@RequireOrgRole('ADMIN')` y `@CurrentOrgId()`.
   - `ReportingController` y `ProductionController` siguen sin registrar.
5. **Lecturas por id sin membresía: OK, con MEDIA-1.**
   - `activity/:id` exige que la atención sea propia o con participación, y si no responde 404 genérico.
   - `patients/:id/summary` y `/debt` pasan por `assertPatientReadable`.
6. **Frontend: OK.** Solo presentación; el backend decide.
7. **Secretos y datos reales:** sin hallazgos. `.claude/settings.json` cambia solo de fin de línea.

## Hallazgos dentro del alcance
Críticos: ninguno. Altos: ninguno.

### Media
- **MEDIA-1: el resumen y la deuda del paciente de un profesional sin membresía incluyen datos de otros profesionales.**
  - Archivo: `get-patient-summary-query.ts` (aprox. 49-66). Afecta también a `patients.service.ts` `calcDebt`
    (línea 170 y siguientes), y por eso a `/debt` y al `debt` del listado.
  - Impacto: después de `assertPatientReadable`, el profesional recibe todas las atenciones impagas del paciente en la
    organización. Eso incluye `grossAmount`, pagador, tipo de servicio y `professionalName` de otros profesionales, y
    una deuda total que mezcla honorarios ajenos.
  - Recomendación: para un usuario sin membresía en la organización del paciente, filtrar `items` y `calcDebt` por
    `professionalId in ids` o por participante.

### Baja
- **BAJA-1:** el `MEMBER` ve en org la comisión y los montos por atención. Es la decisión 1, aceptada; no es
  regresión.
- **BAJA-2:** el modo se valida contra la organización del header, y `POST /activity` puede apuntar a otra en el body.
  Falla cerrado y no da más permisos. Recomendación: documentarlo y no mandar `organizationId` en el body desde el front.
- **BAJA-3:** `soloOrgs` del listado de pacientes en pro (`patients.service.ts`, aprox. 58-65) no exige `role: 'ADMIN'`.
  No hay IDOR. Recomendación: filtrar por `ADMIN`, alineado con el guard.

### Informativa
- **INFO-1:** sin `whitelist` en `ValidationPipe`. Si se activara `forbidNonWhitelisted`, el `?mode=` del front daría 400
  (relevante para el 014).
- **INFO-2:** `new Error(...)` en la regla de primera carga de `activity.service.ts` responde 500. Es preexistente.
- **INFO-3 e INFO-4:** son las decisiones 8 y 9 del PO, que van al BACKLOG.
- **INFO-5:** el crítico de `qs` en `npm audit` sigue como en el 007.

## Fuera de alcance
- `ReportingController` y `ProductionController` aceptan `userId` de la query (feature 011).
- `org/config` está abierto a cualquier vínculo (decisión 11).
- Los hallazgos de `npm audit`, que ya existían.

## Historial
- Veredicto inicial: aprobado. Ver la nota del PO al final.

Veredicto de la primera revisión (historial): APROBADO.

> Nota del PO: aunque el veredicto es APROBADO, el PO decide corregir MEDIA-1 y BAJA-3 dentro del 009 (vuelta 1),
> porque MEDIA-1 contradice el espíritu de las decisiones 5 y 7 (datos de salud). Seguridad vuelve a revisar después
> de la corrección.


---

## Re-revisión (vuelta 1)

> Autor: agente de seguridad. Solo lectura: no se modificó código, no se levantó el stack ni se tocó la base.

### Método
- Lectura de CLAUDE.md, 00-estado (decisiones 5 y 7), la sección "Vuelta de corrección 1" del 04 y el código de la vuelta.
- `npx tsc --noEmit` del backend sin errores; Jest 30 suites y 525 tests en verde; `npm test` del frontend 35/35.
- No se repitió `npm audit`: no cambió ningún `package.json` en la vuelta.

### MEDIA-1: RESUELTA
Recorrido por ruta (usuario con vínculo solo de Professional, sin membresía en la organización del recurso):
- **`GET patients/:id/summary`** (`get-patient-summary-query.ts`): `assertPatientReadable` devuelve los ids de los Professional
  del usuario y los `items` y `totalDebt` se filtran con `ownProfessionalsFilter` (propias o como participante). Pagador,
  servicio, `professionalName` y montos ajenos ya no salen.
- **`GET patients/:id/debt`** (`get-debt-query.ts` y `PatientsService.getDebt/calcDebt`): pasa los mismos ids; la deuda solo suma
  atenciones propias o con participación.
- **Listado de pacientes en pro** (`PatientsService.findAll`): `debt` y `lastVisit` se acotan a los Professional del usuario
  en todo paciente de una organización donde no es miembro. Falla cerrado: sin `userId` no hay membresías y todo se acota.
  El `userId` sale de `@CurrentUserId()` (controlador), no del cliente.
- **`activity/:id`**: sin membresía exige atención propia o con participación; si no, 404 genérico. Correcto.
- **`activity` listado**: en pro filtra por `professionalIds` de la vista (propias o participante); en org exige membresía
  (guard). Los filtros del cliente se combinan con AND y solo restringen.
- **Dashboard** (`@UsesViewMode({orgRole:'ADMIN'})`) y **settlements** (`@RequireOrgRole('ADMIN')` + `@CurrentOrgId()`): sin acceso
  para quien no es ADMIN. En pro el dashboard usa los ids de la vista.
- **Origen de los ids:** salen de la base (`prisma.professional` con `userId`, `ACTIVE`, `deletedAt null`, y la vista del
  `ViewModeGuard`), nunca del cliente.
- **`canLoadActivities`:** ya no amplía la visibilidad de montos. Da acceso al paciente, pero `assertPatientReadable` devuelve
  igualmente los ids propios y resumen y deuda se acotan. Cubierto por tests (`patients-handlers.spec.ts`,
  `patients.service.spec.ts`, `test/org-isolation.spec.ts` con el monto 7777 ajeno).

### BAJA-3: RESUELTA
`soloOrgIds` sale de las membresías con `role === 'ADMIN'` y `organization.type === 'SOLO_PRACTICE'`, en una sola consulta,
alineado con el `ViewModeGuard`. Hay tests (MEMBER fuera, ADMIN dentro).

### Que la vuelta no abra nada nuevo
Sin hallazgos nuevos. `payers` del dashboard pasa a tipar `@Query()` con la clase de la query (ahora validada por el
`ValidationPipe`), formato en specs y `useMemo` en `Sidebar.tsx`. Sin cambios de schema, dependencias ni secretos. La
organización sigue tomándose solo de `RequestContext`/`@CurrentOrgId()`.

### Observaciones (informativas, no bloquean)
- **INFO-6:** quien solo tiene Professional con `canLoadActivities` sigue viendo la lista de pacientes de toda la organización
  (datos del paciente, no montos). Es la decisión 5/7 del PO.
- **INFO-7:** en el listado la deuda se acota a los ids de TODOS los Professional del usuario (cualquier organización). No
  filtra datos ajenos, porque cada id es del usuario.
- **INFO-8:** `patients.service.ts` importa `ownProfessionalsFilter` desde `application/`: tema de capas, no de seguridad.
- Siguen vigentes INFO-1, INFO-2, INFO-5 y lo "Fuera de alcance" de la primera revisión.

### Resultado
Críticos: ninguno. Altos: ninguno. Bloqueantes: ninguno.

VEREDICTO: APROBADO
