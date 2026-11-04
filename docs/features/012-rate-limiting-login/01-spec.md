# 012 — Rate limiting del login

## Contexto
- **BACKLOG #11 (resto) y M-4 del 005.** `POST /api/v1/auth/login` (`auth-controller.ts`) no limita los intentos,
  así que se pueden probar contraseñas por fuerza bruta.
- **Lo que ya existe del 005 y el 006:** el 401 es genérico, se compara con bcrypt también cuando el usuario no
  existe (para que no se pueda enumerar usuarios por tiempo) y el DTO es estricto.
- **El backend no tiene `@nestjs/throttler`.** Corre en una sola instancia: en desarrollo o en el contenedor
  `backend`.
- **El navegador llama al backend directo** (`NEXT_PUBLIC_API_BASE_URL`), así que la IP que ve el backend es la del
  cliente. No hay proxy delante, y el 010 no configura `trust proxy`.
- **Frontend:** `services/data.ts` (`login`) clasifica 401 y 400, y `LoginForm.tsx` muestra el mensaje en
  `#login-error`.

## Historia de usuario
Como responsable de la plataforma, quiero limitar los intentos de login. Así un atacante no puede probar
contraseñas en masa, y un usuario legítimo que se equivoca algunas veces puede seguir entrando.

## Criterios de aceptación
1. **Límites del login,** solo en `POST /api/v1/auth/login`:
   - **Por IP:** como máximo 20 intentos por ventana de 15 minutos.
   - **Por combinación de IP y usuario** (el email normalizado, en minúsculas y sin espacios): como máximo 5
     intentos fallidos por ventana de 15 minutos. Un login exitoso reinicia el contador de esa combinación.
   - Los valores se configuran por variables opcionales (por ejemplo `LOGIN_RATE_LIMIT_IP`,
     `LOGIN_RATE_LIMIT_USER` y `LOGIN_RATE_LIMIT_WINDOW`), con validación al arrancar. Un valor inválido impide
     arrancar, con un mensaje claro.
2. **Respuesta al superar el límite:**
   - **429** con el `ErrorResponse` genérico del proyecto (`code: 'too-many-requests'` y un mensaje genérico en
     español), más el header `Retry-After` en segundos;
   - no se evalúa la contraseña ni se consulta la base;
   - la respuesta es la misma exista o no el usuario, así que no permite enumerar usuarios;
   - la línea de acceso del 010 la registra.
3. **Almacenamiento:** en memoria del proceso, con limpieza de las entradas vencidas para que la memoria no crezca
   sin límite (tope de entradas o barrido periódico). Queda documentado que con varias instancias habría que pasar
   a un almacén compartido, que hoy queda fuera de alcance.
   - Puede usarse `@nestjs/throttler` en una versión compatible con Nest 10, o una implementación propia chica.
     El desarrollador elige y lo justifica.
   - Una dependencia nueva va en una versión exacta o con caret, sin vulnerabilidades conocidas
     (`npm audit --omit=dev` sin hallazgos nuevos por ella).
4. **IP del cliente:** se toma de la conexión (`req.ip` o `socket.remoteAddress`) **sin** confiar en
   `X-Forwarded-For`, porque no hay `trust proxy`. Si en el futuro hubiera un proxy, la configuración quedaría
   documentada como pendiente.
5. **El resto de las rutas no cambia:** no se agrega un límite global. Opcional: un límite global muy alto contra
   abusos, si el desarrollador lo justifica.
6. **Frontend:** ante un 429, `login()` devuelve un estado propio (por ejemplo `{ status: 'rate-limited',
   retryAfter }`) y `LoginForm` muestra un mensaje claro sin cerrar nada:
   - "Demasiados intentos. Esperá unos minutos antes de volver a intentar." Si hay `Retry-After`, se puede indicar
     el tiempo aproximado ("Probá de nuevo en N minutos.");
   - el texto va en las constantes de mensajes que ya existen (`SESSION_MESSAGES` o similar), no como literal;
   - el foco y `aria-describedby` siguen el patrón actual de `#login-error`.
7. **Smoke y tests no se bloquean solos:** `.\dev.ps1 -Smoke` hace un solo login, así que no llega al límite. Los
   tests de Jest reinician el almacén entre casos.
8. **Tests:**
   - **Jest:** el límite por IP y por IP más usuario, el 429 con `Retry-After` y el cuerpo genérico, que un login
     exitoso reinicie el contador, que el usuario inexistente y el existente den el mismo 429, el vencimiento de la
     ventana (con reloj simulado), la limpieza de entradas, la validación de las variables y que
     `X-Forwarded-For` se ignore;
   - **frontend (`node --test`):** el mapeo de 429 en `login()`.
9. **Calidad:**
   - `npx tsc --noEmit` sin errores en backend y frontend;
   - ESLint sin errores nuevos en los archivos tocados;
   - `npm test` del backend y del frontend en verde;
   - `npm run build` del frontend OK.
10. **Verificación en vivo (tester):** en modo desarrollo, con un email inexistente ficticio y contraseñas falsas,
    sin tocar al usuario de humo:
    - 5 intentos fallidos con el mismo usuario dan 401, y el sexto da 429 con `Retry-After`;
    - otro usuario desde la misma IP todavía da 401, hasta llegar al límite por IP;
    - `-Smoke` sigue dando OK. Si hace falta, el tester reinicia el backend antes de correrlo, para vaciar el
      contador;
    - los conteos de la base no cambian.

## Fuera de alcance
- Bloqueo de la cuenta en la base, captcha y 2FA.
- Almacén compartido (Redis) para varias instancias.
- Límites en otras rutas, como el registro (que no existe).

## Riesgos
- **Bloquear a usuarios legítimos detrás de una misma IP** (una clínica con NAT): el límite por IP es más alto
  (20) y se puede configurar.
- **Memoria del proceso:** se mitiga con la limpieza de las entradas vencidas.
- **Tests que hacen muchos logins** (`login.spec`, `all-routes-auth`): hay que reiniciar el almacén o desactivar
  el limitador en esos tests, sin debilitarlos.

## Pasos del flujo
- Requiere UX/UI: **no**. Es un mensaje nuevo dentro del patrón de errores del login (005), y el texto lo fija esta
  spec.
- Requiere seguridad: **sí**.
- Arquitecto: **omitido**. El enfoque queda fijado en la spec, y la elección de librería la justifica el
  desarrollador.
- Documentador: **sí**: COMANDOS (variables nuevas), `.env.example`, BACKLOG #11 y RIESGOS (M-4).
- Cambios de schema: no.
- Commit y push: autorizados por el usuario al aprobarse (sin force).

## Salvaguardas vigentes
- Sin seeds ni SQL de escritura; sin `down -v`, `prune` ni borrar volúmenes; sin stash, reset ni checkout.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
- No imprimir valores del `.env`. No usar el usuario de humo para provocar el bloqueo.
