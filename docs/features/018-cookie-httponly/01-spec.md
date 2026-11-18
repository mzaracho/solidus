# 018 — Sesión en cookie `HttpOnly` y logout real

Ítems del BACKLOG: #10 y #55.

## Contexto
- **#10:**
  - la sesión vive en la cookie `auth_token`, que escribe el navegador desde JavaScript
    (`frontend/src/components/domain/auth/LoginForm.tsx`, `document.cookie`) con `SameSite=Lax` y `Secure` según el
    protocolo;
  - el JWT es legible desde JavaScript (`providers.tsx`, `Sidebar.tsx` y `lib/session.ts`) y lo usan las llamadas a la
    API que salen del navegador (`services/data.ts`, `getHeaders()` con `Authorization: Bearer`);
  - un XSS podría robar el token.
  - Ya resuelto en el 005: el `middleware.ts` revisa la expiración, un `mock_token` viejo se trata como vencido y el
    backend verifica el JWT (HS256, issuer y audience).
- **#55:** `LogoutCommandHandler` (`auth/logout-command-handler.ts`) no tiene `@RequestHandler` ni está registrado, así
  que el logout del backend probablemente responde "Handler not found".
- Las páginas de servidor ya leen el token de la cookie con `next/headers` (`services/session.server.ts`,
  `withServerSession`).

## Historia de usuario
Como usuario de la plataforma, quiero que mi sesión no se pueda robar con un script malicioso inyectado en la página,
y que "Cerrar sesión" la cierre de verdad.

## Criterios de aceptación
1. **Cookie no legible desde JavaScript:**
   - la cookie de sesión la emite el servidor (el backend o un route handler de Next; lo define el arquitecto) con
     `HttpOnly`, `SameSite=Lax`, `Path=/` y `Secure` en HTTPS/producción;
   - `Max-Age` igual a la expiración del JWT;
   - ningún código del frontend escribe ni lee el token con `document.cookie`, `localStorage` ni `sessionStorage`;
   - una guardia (test) lo vigila.
2. **El token no llega al JavaScript del navegador:** no viaja en el cuerpo de la respuesta de login hacia el código
   del cliente o, si viaja hasta un route handler de Next, no se reenvía al navegador.
3. **Llamadas a la API desde el navegador siguen funcionando** con la cookie `HttpOnly`. El arquitecto elige el
   mecanismo:
   - un proxy o BFF en Next que agrega `Authorization`;
   - o el backend autenticando por cookie, con CORS `credentials` y orígenes explícitos.
   En cualquier caso:
   - **CSRF:** las escrituras que se autentican con la cookie quedan protegidas, como mínimo con `SameSite=Lax` más
     una verificación de `Origin`/`Referer` o un header propio que un formulario de otro sitio no pueda enviar. El
     arquitecto lo justifica.
   - **Org y modo:** los headers `x-org-id` y `x-mode` siguen funcionando como hoy (el backend decide).
   - **Las reglas 4 y 5 no cambian:** guard global, `@CurrentOrgId()` y org-resource.
4. **Identidad en la UI sin leer el JWT:**
   - lo que hoy se saca del token en el cliente (`readSessionIdentity()`: usuario, rol, `professionalId`, etc.) se
     obtiene de otra forma, por ejemplo con un endpoint `GET /auth/me` o con datos que la página de servidor pasa al
     cliente;
   - los permisos de UI (`canDeleteActivity`, `canSeeRestrictedLinks`, el botón "Eliminar pagador") se ven igual que
     hoy.
5. **Expiración:**
   - el `middleware.ts` sigue redirigiendo al login con el aviso de sesión vencida cuando el token venció o falta;
   - un 401 en una llamada del cliente lleva al mismo login con el aviso;
   - el texto actual del aviso no cambia.
6. **Logout (#55):**
   - "Cerrar sesión" llama a un endpoint que borra la cookie del lado del servidor (`Max-Age=0`, con los mismos
     atributos) y redirige al login;
   - el handler del backend queda registrado o se elimina, si el logout pasa a ser solo de Next; lo vigila el test de
     handlers;
   - después del logout, volver atrás o abrir una ruta protegida lleva al login.
   - **Revocación del JWT antes de su vencimiento:** fuera de alcance, salvo que el arquitecto lo proponga como algo
     simple. Si no, va al BACKLOG.
7. **Login:**
   - el formulario y los textos no cambian;
   - el rate limit del 012 sigue funcionando: la IP que ve el backend sigue siendo la del cliente, o el arquitecto
     documenta el efecto si se pasa por un proxy de Next. **Si un proxy hace que todas las IPs se vean iguales, es
     bloqueante:** hay que resolverlo o consultarlo.
8. **Docker y desarrollo:**
   - funciona en `.\dev.ps1`: front en `FRONTEND_PORT` (3000 por defecto; la máquina del usuario usa 3002 porque el
     3000 está ocupado) y backend en 8080;
   - funciona en el modo `-Docker`, con el frontend en 3001→3000;
   - `-Smoke` con login sigue en OK;
   - si cambian variables (`CORS_ORIGIN`, etc.), `dev.ps1` las genera y las prueban los tests de dev-lib.
9. **Seguridad:**
   - siguen en verde `security-invariants`, `org-isolation`, `request-dto-invariants` y los tests del 005 y el 012;
   - se agregan tests de los atributos de la cookie, de CSRF, del logout y de la ausencia de token en el JS del
     cliente.
10. **Calidad:**
    - `npx tsc --noEmit` y `npx nest build` en el backend;
    - `npx tsc --noEmit` y `npm run build` en el frontend (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` si
      falla por TLS);
    - tests de backend y frontend en verde;
    - lint sin errores nuevos en los archivos tocados.

## Fuera de alcance
- Revocación o lista negra de tokens y refresh tokens, salvo que sean simples (criterio 6).
- Cambiar la duración de la sesión.
- Endurecer el rate limit (feature 030) y permisos finos (029).

## Riesgos
- **Romper todas las llamadas del cliente:** se mitiga con el smoke, los tests y la prueba con login real.
- **CSRF** al pasar a autenticar con cookie.
- **IP del rate limit** si las llamadas pasan por un proxy de Next.
- **Sesiones abiertas:** las cookies que escribió el navegador antes del cambio. El usuario tiene que volver a iniciar
  sesión una vez; se acepta.
- **Diferencias entre desarrollo (HTTP, sin `Secure`) y producción.**

## Pasos del flujo
- **Requiere UX/UI: no.** No cambian pantallas ni textos: el login, el aviso de sesión vencida y "Cerrar sesión" ya
  existen. Si el arquitecto encuentra un cambio visible, lo decide el PO.
- **Requiere seguridad: sí.**
- **Arquitecto: sí.**
- **Documentador: sí:** `CLAUDE.md` (regla 4 y convenciones del frontend), COMANDOS y RIESGOS.
- **Cambios de schema:** no se esperan.
- **Commit y push:** autorizados por el usuario al aprobarse, sin force.
