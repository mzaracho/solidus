# 004 — Cierre de pendientes del 003 (arranque local, Docker y controles)

## Contexto
El feature 003 (`dev.ps1`, commit `ce31ea6`) quedó aprobado con pendientes (ver
`docs/features/003-arranque-local-rapido/09-cierre.md`):
- **Modo Docker sin verificar en vivo.** El build falla porque el análisis HTTPS de **AVG Antivirus**
  ("AVG Web/Mail Shield Root") reemplaza los certificados. Los contenedores no confían en esa CA, así
  que fallan `apk`, `npm` y `apt` dentro de cualquier build. AVG no permite excluir hosts en esta
  máquina.
- **Menores del script:**
  - un build fallido sale con el código 3 ("Base de datos");
  - en 5.1 aparecen líneas `RemoteException` en la salida;
  - la rama "ya está levantado" toma el puerto del `.env` actual;
  - la validación del puerto usa `\d`;
  - Next dev y el backend de desarrollo escuchan en todas las interfaces;
  - se rechaza un daemon de Docker en `tcp://localhost`.
- **Menores de seguridad:**
  - permisos heredados del `.env` en Windows (S-1);
  - `-Stop` confía en un archivo editable (S-5);
  - la imagen de Postgres no está fijada (S-6).
- **Sin control automático contra secretos al commitear:** el barrido se hace a mano.
- **Prueba de humo sin login:** no hay un usuario de prueba cargado.
- **Housekeeping autorizado por el usuario:**
  - `frontend/package-lock.json` sin commitear (solo alinea el nombre del paquete);
  - respaldos `.bak` con credenciales viejas;
  - volúmenes huérfanos;
  - `C:\Repositorios\_backup_git\`;
  - contraseña de Postgres de menos de 16 caracteres.

Después de este feature viene el 005 (seguridad del backend: logs, CORS, JWT, dependencias). Luego se
retoman features de a una.

## Historia de usuario
Como desarrollador, quiero que el arranque local funcione completo en esta máquina, incluido el modo
Docker con el antivirus activo, con controles automáticos contra secretos y sin pendientes del 003,
para empezar features nuevas sobre una base limpia.

## Criterios de aceptación

### Docker con CA interceptora (AVG)
1. **CA extra opcional en los builds:**
   - los Dockerfiles de `backend/` y `frontend/` aceptan, de forma opcional, uno o más certificados
     raíz extra (solo la parte pública) para todas las operaciones de red del build: `apk`,
     `npm install`/`npm ci` y cualquier descarga, en todas las etapas que las tengan;
   - sin el certificado, el build se comporta exactamente como hoy (otro dev o un CI no necesita nada);
   - el certificado no queda en ninguna capa de la imagen final, o si el diseño lo justifica, queda
     solo en imágenes locales, documentado y nunca publicado;
   - nunca se desactiva la verificación TLS (`--no-check-certificate`, `strict-ssl false`,
     `NODE_TLS_REJECT_UNAUTHORIZED=0`).
2. **Obtención del certificado:**
   - `dev.ps1` ofrece una forma explícita (flag o variable del `.env`) de exportar el certificado
     público de la CA interceptora desde el almacén de certificados de Windows a un archivo local;
   - la exportación detecta la CA o permite indicarla, y nunca exporta claves privadas;
   - el archivo queda ignorado por git y por los `.dockerignore` que corresponda;
   - el modo `-Docker` lo usa automáticamente si existe.
3. **Modo Docker verificado en vivo en esta máquina** (pendiente del criterio 11 del 003):
   - `.\dev.ps1 -Docker` → código 0;
   - `.\dev.ps1 -Smoke` → backend OK, frontend en 3001 OK y login OK;
   - 8080 y 3001 publicados en `127.0.0.1` (`docker ps`);
   - `.\dev.ps1 -Stop` sin pérdida de datos.

### Ajustes de `dev.ps1`
4. Un fallo de `docker compose up --build` (build o arranque de contenedores) sale con un **código
   propio**, documentado en la ayuda y en la tabla de códigos, con una pista que mencione la CA del
   criterio 2 cuando el error sea de certificados.
5. En Windows PowerShell 5.1, la salida de error de los comandos nativos (docker, npm, prisma) se
   muestra como texto, sin líneas `System.Management.Automation.RemoteException`.
6. La rama "el entorno ya está levantado" muestra la URL con el puerto con que se lanzó el frontend
   (guardado al lanzar). Si `FRONTEND_PORT` cambió desde entonces, avisa que hay que correr `-Stop` y
   volver a levantar.
7. La validación de `FRONTEND_PORT` acepta solo los dígitos ASCII `0-9`.
8. **Modo desarrollo solo en loopback por defecto:**
   - el frontend (`next dev`) y el backend (Nest) escuchan en `127.0.0.1`;
   - si `BIND_ADDRESS` está definida en el `.env` (por ejemplo `0.0.0.0`), se usa esa interfaz;
   - el modo Docker no cambia: los contenedores escuchan en la red interna y se publican según
     `BIND_ADDRESS`;
   - el cambio en el backend es mínimo (host configurable por variable con default compatible) y no
     rompe el contenedor.
9. El chequeo de daemon local acepta, además de `npipe://` y `unix://`, `tcp://localhost`,
   `tcp://127.0.0.1` y `tcp://[::1]`. Cualquier otro host sigue siendo "no local" (código 8).
