# 06 — Revisión de seguridad: 013-errores-sin-details

> Autor: agente de seguridad. El agente devolvió el informe en su respuesta sin escribir el archivo, así que el PO lo
> transcribe sin cambios de fondo. Solo lectura: se revisaron el diff completo (staged y no staged) y los archivos
> nuevos.
> `npx tsc --noEmit` del backend da sin errores y Jest pasa con 39 suites y 682 tests. El `npm test` del frontend no
> se corrió; se revisó leyendo el código.

## Hallazgos

Críticos: ninguno. Altos: ninguno. Medios: ninguno.

### Baja
- **B-1: un valor del cliente se refleja en un 400.**
  - Ubicación: `application/features/config/commands/activity-type-commands.ts:89`, que arma
    `El rol "${role.roleLabel}" usa porcentaje fijo...`.
  - Impacto: devuelve un `roleLabel` enviado por el cliente.
  - Por qué es bajo: la respuesta es JSON, el endpoint es solo para `ADMIN` de `org/*` y el mensaje se recorta a 300
    caracteres. Sonner muestra texto, no HTML, y no hay `dangerouslySetInnerHTML`.
  - Recomendación: quitar la etiqueta del mensaje o limitarla.
- **B-2: el 400 por CUIT de organización confirma datos de otras organizaciones** (preexistente).
  - Ubicación: `payer-commands.ts:162-167`, donde `organization.findFirst({ where: { cuit } })` no filtra por
    organización.
  - Impacto: el mensaje "Ese CUIT pertenece a una organización registrada" revela si un CUIT existe como organización
    en otro tenant.
  - Recomendación: aceptarlo y pasarlo al BACKLOG, o unificarlo con un mensaje genérico.
- **B-3: en producción se registra `error.message` de errores que no son de Prisma.**
  - Ubicación: `error-contract.ts:236-245`, en `describeForLog`.
  - Impacto: un `Error` de una librería que traiga datos en el mensaje (hasta 200 caracteres, con los caracteres de
    control neutralizados) llega al log, aunque no al cliente.
  - Recomendación (opcional): en producción registrar solo `name`, o documentarlo.

### Informativas
- **I-1:** en 401, 403 y 404, `curated ?? code` deja pasar códigos explícitos del 007 (`org-access-denied`,
  `forbidden`, `not-found`). Los mensajes siempre son genéricos, y el 404 del recurso sigue siendo idéntico
  (verificado en `org-isolation.spec.ts`).
- **I-2:** el stack de los errores que no son de Prisma sale solo por `logDebug`, que está apagado en producción y con
  un `NODE_ENV` desconocido.
- **I-3:** `X-Error-Id` es un `randomUUID()`, sin datos. CORS no lo expone, así que solo lo ve quien mire la red.
- **I-4:** sin `whitelist` en el `ValidationPipe`; lo trata el 014.

## Respuesta a los 8 puntos
1. **Sin filtraciones en las respuestas de error.**
   - `mapException` es el único mapeo: cubre filtros, guards, pipes y el 429. El body parser usa `GENERIC_ERRORS`.
   - `ErrorResponse` ya no tiene `details`.
   - Los 5xx son genéricos, y los 401, 403 y 404 también.
   - class-validator devuelve el nombre de la propiedad y la restricción, sin el valor (no hay `$value`), con un tope de
     20 mensajes de 200 caracteres.
   - Los 4xx de negocio solo llevan mensaje si traen un `code` explícito. La única interpolación de un valor del cliente
     es B-1.
2. **404 idéntico, y 401 y 403 genéricos:** sí, salvo I-1.
3. **Logs.**
   - De Prisma solo se registran la clase y el código; el body no se registra.
   - El catch de `update-organization-command.ts` se eliminó sin dejar rastros, igual que el log duplicado del
     dispatcher.
4. **Manejador final:** se registra después de `app.init()` y antes de `listen`. Responde con el contrato JSON, maneja
   `headersSent` y nunca devuelve HTML ni stack.
5. **Falla de base en el guard:** responde un 500 genérico con `X-Error-Id`, cubierto en `error-filters.spec.ts`.
6. **Excepciones de negocio nuevas.**
   - El 409 por CUIT duplicado de un profesional está acotado a la organización.
   - Los 400 `first-load-required` y por falta de profesional no usan datos ajenos.
   - El 409 al borrar una prestación se evalúa después de verificar la pertenencia.
   - El único caso que cruza organizaciones es B-2, preexistente.
7. **Frontend:** `api-errors.ts` usa solo `errors[0].message` en los 4xx (recortado a 300 caracteres) y nunca muestra
   JSON ni `res.text()`. Sonner muestra texto.
8. **Invariantes y limpieza:**
   - lista blanca para `new Error(`;
   - las excepciones no reciben un string suelto;
   - no hay `JSON.stringify(exception`;
   - no queda `axios-filter`.

   No hay secretos ni datos reales.

VEREDICTO: APROBADO
