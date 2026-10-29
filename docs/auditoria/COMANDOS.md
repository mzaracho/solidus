# Comandos — instalar, buildear, testear y correr

> Probado en Windows 11 (PowerShell / Git Bash), Node 24.13.0, npm 11.6.2.
> Docker usa Node 22-alpine. Rutas relativas al repo raíz `c:\Repositorios\healthops-gem`.

## 0. Arranque rápido (`dev.ps1`)

Desde la raíz del repo, en Windows PowerShell 5.1 o PowerShell 7:
```powershell
.\dev.ps1
```
Con Docker Desktop encendido, levanta Postgres (compose de la raíz), aplica las migraciones
(`prisma migrate deploy`, nunca `db push`), instala dependencias si cambió el `package-lock.json` y abre dos
ventanas con el backend y el frontend en modo desarrollo. En un clon nuevo crea el `.env` de la raíz desde
`.env.example` con secretos aleatorios (no se muestran) y genera `backend/.env`. En cada ejecución también restringe
los permisos de los archivos con secretos y activa el hook `pre-commit` (ver más abajo). Ayuda: `Get-Help .\dev.ps1`.

### Requisitos
- Node.js 22+ y npm.
- Docker Desktop (para PostgreSQL y/o el stack completo), con el daemon local.
- Python 3 + `openpyxl` solo si se regeneran seeds desde Excel.

