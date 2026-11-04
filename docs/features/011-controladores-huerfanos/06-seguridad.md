# 011 - Revisión de seguridad

Alcance: borrado de `ProductionController`, `ReportingController` y sus queries/handlers; guardia `(a2)` en
`backend/test/org-isolation.spec.ts`; cambios en `backend/src/security-invariants.spec.ts`. Sin cambios de schema ni
de superficie nueva (solo se elimina código).

## Resultado por punto
1. **Identidad desde query/body/headers.** Grep sobre `backend/src` (sin specs) de `@Headers`, `req.headers/query/body`,
   `x-user-id`, `x-org-id`: ninguna ocurrencia en controladores ni handlers. `x-user-id` solo se ESCRIBE en
   `authentication-guard.ts:91` desde `payload.sub` (JWT verificado). `x-org-id` solo lo lee `org-access-guard.ts` para
   validarlo contra la membresía. Los `userId` que llegan por `@Query()` (`fee-rules`, `patients`, `pro/payers`) se
   pisan con `@CurrentUserId()` en el controlador (invariante vigilada por `security-invariants.spec.ts`).
   `profile-controller.ts` y `lookupStaffByCuit` no toman identidad del cliente. OK.
2. **Código muerto equivalente.** Los 10 archivos `@Controller` restantes están todos registrados (el test `(a2)` pasa
   y es consistente con el listado por grep). Recorrí los 28 archivos con `@RequestHandler`: un solo handler sin
   registrar, ver MENOR-1. No queda ninguna referencia a las clases borradas.
3. **Guardia `(a2)`.** Efectiva: usa el `ModulesContainer` del `AppModule` real, compara por identidad de clase con las
   exportaciones de cada archivo de `src/api/controllers/**`, detecta con `PATH_METADATA` propia (la deja
   `@Controller()`), falla si no se detecta ninguno y valida la lista blanca (vacía). Según el desarrollador falló antes
   del borrado listando ambos controladores. El `require` de los controladores no tiene efectos secundarios: grep en
   `src/api` sin `process.env`, `PrismaClient`, conexiones, escrituras ni `listen`; los archivos solo importan
   decoradores, comandos/queries y base-controller; además esos módulos ya estaban cargados por `AppModule` (Jest
   comparte caché de módulos, así que `require` devuelve las mismas clases, requisito para la comparación por
   identidad). Limitación menor: no detecta controladores sin extensión `.ts` o fuera de `src/api/controllers`
   (MENOR-2).
4. **`security-invariants.spec.ts`.** Solo se quitaron las 4 entradas `*.userId` de clases borradas, la lista
   `NOT_REGISTERED_ALLOWLIST`, su test de obsolescencia y el `continue`. Esto último ENDURECE el control: ahora toda
   clase con campo `controller` debe estar asignada por un controlador. El test de igualdad `found` vs `ID_FIELDS` sigue
   presente. Sin pérdida de cobertura.

## Verificación ejecutada
- `npx tsc --noEmit`: sin errores.
- `jest test/org-isolation.spec.ts src/security-invariants.spec.ts`: 2 suites, 157 tests en verde.

## Hallazgos
### BLOQUEANTE / CRÍTICO / ALTO
Ninguno.

### MAYOR
Ninguno.

### MENOR
- **MENOR-1.** `backend/src/application/features/config/commands/update-profile-command.ts` (clase
  `UpdateProfileCommandHandler`, líneas 14-24): handler no registrado en `config-module.ts`, mientras
  `ProfileController` (`PUT /api/profile`, preexistente, registrado) lo despacha. Riesgo: hoy da "Handler not found"
  en runtime; es un mock que devuelve `{ success: true, ...command }` (eco del body). Si alguien lo registra tal cual,
  sería un endpoint sin lógica ni control de pertenencia con mass assignment reflejado. Remediación: eliminar
  `ProfileController`, el comando y el DTO (igual criterio que este feature) o implementarlo con `@CurrentUserId()` y
  agregar su caso a los specs. Fuera del alcance del 011; registrar en BACKLOG. La guardia `(a2)` no lo cubre porque
  el controlador sí está registrado: conviene una guardia análoga para handlers.
- **MENOR-2.** `backend/test/org-isolation.spec.ts` (test `(a2)`): solo recorre `src/api/controllers`. Un `@Controller`
  fuera de esa carpeta pasa inadvertido. Remediación opcional: buscar `@Controller(` en todo `src` y contrastar.
- **INFO.** `.claude/settings.json` figura modificado (no es de este feature); revisar el diff antes de cualquier
  commit según la regla 12 de CLAUDE.md. El `git diff` solo mostró una advertencia de fin de línea.

Veredicto de la revisión inicial (historial): APROBADO

## Re-revisión (vuelta 1)

Verificado con grep, git status y ejecución (sin modificar código):

- **MENOR-1 cerrado.** `profile-controller.ts`, `update-profile-command.ts` y `update-profile.dto.ts` figuran borrados
  (`git status`); grep en `backend` de `UpdateProfile`, `ProfileController`, `profile-controller` no encuentra nada, y
  `config-module.ts` ya no los importa ni registra. `grep -i profile` en `src` solo toca `pro-controller.ts`
  (`PUT /pro/profile`, vigente) y el login. Tampoco quedan referencias a `ProductionController`, `ReportingController`
  ni sus queries.
- **Handlers sin registrar.** Cruzando todas las clases `*Handler` con los módulos, la única no referenciada es
  `LogoutCommandHandler` (`auth/logout-command-handler.ts`). Es preexistente, no lleva `@RequestHandler`, no hace nada
  (`return;`) y no refleja el body: no es un mock que devuelva datos ni expone superficie. Riesgo de seguridad nulo;
  a lo sumo `POST` de logout falla con "Handler not found" (funcional, JWT sin estado). Registrar como MENOR-3 en el
  BACKLOG (decorarlo y registrarlo, o quitar el endpoint). No bloquea. No hay otro handler que devuelva el body
  (`grep "success: true, ..."` en `src`: sin resultados).
- **MENOR-2 cerrado.** La guardia `(a2)` (`test/org-isolation.spec.ts`, ~líneas 740-775) recorre todo `src` de forma
  recursiva, excluye `*.spec.ts`, `*.d.ts` y solo dos archivos con efectos al importarse (`api/main.ts`, que llama
  `bootstrap()`, e `infrastructure.bootstrap/bootstrap.ts`), mantiene el `expect(declared.length) > 0` y la lista
  blanca vacía. Efectos secundarios en los demás `require`: los archivos con llamadas de nivel superior que revisé
  son controladores/decoradores y `access-log.ts` (solo define funciones); `src/api` no usa `process.env`. Esos módulos
  ya los carga `AppModule`, así que no añaden efectos nuevos. Limitación residual aceptable: la exclusión es por ruta
  fija, un nuevo archivo con efectos al importarse debería agregarse a `SIDE_EFFECT_FILES`.

Ejecución: `npx tsc --noEmit` sin errores; `npm test` backend: 32 suites, 567 tests en verde.

Hallazgos vigentes: BLOQUEANTE ninguno, MAYOR ninguno, MENOR-3 (LogoutCommandHandler, preexistente, informativo).
INFO: `.claude/settings.json` sigue modificado y ajeno a este feature; revisar su diff antes de commitear (regla 12).

VEREDICTO: APROBADO