10. `-Stop` solo mata un proceso registrado si, además del nombre y la hora de inicio, su línea de
    comandos corresponde a una ventana lanzada por `dev.ps1` (S-5).
11. **Permisos de archivos locales con secretos (S-1):**
    - al crear o escribir `.env`, `backend/.env`, los `.bak` y el archivo del criterio 2 (si
      corresponde), el script deja acceso solo al usuario actual (más `SYSTEM` y Administradores si
      el diseño lo justifica);
    - los archivos existentes se corrigen al ejecutar `-Init` o el modo desarrollo;
    - la corrección no falla en un sistema de archivos sin ACL: avisa y sigue.
12. La imagen `postgres` queda fijada en una versión menor de la 16 compatible con el volumen
    existente, sin migrar datos (S-6).

### Usuario de prueba para la prueba de humo
13. **Usuario de humo:**
    - existe una forma explícita (flag) de crear un **usuario de humo dedicado** en la base local;
    - si `SMOKE_USER`/`SMOKE_PASSWORD` están vacíos en el `.env`, los genera de forma aleatoria (sin
      mostrarlos) y los guarda;
    - crea o actualiza **solo ese usuario**, con la contraseña hasheada como lo espera el backend
      (bcrypt);
    - no modifica usuarios existentes ni le da acceso a datos de ninguna organización, salvo lo
      mínimo que el login necesite (a definir por el arquitecto);
    - es idempotente, opera solo contra el daemon y el contenedor locales, y no imprime la
      contraseña.
14. Con ese usuario, `.\dev.ps1 -Smoke` da **Login OK** en modo desarrollo y en modo Docker.

### Control de secretos al commitear
15. **Hook `pre-commit` versionado** (por ejemplo en `.githooks/`), activado por `dev.ps1 -Init` en la
    configuración local del repo. Rechaza el commit, sin imprimir valores, si lo staged contiene:
    - archivos prohibidos: `.env` (salvo `*.env.example`), `backend/.env*`, `*.bak`, seeds `*.sql`
      de la raíz, `.claude/settings.local.json`, certificados o claves (`*.crt`, `*.pem`, `*.key`,
      `*.pfx`);
    - los valores actuales de `POSTGRES_PASSWORD`, `JWT_SECRET` y `SMOKE_PASSWORD` del `.env` local;
    - patrones genéricos: claves privadas, JWT (`eyJ...`), claves AWS, URLs con usuario y contraseña
      que no sean placeholders, IPs privadas `192.168.x.x`;
    - `.claude/settings.json` con entradas en `allow` o con `defaultMode` (regla 12).

    El mensaje indica archivo y tipo de hallazgo. Se puede saltear con `--no-verify`, y está
    documentado que no debe usarse con secretos. Funciona con Git for Windows. Los tests cubren casos
    positivos y negativos con valores ficticios.