### Flags
| Comando | Qué hace |
|---|---|
| `.\dev.ps1` | Modo desarrollo: Postgres en Docker; backend (http://localhost:8080/api, Swagger en http://localhost:8080/) y frontend (http://localhost:`FRONTEND_PORT`, 3000 por defecto) con hot reload en dos ventanas. Backend y frontend escuchan solo en `127.0.0.1` (ver "Bind en loopback") |
| `.\dev.ps1 -Docker` | Stack completo con `docker compose up --build -d`; frontend en http://localhost:3001 (puerto fijo). Si existe `.dev/certs/extra-ca.pem` lo usa en los builds (ver "CA extra"). Si hay un modo desarrollo vivo, aborta (código 2): correr `-Stop` antes. Si el build o el arranque fallan, sale con código 9 |
| `.\dev.ps1 -Stop` | Cierra las ventanas que lanzó el script y detiene los contenedores (`docker compose stop`). No usa `down` ni borra volúmenes: los datos se conservan. Solo mata un proceso registrado si su línea de comandos corresponde a una ventana lanzada por `dev.ps1` (no confía solo en `.dev/processes.json`); si el registro no se puede leer, avisa y pide cerrar a mano las ventanas |
| `.\dev.ps1 -Seed` | Con el modo desarrollo o con `-Docker`: carga los seeds locales (`truncate.sql` → `seed.sql` → `seed_test_users.sql`). Si la base puede tener datos pide confirmación (escribir `BORRAR` si hay un seed destructivo; sin consola interactiva cancela). `seed_activities.sql` y `seed_psicolsa.sql` no se cargan solos |
| `.\dev.ps1 -Smoke` | Prueba de humo: backend, frontend y login con `SMOKE_USER`/`SMOKE_PASSWORD` del `.env` (si faltan, saltea el login: crearlos con `-CreateSmokeUser`). No escribe en la base |
| `.\dev.ps1 -Init` | Crea o sincroniza los `.env`, corrige permisos, activa el hook `pre-commit` y valida la configuración (incluido el compose con la CA extra, si existe); no levanta nada ni necesita el daemon de Docker |
| `.\dev.ps1 -ExportCa [-Yes]` | Exporta la CA que intercepta HTTPS a `.dev/certs/extra-ca.pem` (ver "CA extra para builds Docker") |
| `.\dev.ps1 -CreateSmokeUser` | Crea o actualiza el usuario de humo en la base local (ver "Usuario de humo") |
| `.\dev.ps1 -RotateDbPassword [-Yes]` | Rota la contraseña de Postgres (ver "Rotaciones") |
| `.\dev.ps1 -RotateJwtSecret [-Yes]` | Rota `JWT_SECRET` (ver "Rotaciones") |

`-Seed` solo se combina con el modo desarrollo o con `-Docker`; `-Yes` solo se combina con `-ExportCa`,
`-RotateDbPassword` o `-RotateJwtSecret`. Las demás combinaciones las rechaza PowerShell.

Si la ExecutionPolicy bloquea el script:
```powershell
powershell -ExecutionPolicy Bypass -File .\dev.ps1          # una sola vez
Unblock-File .\dev.ps1, .\scripts\*.ps1                     # o desbloquearlo
pwsh -File .\dev.ps1                                        # PowerShell 7, si está instalado
```

### Códigos de salida
| Código | Significado |
|---|---|
| 0 | OK (también si se cancelaron los seeds, la exportación de la CA o una rotación, o se salteó el login de humo) |
| 1 | Configuración inválida (`.env`, plantilla faltante, `FRONTEND_PORT` o `BIND_ADDRESS` inválidos, IPv6 en `BIND_ADDRESS` con `-Docker`, CA extra inválida o no encontrada, `compose config`, clave duplicada en `.env` al rotar) o error inesperado |
| 2 | Prerrequisito faltante (Docker, Node 22+, npm, o `backend\node_modules\bcrypt` para `-CreateSmokeUser`) o puerto ocupado; también si la rotación de la base se pide con el modo desarrollo levantado |
| 3 | Base de datos: Postgres no responde, `migrate deploy` o `generate` fallaron, falló el SQL del usuario de humo o de la rotación de la base |
| 4 | `npm install` falló |
| 5 | El backend o el frontend no respondieron a tiempo |
| 6 | Un seed falló (la base puede haber quedado a medias) |
| 7 | La prueba de humo falló |
| 8 | El daemon de Docker no es local (contexto o `DOCKER_HOST` remotos); se aborta antes de tocar nada |
| 9 | `docker compose up --build -d` falló (build o arranque de contenedores). Si la salida parece un error de certificados, la pista indica `.\dev.ps1 -ExportCa` (o revisar la CA extra si ya se usa) |
| 10 | Rotación incompleta: la contraseña de la base o `JWT_SECRET` ya cambió pero no quedó aplicada del todo (ver "Rotaciones") |

### Qué archivo editar
- Editar **solo el `.env` de la raíz** (única fuente de credenciales). `backend/.env` lo GENERA `dev.ps1`
  (empieza con `# GENERADO por dev.ps1`): no editarlo.
- Después de cambiar `.env`, correr `.\dev.ps1 -Init` (o cualquier modo, que también sincroniza).
- `dev.ps1` nunca cambia valores existentes del `.env`: solo agrega al final, bajo `# Agregadas por dev.ps1`,
  las variables que falten (`NEXT_PUBLIC_API_BASE_URL`, `SMOKE_USER`, `SMOKE_PASSWORD`, `BIND_ADDRESS`,
  `FRONTEND_PORT`). Las rotaciones (`-RotateDbPassword`, `-RotateJwtSecret`) y `-CreateSmokeUser` cambian solo la
  línea de la clave que corresponde.
- Si `POSTGRES_PASSWORD` tiene menos de 16 caracteres, avisa en cada ejecución; no la cambia. Para rotarla:
  `.\dev.ps1 -RotateDbPassword` (ver "Rotaciones").

### Variables opcionales del `.env` raíz
- `FRONTEND_PORT` — puerto del frontend en **modo desarrollo**. Default 3000. Entero de dígitos ASCII `0-9` entre
  1024 y 65535, distinto de 5433 y 8080; si no, el script termina con código 1 sin imprimir el valor (también en
  `-Docker`, porque la validación es común a todos los modos). No afecta a Docker, que usa 3001.
- `BIND_ADDRESS` — interfaz donde escuchan el backend y el frontend en **modo desarrollo**, y donde el modo
  **Docker** publica la API (8080) y el frontend (3001). Default `127.0.0.1` (solo esta PC). Postgres (5433) queda
  siempre en `127.0.0.1`. Debe ser una IP válida (si no, código 1 sin mostrar el valor). En modo Docker solo se
  admite IPv4: una IPv6 se rechaza con código 1 ("en modo Docker usa una IPv4"); el modo desarrollo acepta IPv4 o
  IPv6. Si no es loopback, `dev.ps1` muestra un aviso de exposición en ambos modos.
  **Aviso:** con `0.0.0.0` la API queda expuesta en la red local con JWT sin verificar (RIESGOS S1) y CORS
  abierto (`origin: true`). Usarlo solo en redes de confianza, y en ese caso poner la IP de la PC en
  `NEXT_PUBLIC_API_BASE_URL` (se hornea al construir) y correr `.\dev.ps1 -Docker`.
- `EXTRA_CA_THUMBPRINT` — opcional: huella(s) SHA-1 de 40 hex, separadas por coma, de la CA que `-ExportCa` debe
  exportar en lugar de detectarla (ver "CA extra para builds Docker").
- `NEXT_PUBLIC_API_BASE_URL` — URL de la API vista desde el navegador en modo Docker (default
  `http://localhost:8080/api`).
- `SMOKE_USER` / `SMOKE_PASSWORD` — usuario de humo de la base local para `-Smoke`; los genera
  `-CreateSmokeUser` (ver "Usuario de humo").

### Bind en loopback
- **Modo desarrollo:** `next dev` se lanza con `-H <BIND_ADDRESS>` (por defecto `127.0.0.1`) y el backend escucha
  en el `LISTEN_HOST` de `backend/.env`, que `dev.ps1` genera siempre a partir de `BIND_ADDRESS`. Las esperas y
  `-Smoke` prueban contra `127.0.0.1` y no contra `localhost` (en Windows `localhost` prueba primero `::1`).
- **`LISTEN_HOST` (backend):** variable leída por `getListenHost` en
  `backend/src/infrastructure.bootstrap/config/app/listen-config.ts`. Si falta o está vacía, el backend escucha
  solo en `127.0.0.1` (falla cerrado). Un backend arrancado a mano sin `LISTEN_HOST` queda por lo tanto en loopback.
- **Modo Docker:** `docker-compose.yml` fija `LISTEN_HOST: "0.0.0.0"` dentro del contenedor (necesario para que el
  puerto publicado funcione); lo que decide la exposición es el puerto publicado, `${BIND_ADDRESS:-127.0.0.1}`.

### CA extra para builds Docker (antivirus o proxy con inspección TLS)
Un antivirus o proxy que inspecciona HTTPS reemplaza los certificados con su propia CA, que los contenedores no
conocen: `apk`, `npm`, Prisma y la descarga de Google Fonts de `next build` fallan por TLS. Solución, sin desactivar
nunca la verificación TLS:
```powershell
.\dev.ps1 -ExportCa          # pide confirmación (s/N)
.\dev.ps1 -ExportCa -Yes     # sin preguntar (necesario sin consola interactiva)
.\dev.ps1 -Docker            # usa la CA solo
```
- `-ExportCa` detecta la CA probando conexiones TLS a los hosts del build (`registry.npmjs.org`,
  `dl-cdn.alpinelinux.org`, `fonts.googleapis.com`, `binaries.prisma.sh`) contra las CAs públicas de la imagen base
  (`node:22-alpine`), y exporta desde el almacén de certificados de Windows **solo la parte pública** (nunca claves
  privadas). Con `EXTRA_CA_THUMBPRINT` en `.env` se indica la CA a mano en lugar de detectarla.
- Muestra el sujeto y la huella SHA-1 completa de cada CA: **compararla con `certmgr.msc` antes de confirmar**; una CA
  equivocada permitiría interceptar las descargas del build. Sin consola interactiva y sin `-Yes` cancela con
  código 0 sin escribir. Si el archivo no cambia, no vuelve a preguntar.
- El PEM queda en `.dev/certs/extra-ca.pem`, ignorado por git (`.dev/`, `*.pem`, `*.crt`, `*.key`, `*.pfx`,
  `*.p12` en `.gitignore`) y por los `.dockerignore` de `backend/` y `frontend/`, con permisos solo del usuario.
- `-Docker` agrega automáticamente `docker-compose.extra-ca.yml` si el PEM existe ("Usando CA extra"): declara el
  secreto de BuildKit `extra_ca` para los builds de backend y frontend. A mano:
  `docker compose -f docker-compose.yml -f docker-compose.extra-ca.yml up --build -d`.
- Cada `RUN` con red de los Dockerfiles (`apk add`, `npm install`, `npx prisma generate`, `npx prisma -v`,
  `npm run build` del frontend) se ejecuta con `docker/with-extra-ca.sh`, que monta el secreto solo durante ese
  paso, arma un bundle temporal (CAs del sistema + la extra) y exporta las variables de `apk`, Node y Turbopack
  solo para ese proceso. **La CA no queda en ninguna capa de las imágenes** ni en su `Config.Env`.
- **Sin el PEM el build es el normal** (el script ejecuta el comando tal cual): otro desarrollador o un CI no
  necesita nada.
- El builder del backend instala `openssl` y descarga en el build los motores de Prisma (`prisma -v`), para que
  `prisma migrate deploy` al arrancar el contenedor no descargue nada (sin la CA, el contenedor no la tiene). Un
  paso `test -f` falla el build si falta algún motor.
- `-Init` valida también el compose con el override cuando el PEM existe. Si cambia la CA (por ejemplo, el
  antivirus la renueva), repetir `-ExportCa`.

### Usuario de humo
`.\dev.ps1 -CreateSmokeUser` crea un usuario de prueba **dedicado** en la base local para que `-Smoke` pueda hacer
login (en modo desarrollo y en modo Docker).
- Si `SMOKE_USER` y `SMOKE_PASSWORD` están vacíos en `.env`, los genera al azar (email
  `smoke-<8 hex>@solidus.invalid`; contraseña de 48 caracteres hex) y los guarda en `.env`, **sin mostrarlos**.
  Si ya tienen valores, los reutiliza, siempre que tengan ese formato (si no: código 1; vaciarlos para regenerar).
- Inserta o actualiza **una sola fila de `User`** (nombre "Usuario de humo (dev.ps1)"), con la contraseña hasheada con
  el `bcrypt` del backend (cost 10, la contraseña pasa por stdin, nunca por argumentos). Solo actualiza una fila que
  ya tenga ese nombre: nunca modifica otros usuarios.
- **Sin organización ni membresía ni roles:** no se le da acceso a datos de ninguna organización.
- **Idempotente:** repetirlo actualiza el mismo usuario ("actualizado" en lugar de "creado").
- Opera solo contra el daemon y el `db` del compose local. Requiere `backend\node_modules\bcrypt` (correr
  `.\dev.ps1` una vez) y que las migraciones estén aplicadas.
- Luego, `.\dev.ps1 -Smoke` da "Login OK".
- **Aviso (M-8):** si el SQL del usuario de humo falla (se ejecuta con `ON_ERROR_STOP`), Postgres puede dejar la
  sentencia, que incluye el **hash bcrypt** (no la contraseña) de la contraseña de humo, en
  `docker compose logs db`. Impacto bajo (usuario sin organización ni roles, base local). Si ese log se comparte:
  vaciar `SMOKE_USER` y `SMOKE_PASSWORD` en `.env` y repetir `-CreateSmokeUser`.
- Riesgo residual (de la revisión de seguridad): hoy los JWT no se verifican, así que que el usuario no tenga
  membresía no agrega ni quita privilegios reales; en el feature 005 hay que comprobar que reciba 401 o 403.

### Rotaciones
Ambas piden confirmación: escribir `ROTAR` en consola interactiva, o `-Yes` (necesario sin consola; sin `-Yes` y sin
consola cancelan con código 0 sin cambiar nada). Ninguna muestra los valores.

**`.\dev.ps1 -RotateDbPassword`** — rota la contraseña de Postgres a una nueva de 48 caracteres hex, sin pérdida de datos.
1. Rechaza (código 2) si el modo desarrollo está levantado: `-Stop` antes. Valida `POSTGRES_USER` y `POSTGRES_DB`, que
   `POSTGRES_PASSWORD` no esté duplicada en `.env` y que `.env` se pueda escribir.
2. Pide confirmación; levanta `db` si hace falta.
3. `ALTER ROLE` en la base, por el socket local del contenedor (no necesita la contraseña anterior).
4. Guarda la nueva en `.env` (solo esa línea).
5. Regenera `backend/.env`.
6. Verifica por TCP (host `db`, dentro del contenedor) que la base acepta la nueva.
7. Si el backend de Docker está corriendo, lo recrea (`up -d --no-deps --no-build backend`).
- Si falla el paso 3: código 3, no se cambió nada. Si falla el 6: código 3 (la base no acepta la contraseña guardada).
- **Código 10 (rotación incompleta):** la base ya tiene la contraseña nueva pero no se pudo guardar en `.env` (paso 4)
  o no se pudo regenerar `backend/.env` (paso 5). **Recuperar:** si fue el paso 4, volver a ejecutar
  `.\dev.ps1 -RotateDbPassword` (genera otra y la aplica a la base y a los archivos sin necesitar la anterior); si fue
  el paso 5, `.\dev.ps1 -Init` regenera `backend/.env`.
- Tras rotar, levantar con `.\dev.ps1` o `.\dev.ps1 -Docker`. También sirve para el error `P1000` (volumen
  inicializado con otra contraseña).

**`.\dev.ps1 -RotateJwtSecret`** — rota `JWT_SECRET` (32 bytes hex nuevos).
1. Valida que `JWT_SECRET` no esté duplicada y que `.env` se pueda escribir; pide confirmación.
2. Cambia solo la línea `JWT_SECRET` de `.env` (error al guardar: código 1, no cambia nada).
3. Regenera `backend/.env` (si falla: código 10; recuperar con `.\dev.ps1 -Init`).
4. Si el backend de Docker corre en el daemon local, lo recrea solo a él (si falla: código 10; el secreto ya quedó
   rotado en los `.env`; recuperar con `.\dev.ps1 -Docker` o `docker compose up -d --no-deps backend`).
5. Si el modo desarrollo está levantado, avisa que sigue con el secreto anterior hasta reiniciarlo (`-Stop` y
   `.\dev.ps1`).
- **Invalida las sesiones abiertas:** hay que volver a iniciar sesión.

### Permisos de los archivos con secretos (S-1)
En cada ejecución de `-Init` y de los modos que sincronizan la configuración, `dev.ps1` deja con acceso solo para el
usuario actual, `SYSTEM` y Administradores (herencia cortada, por SID) los archivos y carpetas locales con secretos:
`.env`, `backend/.env`, `backend/.env.pre-003*.bak`, `.dev/` (se crea si no existe), `.dev/processes.json` y
`.dev/certs/extra-ca.pem`. Los archivos nuevos se escriben con un temporal ya restringido y reemplazo atómico. Si el
sistema de archivos no admite ACL, avisa y sigue. Se puede comprobar con `icacls .env`.

### Hook `pre-commit` (control de secretos al commitear)
- **Activación:** `.\dev.ps1 -Init` (y los demás modos que sincronizan la configuración) ejecuta
  `git config --local core.hooksPath .githooks`. Si `core.hooksPath` ya apunta a otra carpeta no la cambia y avisa
  que el control NO está activo. Para activarlo a mano: `git config --local core.hooksPath .githooks`.
- **Cómo funciona:** `.githooks/pre-commit` (sh) ejecuta `scripts/pre-commit.ps1` con `powershell.exe` o `pwsh`; si no
  hay PowerShell, rechaza el commit (falla cerrado), igual que ante un error interno. Revisa solo lo que está en el
  stage (en las líneas agregadas).
- **Qué bloquea:**
  - Archivos: `.env`, `*.env` y `.env.*` (salvo `*.env.example`), `.envrc`, `*.bak`, cualquier `.sql` fuera de
    `backend/prisma/migrations/`, `*.sqlite`, `*.sqlite3`, `*.db`, `*.dump`, `*.crt`, `*.pem`, `*.key`, `*.pfx`,
    `*.p12`, `*.jks`, `*.keystore`, `*.zip`, `*.7z`, `.dev/` y `.claude/settings.local.json`.
  - Contenido: los valores actuales de `POSTGRES_PASSWORD`, `JWT_SECRET` y `SMOKE_PASSWORD` del `.env` local (si no
    hay `.env` o no tiene valores, avisa que esa regla no se aplicó y sigue con las demás); claves privadas, certificados
    PEM, JWT (`eyJ...`), claves AWS, hashes bcrypt, URLs con usuario y contraseña que no sean placeholders e IPs
    `192.168.x.x`.
  - `.claude/settings.json` con entradas en `permissions.allow` o con `defaultMode` (regla 12 del proyecto).
- **No imprime valores:** solo `archivo[:línea]: tipo de hallazgo`.
- **`git commit --no-verify` existe** y saltea el hook, pero **no debe usarse para commitear secretos**: solo para un
  falso positivo comprobado. Un hallazgo se resuelve sacando el archivo del stage (`git restore --staged <archivo>`)
  o corrigiéndolo.
- **Segunda barrera recomendada:** activar *push protection* y *secret scanning* en el repositorio de GitHub. El hook
  es local y salteable; es una acción del usuario, todavía pendiente (ver RIESGOS.md).
- En Linux o macOS, si hiciera falta el bit de ejecución: `git update-index --chmod=+x .githooks/pre-commit`.

### Errores comunes
| Síntoma | Causa y solución |
|---|---|
| "Docker Desktop no esta corriendo" (código 2) | Abrir Docker Desktop, esperar "Engine running" y repetir |
| Puerto ocupado (código 2) | El mensaje indica puerto, PID y proceso. Si el 3000 lo usa otro proyecto: definir `FRONTEND_PORT` (por ejemplo 3002) en `.env`. Para 8080 o 5433, liberar el proceso |
| 5433 ocupado por un contenedor de otro proyecto | Típico: el `db` del viejo compose de `backend/` (que ya no existe). El mensaje nombra el contenedor; detenerlo con `docker stop <nombre>` |
| `P1000` en `migrate deploy` (código 3) | El volumen de Postgres se inicializó con otra contraseña distinta de la del `.env`. Correr `.\dev.ps1 -RotateDbPassword` (la aplica a la base y al `.env` sin necesitar la anterior). No se borra el volumen automáticamente |
| `EPERM` en `prisma generate` (código 3) | Hay un backend con el motor de Prisma abierto. Cerrar los procesos node del backend (`.\dev.ps1 -Stop`) y repetir |
| `FRONTEND_PORT` inválido (código 1) | También aborta `-Docker`. Corregir el valor o quitarlo |
| `docker compose up --build` falla en `apk add`, `npm` o `next build` por TLS ("TLS: server certificate not trusted", "unable to verify the first certificate", "TLS-related") (código 9) | Red o antivirus con inspección TLS. Correr `.\dev.ps1 -ExportCa` (confirmar sujeto y huella) y repetir `.\dev.ps1 -Docker`: ver "CA extra para builds Docker". Si ya existe `.dev/certs/extra-ca.pem` y sigue fallando, volver a exportarla o indicar la huella correcta con `EXTRA_CA_THUMBPRINT` |
| Código 9 sin error de certificados | Falló el build o algún contenedor no arrancó. Revisar la salida del build y `docker compose logs` |
| Código 10 | Una rotación quedó a medias. Ver "Rotaciones" para recuperar |
| `core.hooksPath ya apunta a otra carpeta` (aviso) | El hook `pre-commit` de secretos no está activo. Activarlo con `git config --local core.hooksPath .githooks` |
| Login rechazado (HTTP 401) en `-Smoke` | El usuario de humo no existe o no coincide con `.env`: `.\dev.ps1 -CreateSmokeUser` |
| Código 8 | `DOCKER_HOST` o el contexto activo apuntan a un daemon remoto. Usar el Docker Desktop local (`docker context use default`, quitar `DOCKER_HOST`). `-Stop` solo avisa y no toca contenedores |
| Código 7 en `-Smoke` | No hay nada levantado o el login falló (crear el usuario con `-CreateSmokeUser` o revisar `SMOKE_USER`/`SMOKE_PASSWORD`) |

### Archivos locales que deja `dev.ps1` (todos ignorados por git)
- `.dev/processes.json`: PIDs de las ventanas lanzadas (lo usa `-Stop`, que además verifica la línea de comandos).
- `.dev/certs/extra-ca.pem`: CA pública exportada por `-ExportCa` (solo si hace falta; ver "CA extra").
- `backend/.env.pre-003.bak` (y `backend/.env.pre-003.<fecha>.bak` si ya existía): copia del `backend/.env`
  anterior a la migración. **Contiene credenciales viejas**: borrarlo cuando todo funcione. Los comentarios y
  líneas no parseables de ese archivo no se migraron; solo quedan ahí.
- `node_modules/.dev-ps1-lock.sha256`: sello para saltear `npm install` si el lock no cambió.

### Volumen huérfano `backend_postgres_data`
El viejo `backend/docker-compose.yml` (eliminado en el 003) usaba el volumen `backend_postgres_data`. Si existe,
queda sin contenedor y **no se borra solo**: los datos de trabajo están en `healthops-gem_solidus_postgres_data`
(compose de la raíz) y `dev.ps1` avisa del huérfano en cada ejecución. Solo si el usuario decide descartarlo:
```powershell
docker volume ls --format '{{.Name}}'      # confirmar el nombre
docker volume rm backend_postgres_data     # IRREVERSIBLE; falla si algún contenedor lo usa
```
Nunca borrar `healthops-gem_solidus_postgres_data` ni usar `docker compose down -v`.

Más abajo (secciones 1 a 7) está el procedimiento manual, sin `dev.ps1`.

## 1. Obtener el código
Hay un único repo git; `backend/` y `frontend/` son carpetas comunes (no submódulos):
```bash
git clone https://github.com/mzaracho/solidus.git
cd solidus
```

### Variables de entorno (obligatorio antes de levantar nada)
Las credenciales no se versionan. Con `dev.ps1` (sección 0) no hay que copiar nada: `.\dev.ps1 -Init` crea el
`.env` de la raíz (secretos aleatorios) y genera `backend/.env`.

Sin `dev.ps1` (por ejemplo macOS o Linux): copiar `.env.example` a `.env` (raíz, lo lee docker compose) y
`backend/.env.example` a `backend/.env` (referencia: Nest y Prisma), y completar los valores a mano.
- Reemplazar todos los `change-me`. `POSTGRES_*` del `.env` raíz deben coincidir con el usuario, contraseña
  y base de `DATABASE_URL` en `backend/.env`.
- `JWT_SECRET` es obligatorio y debe tener 32 caracteres o más; el backend no arranca sin él.
  Generarlo con: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- El compose falla con un mensaje claro si falta una variable (`${VAR:?mensaje}`).
- `frontend/.env.example` (opcional): copiarlo a `frontend/.env.local` solo para cambiar las URLs de la API en
  `npm run dev`.

## 2. Base de datos (desarrollo local)
La base es el servicio `db` del compose de la raíz (ya no existe `backend/docker-compose.yml`); los modos
desarrollo y Docker comparten la misma base.
```bash
docker compose up -d db       # (raíz) postgres:16.11-alpine (versión fijada) en 127.0.0.1:5433; credenciales del .env de la raíz
cd backend
npx prisma migrate deploy     # aplica migraciones (el README dice "db push": no usar)
npx prisma generate           # regenera el cliente si cambió el schema
```
`backend/.env` debe existir (lo genera `.\dev.ps1 -Init`).
Para crear una migración nueva tras editar `prisma/schema.prisma`:
```bash
npx prisma migrate dev --name <descripcion>
```

### Seeds (SQL en la raíz)
Recomendado: `.\dev.ps1 -Seed` (o `.\dev.ps1 -Docker -Seed`). Aplica `truncate.sql` → `seed.sql` →
`seed_test_users.sql`, copia cada archivo al contenedor (sin pasar por la codificación de PowerShell) y pide
confirmación si la base puede tener datos. Solo opera sobre el `db` del compose local.

A mano, desde la raíz, con el servicio `db` (sin depender del nombre del contenedor; `<usuario>` y `<base>`
son `POSTGRES_USER` y `POSTGRES_DB` del `.env`):
```powershell
Get-Content truncate.sql        | docker compose exec -T db psql -U <usuario> -d <base>
Get-Content seed.sql            | docker compose exec -T db psql -U <usuario> -d <base>
Get-Content seed_test_users.sql | docker compose exec -T db psql -U <usuario> -d <base>
```
(En Windows PowerShell 5.1, `Get-Content | docker` puede alterar las tildes; `dev.ps1 -Seed` no tiene ese problema.)
`truncate.sql` y `seed_psicolsa.sql` hacen `TRUNCATE ... CASCADE` de todas las tablas.
`prisma/seed.ts` está deprecado (solo imprime un aviso).

> **Nota — archivos locales, no versionados:** los seeds (`seed*.sql`, `truncate.sql`) y los
> scripts generadores (`generate_seed*.py`) son locales y no se versionan (están en `.gitignore`).
> En un clon nuevo **no van a estar**: hay que obtenerlos por otro canal o regenerarlos.
> Las planillas de origen (`*.xlsx`, `*.xls`) y las exportaciones (`*.csv`, `*.dump`, `*.backup`)
> también están ignoradas. `backend/prisma/seed.ts` y las migraciones sí se versionan.

## 3. Backend (`backend/`)
```bash
npm install
# backend/.env necesario (no versionado; lo genera .\dev.ps1, no editar). Variables usadas:
#   NODE_ENV, APP_NAME (obligatorias: el Logger lanza error si faltan)
#   PORT=8080
#   DATABASE_URL="postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5433/solidus_db?schema=public"
#   JWT_SECRET=<obligatorio, mínimo 32 caracteres; el backend no arranca sin él>
#   (POSTGRES_* ya no van en backend/.env: viven solo en el .env de la raíz)
#   BODY_SIZE_LIMIT (opcional, default 50mb)
#   CORS_ORIGIN / CORS_METHODS (hoy ignoradas por el código)

npm run start:dev     # nest start --watch  -> http://localhost:8080/api ; Swagger en http://localhost:8080/
npm run build         # tsc --noEmit && nest build  (reescribe dist/)
npm run start:prod    # node dist/src/api/main.js
```

### Calidad
```bash
npx tsc --noEmit                              # type-check (hoy: OK)
npx eslint "{src,apps,libs,test}/**/*.ts"     # lint SIN modificar archivos (hoy: 768 errores)
npm run lint                                  # OJO: incluye --fix, reescribe archivos
npm run format                                # prettier --write sobre src/ y test/
```

### Tests
```bash
npm test              # jest (hoy: solo jwt-config.spec.ts)
npm run test:cov      # cobertura en backend/coverage
npm run test:e2e      # requiere DB; el único e2e es boilerplate roto
```

## 4. Frontend (`frontend/`)
```bash
npm install
# Variables:
#   NEXT_PUBLIC_API_BASE_URL  URL del backend vista desde el navegador (default http://localhost:8080/api)
#   INTERNAL_API_URL          URL del backend para SSR/rewrites (default http://localhost:8080/api tanto en
#                             rewrites como en services/data.ts; en Docker lo define docker-compose.yml
#                             como http://backend:8080/api)
# Ambas pueden sobrescribirse en frontend/.env.local (ver frontend/.env.example).

npm run dev           # next dev -> http://localhost:3000 (dev.ps1 usa `-p $FRONTEND_PORT`)
npm run build         # next build
npm run start         # next start (requiere build previo)
npx tsc --noEmit      # type-check (hoy: OK)
npm run lint          # eslint (sin --fix; hoy: 133 errores)
```
Si `next build` falla con `Failed to fetch 'Inter' from Google Fonts` (error TLS en esta máquina):
```powershell
$env:NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS = "1"; npm run build
```
```bash
NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 npm run build
```

No hay comando de tests en el frontend.

## 5. Stack completo con Docker (raíz)
```bash
# requiere el .env de la raíz (ver sección 1); sin POSTGRES_* o JWT_SECRET falla con un mensaje claro
docker compose up --build -d
# db:       localhost:5433
# backend:  localhost:8080 (corre prisma migrate deploy al iniciar)
# frontend: localhost:3001
```
Equivalente: `.\dev.ps1 -Docker`. Los puertos se publican en `${BIND_ADDRESS:-127.0.0.1}` (Postgres siempre en
`127.0.0.1`). `NEXT_PUBLIC_API_BASE_URL` sale del `.env` de la raíz (default `http://localhost:8080/api`) y se
hornea al construir el frontend: para usarlo desde otro equipo de la red, poner la IP de la red local de esta
PC en esa variable, `BIND_ADDRESS=0.0.0.0` y reconstruir (ver los avisos de la sección 0).
Detrás de un antivirus o proxy con inspección TLS, el build manual necesita el override de CA extra:
`docker compose -f docker-compose.yml -f docker-compose.extra-ca.yml up --build -d` (tras `.\dev.ps1 -ExportCa`).

## 6. Usuarios de prueba
Definidos en `seed_test_users.sql` (`admin@solid.com`, `member@solid.com`, `camila@solid.com`)
con la contraseña documentada en ese archivo. `seed_test_users.sql` es un archivo local no
versionado (ignorado por `seed*.sql`): en un clon nuevo hay que obtenerlo por otro canal.
Ver `RIESGOS.md` (S5). Aparte, `.\dev.ps1 -CreateSmokeUser` crea el usuario de humo para `-Smoke` (sección 0).

## 7. Debug desde Claude Code
`.claude/launch.json` define "Frontend (Next.js)" (`npm run dev`, puerto 3000) y
"Backend (NestJS)" (`npm run start:dev`, puerto 8080).
