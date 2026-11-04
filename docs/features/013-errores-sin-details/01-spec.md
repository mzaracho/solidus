# 013 — Errores sin `details`, códigos HTTP correctos y mensajes claros en el frontend

## Contexto
Junta varios ítems del BACKLOG y residuales de seguridad sobre cómo se responden y se muestran los errores:
- **#13 (y B-2 del 005, B-2 del 006):**
  - `HttpFilter` y `GlobalFilter` (`backend/src/infrastructure.bootstrap/filters/`) responden
    `details: JSON.stringify(exception)`. También lo hace `axios-filter.ts`.
  - En un 500 con Prisma, eso expone `code`, `meta` y `clientVersion`, y puede incluir valores del `where`.
  - En 401, 403 y 404 viaja la excepción serializada.
  - Los filtros loguean `exception.message`, y en Prisma ese mensaje puede incluir datos de la consulta.
- **Errores de negocio con `throw new Error(...)` que responden 500** en lugar de 4xx:
  - `staff-commands.ts:83`, CUIT duplicado: debería ser 409;
  - `activity.service.ts:175`, regla de primera carga (#53): debería ser 403 o 400;
  - `activity.service.ts:257`, falta `professionalId`: debería ser 400;
  - `fee-resolution.service.ts:57`, organización no encontrada: 404 o un error interno controlado, según el caso;
  - `dispatcher.ts:32`, "Handler not found": es un error interno y debe ir al log, no al cliente.
- **B-1 del 006:** si la base falla en el guard de autenticación, la respuesta es un 500 que hoy sale con detalle.
  Debe ser un 500 genérico, o un 503 si se justifica, sin detalle y sin el mensaje de Prisma.
- **I-4 del 010:** los errores del body parser con un status distinto de 400, 413 y 415, o sin `type`, caen al handler
  por defecto de Express, que fuera de producción muestra el stack. Hace falta un manejador final genérico.
- **#42:** en el frontend, varios toasts muestran `Failed to ...: {json}` en inglés y con el cuerpo crudo
  (`services/data.ts`, por ejemplo en las líneas 539, 561, 620, 722 y 761, entre otras).

## Historia de usuario
Como responsable de la plataforma, quiero que la API no filtre detalles internos en sus errores y que use el código
HTTP que corresponde. Como usuario, quiero ver mensajes de error claros y en español.

## Criterios de aceptación
1. **Contrato de error único,** en todas las respuestas de error de la API:
   - `{ code, errors: [{ message }] }`, sin `details` ni stack, sin la excepción serializada, sin mensajes de Prisma
     ni nombres internos;
   - `code` sigue la regla actual: un identificador simple como `unauthorized`, `forbidden`, `not-found`,
     `org-access-denied`, `invalid-mode`, `payload-too-large` o `too-many-requests`;
   - el mensaje es el de la excepción HTTP si es un mensaje de negocio pensado para el usuario. Si no, es un genérico
     según el status, en español;
   - si se mantiene `details` en algún caso, solo puede ser fuera de producción, sin datos de la base, y con
     justificación. Lo preferido es sacarlo siempre.
   - Los códigos y mensajes que ya usa el frontend (por ejemplo `org-access-denied`, `unauthorized` y el 404 genérico
     del 007) no cambian.
2. **Errores de validación (400 de `ValidationPipe`):** devuelven mensajes útiles (los de class-validator) sin
   exponer más que eso. El formato de la lista de errores lo define el desarrollador dentro del mismo contrato.
3. **Errores no controlados (500):** el cliente recibe solo `{ code: 'internal-error' (o el actual
   'unhandled-exception'), errors: [{ message: genérico }] }`. El log registra el tipo, la ruta y un identificador de
   correlación, y el mensaje solo si no proviene de Prisma (o redactado). No registra valores de consultas. Opcional:
   devolver ese identificador al cliente para soporte.
4. **Errores de negocio con el status correcto:** los `throw new Error` de negocio que lista el contexto se
   reemplazan por excepciones de Nest con el código que corresponde (409, 403, 400, 404). El desarrollador busca los
   que falten y los lista. Quedan como `Error` los de arranque y configuración (jwt-config, cors-config, runtime-env,
   logger), porque no son respuestas HTTP.
5. **Falla de base en el guard (B-1 del 006):** responde el genérico del criterio 3. No es un 401 (sería confuso),
   salvo que se justifique, y nunca lleva detalle.
6. **Manejador final de Express (I-4 del 010):** cualquier error que no capturen los filtros de Nest (del parser con
   otro status, de middlewares) responde con el contrato genérico y nunca con la página HTML ni el stack.
7. **`axios-filter.ts`:** se elimina si es código muerto (ningún cliente HTTP saliente lo usa), o se alinea al
   contrato.
8. **Frontend (#42):**
   - las funciones de `services/data.ts` dejan de armar `Failed to ...: {json}`;
   - toman el `errors[0].message` del backend si existe y, si no, un mensaje genérico en español según el status o la
     operación;
   - los toasts muestran ese texto;
   - el 401 y el 403 siguen como en el 005 (redirección y aviso de acceso).
   - Los textos genéricos van en constantes (`src/lib/constants.ts` o un módulo de mensajes), no como literales
     sueltos.
9. **Tests:**
   - **Jest:** el contrato en 400 de validación, 401, 403, 404, 409, 413, 429 si existe (012), 500 de Prisma simulado
     (sin `meta`, `clientVersion` ni valores) y 500 genérico; los nuevos códigos de negocio; la falla de base en el
     guard; el manejador final de Express; que el log de un error de Prisma no contenga valores del `where`; que no
     quede `details` en ninguna respuesta. Si hace falta, un invariante estático que prohíba `throw new Error(` en
     `application/` e `infrastructure/features/`, con una lista blanca justificada.
   - **Frontend (`node --test`):** la extracción del mensaje.
   - Se actualizan los tests existentes que esperaban `details` o un 500 en esos casos.
10. **Calidad:**
    - `npx tsc --noEmit` sin errores en backend y frontend;
    - ESLint sin errores nuevos en los archivos tocados;
    - `npm test` del backend y del frontend en verde;
    - `npm run build` del frontend OK.
11. **Verificación en vivo (tester), sin escribir datos:**
    - con tokens firmados en memoria: 401, 403, 404 y un 400 de validación (body inválido en una ruta que valide antes
      de escribir), sin `details`;
    - un 500 provocado sin escribir, si es posible (por ejemplo, un id con formato que llegue a Prisma y falle), sin
      detalle;
    - `-Smoke` OK y conteos sin cambios.

## Fuera de alcance
- `ValidationPipe` con `whitelist` y `forbidNonWhitelisted` (014).
- Rediseño de las pantallas de error del frontend.
- Internacionalización.

## Riesgos
- **El frontend depende de `details` en algún lugar:** el desarrollador lo busca con grep. Si lo encuentra, se ajusta.
- **Mensajes de negocio que hoy salen en `exception.message` en inglés:** se revisan los que ve el usuario.
- **Muchos tests esperan la forma actual:** se actualizan sin debilitarlos.

## Pasos del flujo
- Requiere UX/UI: **no**. Los mensajes son los existentes o genéricos en español, sin pantallas nuevas.
- Requiere seguridad: **sí**.
- Arquitecto: **sí, acotado**. Hay que relevar todos los puntos de error y definir el contrato, el código de 500, la
  correlación y el manejador final.
- Documentador: **sí**.
- Cambios de schema: no.
- Commit y push: autorizados por el usuario al aprobarse (sin force).

## Salvaguardas vigentes
- Sin seeds ni SQL de escritura; sin `down -v`, `prune` ni borrar volúmenes; sin stash, reset ni checkout.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
- No imprimir valores del `.env`.
