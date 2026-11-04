# 010 — Log de requests fallidos, límite del body y fin de `NODE_TLS_REJECT_UNAUTHORIZED`

## Contexto
Toma tres ítems chicos del BACKLOG:
- **#37: requests fallidos sin log (B-3 del 005, m-1 del revisor del 005).**
  - `LoggingInterceptor` (`backend/src/infrastructure.bootstrap/interceptors/logging.interceptor.ts`) solo
    registra en `tap.next`, así que un request que termina en excepción no deja la línea de acceso.
  - Además, los 401 y 403 de los guards globales (autenticación, organización y modo) ocurren **antes** de los
    interceptores y tampoco quedan registrados. Lo mismo pasa con los errores del body parser (413, JSON
    inválido).
  - Se pierde la auditoría de intentos de acceso.
- **#38: límite del body de 50 MB (B-4 del 005).**
  - `config/app/body-parser-config.ts` usa `BODY_SIZE_LIMIT ?? '50mb'`, y el parser corre antes de la
    autenticación.
  - Hoy ningún endpoint recibe archivos.
- **#14 (resto): `NODE_TLS_REJECT_UNAUTHORIZED=0` en `backend/.env`.**
  - Es una clave heredada que `dev.ps1` (`Sync-BackendEnv`) conserva como "local", y un test de `dev-lib` exige
    que se conserve (caso 3).
  - Desactiva la verificación TLS de todo el proceso Node. Contradice la regla del proyecto: "nunca se
    desactiva la verificación TLS".

## Historia de usuario
Como responsable de la plataforma, quiero:
- que todo request quede registrado con su resultado, incluidos los rechazados por autenticación o permisos,
  sin datos sensibles;
- que el servidor no acepte bodies desproporcionados;
- que ningún entorno desactive la verificación TLS.

## Criterios de aceptación
1. **Línea de acceso para todo request:**
   - método, ruta sin query, status final y duración en ms;
   - se escribe al terminar la respuesta, también cuando la respuesta es un error: 4xx y 5xx de handlers,
     401 y 403 de los guards, 400 y 413 del body parser, 404 de ruta inexistente;
   - se implementa en un punto que vea todo, por ejemplo un middleware de Express registrado en el bootstrap
     antes que el body parser, con `res.on('finish')`;
   - el `LoggingInterceptor` deja de escribir la línea de acceso, para no duplicarla, y conserva el debug
     redactado;
   - el nivel es `log` para 2xx y 3xx, y `warn` para 4xx y 5xx, o lo que fije el desarrollador con
     justificación.
2. **Sin datos sensibles en la línea de acceso:** no incluye headers, query, body, tokens, ids de usuario,
   emails ni el cuerpo de la respuesta. Opcional: el `userId` verificado truncado, si se justifica para
   auditoría. Lo de los logs del 005 sigue vigente (redacción, debug solo fuera de producción).
3. **Límite del body:**
   - el valor por defecto de `BODY_SIZE_LIMIT` baja a `1mb`;
   - el valor se valida al arrancar (formato de tamaño válido y un máximo razonable, por ejemplo 10 MB);
   - un valor inválido hace que el backend no arranque, con un mensaje claro;
   - lo mismo vale para `urlencoded` si está habilitado;
   - un body mayor al límite responde **413** con el cuerpo de error genérico del proyecto, sin stack ni
     detalles, y queda en el log de acceso.
4. **Sin `NODE_TLS_REJECT_UNAUTHORIZED=0`:**
   - `Sync-BackendEnv` deja de conservar `NODE_TLS_REJECT_UNAUTHORIZED` en `backend/.env`, que es un archivo
     generado: lo quita y avisa una vez, sin mostrar valores;
   - el backend, al arrancar, rechaza `NODE_TLS_REJECT_UNAUTHORIZED=0`: no arranca, con un mensaje que remite
     a `.\dev.ps1 -ExportCa`;
   - el test del caso 3 de `dev-lib` se actualiza: ahora exige que la clave se elimine y que el resto de las
     claves locales se conserven.
5. **Documentación operativa:** `.env.example` y `backend/.env.example` documentan `BODY_SIZE_LIMIT`
   (opcional, default `1mb`). `docs/auditoria/COMANDOS.md` explica el cambio de `NODE_TLS_REJECT_UNAUTHORIZED`
   (lo hace el documentador).
6. **Tests:**
   - **Jest:** línea de acceso en 200, 401 (sin token), 403 (organización ajena), 404, 413 y 500, una sola vez
     por request y sin datos sensibles (con un logger capturado); validación de `BODY_SIZE_LIMIT`; rechazo de
     `NODE_TLS_REJECT_UNAUTHORIZED=0` al arrancar (función pura testeable).
   - **`dev-lib`:** el caso 3 actualizado y el aviso; la suite completa en verde.
7. **Calidad:**
   - `npx tsc --noEmit` del backend sin errores;
   - ESLint sin errores nuevos en los archivos tocados;
   - `npm test` del backend en verde;
   - tests de `dev-lib` en verde.
8. **Verificación en vivo (tester):** en modo desarrollo, después de `.\dev.ps1 -Init`:
   - `backend/.env` ya no tiene `NODE_TLS_REJECT_UNAUTHORIZED` (solo se verifica la ausencia de la clave, sin
     leer valores);
   - `-Smoke` da OK;
   - los logs del backend tienen líneas de acceso para un 200, un 401 sin token, un 403 y un 404;
   - un body de 2 MB responde 413;
   - en ninguna línea aparecen tokens ni contraseñas;
   - los conteos de la base no cambian.

## Fuera de alcance
- Filtros de error sin `details` (013).
- Log estructurado en JSON o envío a un sistema externo.
- Rate limiting (012).

## Riesgos
- **`backend/.env` local del usuario:** `dev.ps1` lo regenera y quitará la clave, que es lo esperado. Si algo
  del entorno dependía de esa clave (por ejemplo, un antivirus que inspecciona TLS al llamar a servicios
  externos), el backend fallaría en esas llamadas. Hoy no hay llamadas salientes conocidas.
- **Doble registro** si el interceptor y el middleware quedan los dos activos.
- **Endpoints con bodies grandes:** el arquitecto no se ejecuta en este feature. El desarrollador verifica que
  ningún flujo del frontend mande más de 1 MB (merge de pacientes, alta masiva) y lo informa.

## Pasos del flujo
- Requiere UX/UI: **no**.
- Requiere seguridad: **sí**.
- Arquitecto: **omitido**. Son tres cambios chicos y localizados, y la spec fija el enfoque.
- Documentador: **sí**: COMANDOS, `.env.example` (si no lo hace el desarrollador), BACKLOG #37, #38 y #14, y
  RIESGOS.
- Cambios de schema: no.
- Commit y push: autorizados por el usuario al aprobarse (sin force).

## Salvaguardas vigentes
- No modificar `.env` raíz ni `.claude/`. `backend/.env` solo lo regenera `dev.ps1 -Init`, y eso lo corre el
  tester.
- Sin seeds ni SQL de escritura; sin `down -v`, `prune` ni borrar volúmenes; sin stash, reset ni checkout.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
- No imprimir valores del `.env`.
