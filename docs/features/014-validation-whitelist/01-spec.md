# 014 — `ValidationPipe` con whitelist y DTOs explícitos

## Contexto
- **BACKLOG #12:** el `ValidationPipe` global (`backend/src/infrastructure.bootstrap/config/app/pipes-config.ts`) usa
  `transform: true` y `enableImplicitConversion: true`, sin `whitelist` ni `forbidNonWhitelisted`. Por eso:
  - las propiedades que no declara el DTO llegan igual al objeto de comando o query;
  - la conversión implícita transforma `123` en `"123"` y `{}` en `"[object Object]"` en los campos `string`. El 005 lo
    tuvo que esquivar en el login con un `@Transform`.
- **Cómo se compensó hasta ahora:** en el 007, el 009 y el 011 los handlers arman los datos campo por campo, con listas
  blancas como la de `fee-rules`. Además, `security-invariants.spec.ts` vigila los campos `*Id`. Pero la protección de
  fondo, que el pipe descarte lo no declarado, no existe.
- **BACKLOG #43:** los comandos de update (por ejemplo `UpdateActivityCommand`, `UpdatePatientCommand`,
  `UpdateStaffCommand`, presets, categorías, tipos de actividad y pagadores) no validan enums, fechas ni tipos con
  class-validator.
- **Fee rules y settings de la organización:** el BACKLOG #12 pide DTOs explícitos para los dos. Hoy `UpdateOrgSettings`
  y similares reciben `Record<string, unknown>` o bodies poco tipados.
- **INFO-1 de seguridad del 009:** si se activa `forbidNonWhitelisted`, el `?mode=` que manda el frontend daría 400,
  porque ningún DTO declara `mode`. Lo lee el `ViewModeGuard`, que lee la query cruda.
- **El 013** (en curso) define el formato del 400 de validación: `validation-failed` con la lista de mensajes.

## Historia de usuario
Como responsable de la plataforma, quiero que la API acepte solo los campos que cada endpoint declara y con tipos
validados, para que no se puedan colar datos ni relaciones no previstas.

## Criterios de aceptación
1. **`ValidationPipe` global con `whitelist: true`:** se descartan las propiedades que no declara el DTO o la clase de
   comando o query.
   - Sobre `forbidNonWhitelisted: true`, que responde 400 ante campos sobrantes, decide el arquitecto después de relevar
     qué manda el frontend. La regla: si el frontend manda campos sobrantes legítimos, se limpian en el frontend o se
     declaran. Lo preferido es `forbidNonWhitelisted` en los bodies.
   - Los parámetros de query que leen los guards (`mode`, `orgId`, `organizationId`) no pueden romperse. El arquitecto
     define cómo convive el `ViewModeGuard` y el `OrgAccessGuard`, que leen la query cruda, con la whitelist.
2. **Sin conversión implícita peligrosa:**
   - se desactiva `enableImplicitConversion`, o se mantiene solo donde haga falta (por ejemplo números y booleanos de
     la query), con `@Type()` explícito;
   - un `string` que llega como número u objeto da 400;
   - el `@Transform` especial del login del 005 queda o se simplifica, según el diseño.
3. **Todo endpoint tiene DTO validado:**
   - cada `@Body()` y cada `@Query()` de los controladores registrados usa una clase con decoradores de
     class-validator;
   - no queda `Record<string, unknown>`, `any` ni tipos inline;
   - en particular, fee rules (crear y editar, con el validador de `splits` del 007 integrado o conservado), settings
     de la organización y los updates de #43;
   - los enums usan `@IsEnum` con las constantes de dominio, las fechas `@IsDateString` o equivalente, los ids
     `@IsUUID`, y los montos tienen tope y validación numérica compatibles con `Decimal(10,2)`.
4. **Invariante estático:** un test falla si un controlador registrado usa `@Body()` o `@Query()` con un tipo que no es
   una clase con al menos un decorador de class-validator. Si hay excepciones, van en una lista blanca justificada.
5. **Los campos que asigna el controlador** (`userId` y `organizationId` vía `@CurrentUserId()` / `@CurrentOrgId()`) no
   se pueden inyectar desde el cliente: se descartan por la whitelist o los pisa el controlador. Hay que verificarlo con
   tests, y `security-invariants` sigue en verde.
6. **El frontend no se rompe:** los bodies y queries que manda hoy son compatibles. Si manda campos sobrantes, se
   limpian en `services/data.ts`. Un 400 de validación muestra el mensaje genérico del 013.
7. **Tests:**
   - **Jest:** por cada endpoint con body, un caso con un campo sobrante (se descarta, o da 400 si
     `forbidNonWhitelisted`), un caso con tipo incorrecto (400) y el caso legítimo; el invariante del criterio 4; que
     `?mode=` y `?orgId=` sigan funcionando con los guards;
   - un test de contrato con los bodies exactos que manda el frontend, como hizo el 007;
   - los tests existentes, en verde.
8. **Calidad:**
   - `npx tsc --noEmit` sin errores en backend y frontend;
   - ESLint sin errores nuevos en los archivos tocados;
   - `npm test` del backend y del frontend en verde;
   - `npm run build` del frontend OK.
9. **Verificación en vivo (tester), sin escribir datos reales:**
   - pedidos con campos sobrantes y con tipos incorrectos a rutas que validan antes de escribir;
   - rutas de lectura con `?mode=` y `?orgId=`;
   - `-Smoke` OK;
   - conteos sin cambios.

## Fuera de alcance
- Cambiar la semántica de negocio de los endpoints.
- Unificar la forma de `splits` entre la UI y el motor: es el 016.

## Riesgos
- **Romper flujos del frontend** que mandan campos de más. Se mitiga con el relevamiento del arquitecto y el test de
  contrato.
- **La conversión implícita** se usa hoy en queries numéricas (paginación) y booleanas. Hay que mantenerla
  explícitamente con `@Type()`.
- **Superficie grande:** son muchos DTOs. Plan en pasos chicos.

## Pasos del flujo
- Requiere UX/UI: **no**.
- Requiere seguridad: **sí**.
- Arquitecto: **sí**. Hay que relevar todos los `@Body()` y `@Query()`, lo que manda el frontend, la convivencia con los
  guards y decidir sobre `forbidNonWhitelisted`.
- Documentador: **sí**.
- Cambios de schema: no.
- Dependencia: arranca **después del commit del 013**, porque toca los mismos filtros y tests.
- Commit y push: autorizados por el usuario al aprobarse (sin force).

## Salvaguardas vigentes
- Sin seeds ni SQL de escritura; sin `down -v`, `prune` ni borrar volúmenes; sin stash, reset ni checkout.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
- No imprimir valores del `.env`.
