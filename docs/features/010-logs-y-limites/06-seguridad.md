# 06 — Revisión de seguridad: 010-logs-y-limites

> Autor: agente de seguridad. El agente devolvió el informe en su respuesta sin escribir el archivo; el PO lo
> transcribe sin cambios de fondo. Solo lectura: no se modificó código, no se ejecutó `dev.ps1` ni se levantó el stack.

## Verificaciones
- `npx tsc --noEmit` del backend: sin errores.
- Jest: 32 suites y 563 tests en verde.
- `dev-lib.tests.ps1`: 1026 OK, 0 fallidos.
- `grep` sobre el repo y `git diff`.

## Resumen
El cambio toca logging, el parseo del body y el arranque. No agrega endpoints, autenticación, SQL, subida de archivos ni
criptografía. No hay hallazgos críticos, altos ni medios: hay 2 bajos y 3 informativos.

## Revisión por punto
1. **Línea de acceso (`access-log.ts`): OK, salvo B-1.**
   - Contenido: solo `METHOD ruta STATUS Nms`. La ruta va sin query ni fragmento y recortada a 200 caracteres.
   - Lo que no incluye: headers, body, cookies, tokens, emails ni ids de usuario u organización. Ninguna ruta lleva
     `:token`, `:key`, `:secret` ni `:code`.
   - Orden: el middleware va antes del parser, de CORS y de los guards, así que registra también los 401 y 403, el
     404, el 400 y el 413 del parser, y los 500.
   - Duplicados: no hay; el interceptor ya no escribe la línea de acceso.
2. **Límite del body: OK, salvo B-2.**
   - Default de 1mb y máximo de 10mb; un valor inválido impide arrancar.
   - `urlencoded` con `extended: true` es el default de Nest y conserva los topes de `qs`. El front no lo usa.
   - El 413 y el 400 responden con el `ErrorResponse` genérico, sin stack ni detalles.
3. **TLS: OK.**
   - `assertTlsVerificationEnabled` es lo primero que corre en `bootstrap()` y rechaza `0` con espacios o comillas.
   - Ve el entorno del proceso y lo que trae `backend/.env`, porque `ConfigModule` lo carga antes.
   - El mensaje no muestra el valor.
   - Ni el compose ni los Dockerfiles definen la variable, y nada más en el repo desactiva TLS.
   - `Sync-BackendEnv` quita la clave y avisa una sola vez, sin mostrar el valor.
4. **`.env.example` y datos de prueba: OK.** Sin secretos; solo datos ficticios.
5. **Regresiones sobre 005 a 009:** ninguna.

## Hallazgos

### Críticos, altos y medios
Ninguno.

### Baja
- **B-1: la ruta y el método se escriben sin neutralizar caracteres de control.**
  - Ubicación: `access-log.ts:12-25` y `:37-38`.
  - Hoy no se puede explotar, porque el parser HTTP de Node rechaza los saltos de línea. Pero los bytes 0x80-0xFF
    crudos pueden llegar al log.
  - Recomendación: reemplazar `[^\x21-\x7E]` en la ruta y en el método, con un test.
- **B-2: los errores 415 del body parser caen en el handler por defecto de Express.**
  - Ubicación: `body-parser-config.ts:63-72`.
  - `encoding.unsupported` y `charset.unsupported` no se mapean, y fuera de producción la respuesta es HTML con el
    stack.
  - Recomendación: mapear el 415 a una respuesta genérica (o cualquier 4xx del parser), con un test.

### Informativas
- **I-1:** si `backend/.env` todavía tiene la clave en `0` (como en el equipo del usuario), el backend no arranca
  hasta correr `.\dev.ps1 -Init`. Es el comportamiento buscado.
- **I-2:** los UUID de recursos quedan en el path del log, igual que antes. Hay que tenerlo presente para la
  retención de logs.
- **I-3:** `COMANDOS.md` (línea ~335) dice "default 50mb" y lo corrige el documentador. El filtro de errores sigue
  logueando `exception.message` (feature 013).

## Historial
- Veredicto inicial (historial): APROBADO. El PO decidió corregir B-1 y B-2 en la vuelta 1 por ser chicos y de este alcance.

## Re-revisión (vuelta 1)

Solo lectura. `npx tsc --noEmit`: sin errores. `npm test` del backend: 32 suites, 567 tests en verde.

- **B-1 (log injection): CERRADO.**
  - `access-log.ts:24-26`: `neutralizeUnsafeChars` aplica `/[^!-~]/g` y reemplaza por `?`. Sin el flag `u` opera por unidad UTF-16, así que todo lo no ASCII imprimible queda neutralizado: controles, espacio, CR/LF, 0x7F, 0x80-0xFF, U+2028/2029.
  - Ruta: se corta query y fragmento, se acota a 200 y luego se neutraliza (`:14-16`). Método: neutralizado y acotado a 16 (`:48`). El status y la duración son numéricos.
  - No queda otro dato del request en la línea. No hay vía de inyección.
- **B-2 (415 del parser): CERRADO.**
  - `body-parser-config.ts:45-81`: 400, 413 y 415 con tipo `entity.`, `encoding.`, `request.` o `charset.` responden `ErrorResponse` genérico, sin stack ni detalles. Los tests HTTP cubren `Content-Encoding: foo` y `charset=utf-32`.
- **Hallazgos nuevos:** ninguno crítico, alto ni medio.
- **I-4 (informativo):** un error del parser con otro status (p. ej. 500 interno de `body-parser`) o sin `type` se delega al handler por defecto de Express. Fuera de producción puede mostrar el stack. Es el caso previsto y no es alcanzable con entrada de un cliente normal. Si se quiere, la feature 013 puede agregar un manejador final genérico.

Sin regresiones. I-1 a I-3 siguen vigentes.

VEREDICTO: APROBADO