### Housekeeping (autorizado por el usuario)
16. Commitear `frontend/package-lock.json` (alinea `name` con `package.json`).
17. **Rotar la contraseña de Postgres:**
    - nueva contraseña aleatoria de 48 caracteres hex;
    - aplicada al rol en la base local y al `.env`; `backend/.env` regenerado;
    - sin pérdida de datos ni impresión del valor;
    - de forma reproducible (preferentemente un flag del script, con confirmación);
    - después: modo desarrollo y modo Docker funcionando.
18. **Borrar los restos:**
    - `backend/.env.pre-003*.bak`;
    - los volúmenes huérfanos `backend_postgres_data` y `healthops-gem_healthops_postgres_data`,
      verificando antes que ningún contenedor los use;
    - `C:\Repositorios\_backup_git\`, al final, después del último barrido.

    Ningún otro volumen ni contenedor se toca.
19. **Datos intactos:** los conteos de la base (User, Organization, Patient, WorkItem y total de
    `public`) son iguales antes y después. La única diferencia admitida es el usuario de humo del
    criterio 13: +1 `User` y las filas mínimas asociadas, detalladas en el informe.

### Calidad y documentación
20. **Calidad:**
    - tests de `dev-lib` en verde, incluidos los nuevos;
    - `npx tsc --noEmit` en backend y frontend;
    - lint sin errores nuevos en los archivos tocados;
    - `npm test` del backend;
    - `docker compose config --quiet` OK.
21. **Documentación:**
    - `CLAUDE.md` y `docs/auditoria/COMANDOS.md` documentan la CA extra, el usuario de humo, la
      rotación, el hook (activación y qué bloquea), el nuevo código de salida y el bind en loopback
      del modo desarrollo;
    - `RIESGOS.md` refleja S-1, S-5 y S-6 resueltos.

## Fuera de alcance
- Seguridad del backend: logs con credenciales, CORS, verificación de JWT y dependencias (feature 005).
- Instalar PowerShell 7: no está autorizado. Sigue verificado solo de forma estática.
- Reescribir el historial de git.
- El resto del BACKLOG.

## Riesgos
- **La CA de AVG habilita MITM:** es pública, pero si se cuela en el repo o en una imagen publicada
  extiende esa confianza. Se mitiga con el criterio 1, el `.gitignore`/`.dockerignore` y el hook del
  criterio 15.
- **Rotación de contraseña:** si se corta a mitad de camino, la base y el `.env` quedan
  desincronizados. Hay que ordenar los pasos y dar una forma de recuperar.
- **Bind en loopback:** puede romper el acceso por `localhost` si un componente resuelve IPv6 (`::1`).
  Las esperas y la prueba de humo deben usar una dirección que funcione.
- **Usuario de humo en la base:** es un usuario real en la base local. Debe tener el mínimo acceso y
  un nombre que lo identifique.
- **Borrado de volúmenes:** es irreversible. El usuario lo autorizó; se verifica que no estén en uso.
- **`settings.json`:** el harness lo ensucia. Se revisa antes de commitear (regla 12).

## Pasos del flujo
- Requiere UX/UI: **no** (solo consola).
- Requiere seguridad: **sí** (certificados, secretos, permisos, hook, usuario en la base).
- Arquitecto: **sí**.
- Documentador: **sí**.
- Cambios de schema: ninguno. El usuario de humo es un dato, no un cambio de schema.
- Commit y push: autorizados por el usuario cuando revisor, seguridad y tester aprueben (sin force).
