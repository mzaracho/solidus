# 03 — Diseño técnico: 004-cierre-pendientes-003

> Autor: arquitecto. Entrada: `01-spec.md` (21 criterios), `00-estado.md`, `.claude/CLAUDE.md` y, como
> antecedente, los documentos 03, 04 (§10 y §11), 05, 06, 07 y 09 del feature 003.
> Solo lectura: no se ejecutó `dev.ps1`, no se leyeron ni imprimieron valores de `.env`, `backend/.env`,
> los `.bak` ni `_backup_git` (solo nombres de archivos). No se arrancaron, detuvieron ni crearon
> contenedores. No hubo SQL: el contenedor `db` estaba detenido, así que la versión de Postgres se tomó de
> la imagen. No se modificó código.
>
> **Regla para este documento y los siguientes del feature:** el hook del criterio 15 va a revisar los
> `.md` al commitear. Por eso aquí los patrones se escriben como regex (por ejemplo `-{5}BEGIN`) y nunca
> como ejemplos literales que coincidan.

## 1. Estado actual verificado

| Pieza | Hallazgo |
|---|---|
| Postgres | El contenedor `healthops-gem-db-1` usa la imagen `postgres:16-alpine` con ID `d7ead3a9d3fe…`, creada el 2026-01-28, con `PG_MAJOR=16` y **`PG_VERSION=16.11`** (de `docker image inspect`). El contenedor estaba detenido, así que no se corrió `SELECT version()`; queda para la línea base del tester. Monta el volumen `healthops-gem_solidus_postgres_data`. |
| Volúmenes huérfanos | `backend_postgres_data` y `healthops-gem_healthops_postgres_data`: `docker ps -a --filter volume=…` no devuelve ningún contenedor. |
| Imágenes base | `node:22-alpine` (descargada hace 5 días): Alpine **3.24.3** (minirootfs) y Node 22.23.4. La descarga de imágenes funciona con AVG activo: el daemon de Docker Desktop confía en el almacén de Windows. Lo que falla es la red **dentro** de los builds y contenedores (apk, npm, descargas de Node y de Turbopack). |
| Herramientas | Docker 29.9.2, Buildx 0.38.1 (BuildKit) y Compose v5.6.1, que soportan `RUN --mount=type=secret` y `build.secrets` en compose. Git for Windows 2.56.0, Node 24.13 en el host y Windows PowerShell 5.1 (`pwsh` no está instalado). |
| Git | `core.autocrlf=true` a nivel sistema (`C:/Program Files/Git/etc/gitconfig`). **No existe `.gitattributes`**. No hay `core.hooksPath` local ni hooks propios en `.git/hooks`. Hoy no hay archivos `*.sh` versionados. |
| Dockerfiles | Backend, etapa builder: `npm install --legacy-peer-deps` (el postinstall de Prisma descarga motores), `npx prisma generate` (`binaryTargets` incluye `linux-musl-openssl-3.0.x`) y `npm run build`. Etapa runner: `apk add --no-cache netcat-openbsd openssl`. Frontend, etapa builder: `apk add --no-cache libc6-compat`, `npm install` y `npm run build`, que descarga Google Fonts porque `layout.tsx` usa `next/font/google` (Turbopack, cliente HTTP en Rust). El runner del frontend no hace operaciones de red. |
| `.dockerignore` | El backend excluye `.env` y `.env.*` (salvo el ejemplo). El frontend excluye `.env*`. Ninguno excluye `*.pem` ni `*.crt`. |
| `.gitignore` (raíz) | Cubre `.env`, `.env.*`, `.dev/`, `seed*.sql`, `truncate.sql` y `.claude/settings.local.json`. La **primera línea ignora `docs/auditoria/RIESGOS.md`**: ese archivo es local y no se versiona (ver §10). |
| Backend: listen | `bootstrap.ts:27`: `app.listen(config.get('PORT') ?? 8080, '0.0.0.0')`. `main.ts` carga `dotenv/config`. |
| Backend: login | `LoginQueryHandler` solo lee. `user.findUnique({ where: { email } })` con `userRoles` y `memberships`, y exige `passwordHash` y `bcrypt.compare`. **No exige membresía, rol ni Professional**: sin membresías, `organizationId` y `professionalId` quedan en `null`, `roles` queda en `[]` y responde `type: 'org'` con `token`. No mira `deletedAt` (preexistente, fuera de alcance). `LoginQuery` no tiene validadores, así que el email puede ser cualquier string. |
| Backend: bcrypt | El backend no hashea en ningún lado: solo hace `bcrypt.compare` con `bcrypt@^6`. Los seeds locales usan cost 10: de `seed_test_users.sql` y `generate_seed*.py` se extrajo solo el prefijo del hash, no los valores. |
| Tabla `User` | La migración `init_auth` y la siguiente dejan `id UUID NOT NULL` **sin default en la base** (el `@default(uuid())` lo pone Prisma), `email` único, `passwordHash`, `name`, `createdAt` con default, `updatedAt NOT NULL` **sin default** y `deletedAt` nullable. Observación: `schema.prisma` declara `User.cuit`, pero ninguna migración lo crea. Ver §10, punto 4. |
| `LoggingInterceptor` | Registra en debug el body y la respuesta del login: la contraseña de humo y el token terminan en los logs (R-1, feature 005). |
| Frontend | `"dev": "next dev"` sin `-H`. SSR y rewrites usan `INTERNAL_API_URL` o `http://localhost:8080/api`. |
| `frontend/package-lock.json` | `git diff`: `name` pasa de `solidus-gem-front` a `solidus-frontend` (2 líneas) y se agrega el salto de línea final. Nada más. |
| Restos | `backend/.env.pre-003.bak` existe. `C:\Repositorios\_backup_git\` tiene `002-redact`, `003-pre-tester`, bundles y git-dirs. `.dev/` está vacío. |
| `.claude/settings.json` | Ya figuraba modificado al empezar. Hoy `allow` tiene `Bash(cd /c)`, `Bash(docker info *)`, `Bash(docker image *)`, `Bash(docker run *)`, `Bash(echo "hooksPath rc=$?")`, `Bash(echo "autocrlf rc=$?")`, `Bash(git grep *)` y `Bash(docker buildx *)`. **Al menos los dos `echo … rc=$?` los agregó el harness por comandos de esta sesión**, y probablemente también `docker image *`, `git grep *` y `docker buildx *`. No se tocó el archivo (regla 12). |

## 2. Decisiones por criterio

### 2.1 Criterio 1: CA extra opcional en los builds

**Elegido: secreto de BuildKit (`RUN --mount=type=secret,id=extra_ca`) más un archivo de compose de
override versionado que solo se agrega cuando existe el certificado.**

1. **`docker-compose.extra-ca.yml`** (nuevo, versionado, en la raíz):
   ```yaml
   # Opcional: CA raiz extra para los builds (inspeccion HTTPS de un antivirus o proxy corporativo).
   # .\dev.ps1 -Docker lo agrega solo si existe .dev/certs/extra-ca.pem (ver .\dev.ps1 -ExportCa).
   # A mano: docker compose -f docker-compose.yml -f docker-compose.extra-ca.yml up --build -d
   services:
     backend:
       build:
         secrets: [extra_ca]
     frontend:
       build:
         secrets: [extra_ca]
   secrets:
     extra_ca:
       file: ./.dev/certs/extra-ca.pem
   ```
   `docker-compose.yml` no cambia por este criterio. Sin el override, compose no declara ningún secreto
   y el build es el de hoy. Compose combina `build` por claves, así que el `args` del frontend se conserva.
   El hash con el que compose decide si recrea un contenedor excluye `build`, de modo que alternar con o
   sin override no recrea nada.
2. **Script envoltorio `docker/with-extra-ca.sh`**, una copia idéntica en cada contexto de build
   (`backend/docker/` y `frontend/docker/`, porque son contextos distintos). Se monta con
   `--mount=type=bind` en el `RUN`, así que no se copia a ninguna capa:
   ```sh
   #!/bin/sh
   # Ejecuta un comando del build con una CA raiz extra opcional (secreto BuildKit "extra_ca").
   # Sin el secreto, ejecuta el comando tal cual. Nunca desactiva la verificacion TLS.
   set -eu
   ca=/run/secrets/extra_ca
   if [ -s "$ca" ]; then
     if grep -q 'PRIVATE KEY' "$ca" || ! grep -q 'BEGIN CERTIFICATE' "$ca"; then
       echo 'extra_ca: el archivo no es un certificado PEM publico' >&2
       exit 1
     fi
     bundle=$(mktemp)
     trap 'rm -f "$bundle"' EXIT
     { [ -f /etc/ssl/certs/ca-certificates.crt ] && cat /etc/ssl/certs/ca-certificates.crt; cat "$ca"; } > "$bundle"
     export SSL_CERT_FILE="$bundle" SSL_CA_CERT_FILE="$bundle" NODE_EXTRA_CA_CERTS="$ca" \
            NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1
   fi
   "$@"
   ```
   Qué variable usa cada herramienta:

   | Herramienta | Variable |
   |---|---|
   | `apk` (libfetch con OpenSSL) | `SSL_CA_CERT_FILE` (libfetch) o `SSL_CERT_FILE` (OpenSSL, por la ruta por defecto) |
   | `npm` y las descargas de Prisma (Node) | `NODE_EXTRA_CA_CERTS`, que agrega a la lista de CAs que trae Node |
   | Google Fonts en `next build` (Turbopack, Rust) | `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` más `SSL_CERT_FILE` |

   El bundle combinado (sistema más la CA extra) se crea y se borra dentro del mismo `RUN`, así que no
   entra en la capa. Las variables solo viven en ese proceso.
3. **Dockerfiles:** se envuelven todos los `RUN` con red. No se agrega `# syntax=`: el frontend de
   Dockerfile que trae BuildKit ya soporta `--mount`, y la directiva obligaría a descargar una imagen.
   Ejemplo:
   ```dockerfile
   RUN --mount=type=secret,id=extra_ca \
       --mount=type=bind,source=docker/with-extra-ca.sh,target=/tmp/with-extra-ca.sh \
       sh /tmp/with-extra-ca.sh npm install --legacy-peer-deps
   ```
   - Backend, builder: `npm install --legacy-peer-deps` y `npx prisma generate`. `npm run build` no
     usa la red y queda igual.
   - **Backend, runner: `apk add --no-cache netcat-openbsd openssl` también se envuelve.** El montaje
     no deja nada en esa etapa: la imagen final no recibe el certificado, las variables ni el script.
   - Frontend, builder: `apk add --no-cache libc6-compat`, `npm install` y `npm run build` (fuentes).

   El secreto no se declara con `required`, que por defecto es `false`: sin secreto, el montaje no existe
   y el script no hace nada. Se invoca con `sh` para no depender del bit de ejecución, porque los
   contextos de Windows no lo tienen.
4. **`.gitattributes`** (nuevo): `*.sh text eol=lf` y `.githooks/* text eol=lf`. Con
   `core.autocrlf=true` y sin este archivo, un checkout dejaría CRLF y `sh` fallaría tanto en el
   contenedor como en el hook.
5. **Runtime:** ningún contenedor hace TLS saliente. El backend usa motores de Prisma que ya se
   descargaron en el build, y `npx` resuelve `node_modules/.bin`. El tester lo confirma en los logs.

**Alternativas descartadas:**
- *`COPY` de la CA más `update-ca-certificates`*: la CA queda en las capas, y en el runner del backend
  también en la imagen final. La spec pide evitarlo.
- *Pasar el certificado como build arg*: queda visible en `docker history` y en la caché.
- *Declarar el secreto en `docker-compose.yml` con un archivo vacío por defecto versionado*: cambia el
  compose de todos y obliga a versionar un archivo de relleno. El override es opt-in y el compose base
  queda igual que hoy.
- *Override generado por `dev.ps1`*: un archivo estático versionado se revisa en el PR y sirve también
  a mano.
- *`additional_contexts` para compartir un solo script*: rompe `docker build` sin compose. Se prefiere
  duplicar el script (unas 15 líneas) y un test que verifique que las dos copias son idénticas.
- *Montar el secreto encima de `/etc/ssl/certs/ca-certificates.crt`*: dejaría como única raíz la CA
  extra, y fallaría todo host que el antivirus no intercepte.

**Plan B (solo si el paso 2 de implementación muestra que `apk` ignora las dos variables):** dentro del
mismo `RUN`, agregar la CA al final de `/etc/ssl/certs/ca-certificates.crt` y restaurar el original en el
`trap`. La capa conservaría el archivo con el contenido original, sin la CA. Hay que documentarlo si se
usa.

### 2.2 Criterio 2: obtención del certificado (`-ExportCa`)

- **Flag nuevo `.\dev.ps1 -ExportCa`** (parameter set propio). Requiere Windows (unidad `Cert:`) y
  Docker local (`Test-Prerequisites -Mode Docker`).
- **Selección:**
  1. **Manual:** si `EXTRA_CA_THUMBPRINT` está definida en `.env`, acepta una o varias huellas SHA-1 de 40
     hex separadas por coma o espacio. Se buscan en `Cert:\CurrentUser\Root`, `Cert:\LocalMachine\Root`,
     `Cert:\CurrentUser\CA` y `Cert:\LocalMachine\CA`. Cada certificado debe tener `BasicConstraints`
     con `CertificateAuthority = true`. Si falta alguno: código 1.
  2. **Automática** (sin `EXTRA_CA_THUMBPRINT`):
     - **Hosts:** se toma la constante `$script:CaProbeHosts`, con `registry.npmjs.org`,
       `dl-cdn.alpinelinux.org`, `fonts.googleapis.com` y `binaries.prisma.sh` (los hosts del build).
     - **Conexión:** para cada host, `TcpClient` al 443 con timeout de 10 s y luego
       `SslStream.AuthenticateAsClient(host, $null, Tls12, $false)`, **con la validación normal de Windows**:
       no hay callback que acepte cualquier certificado.
     - **Raíz:** se arma la cadena del certificado del servidor con `X509Chain` (`RevocationMode =
       NoCheck`) y se toma el último elemento.
     - **CAs públicas:** son las que trae la imagen base del build, que es justo lo que el build ya
       confía. Se leen con `docker run --rm --network none --entrypoint cat node:22-alpine
       /etc/ssl/certs/ca-certificates.crt`, salida en memoria. Se parsean los bloques PEM y se calculan
       las huellas.
     - **Resultado:** una raíz que **no** está en ese bundle y **sí** está en un almacén `Root` de
       Windows es la CA interceptora. Se exportan todas las distintas. Si todas las raíces son públicas,
       informa que no hace falta una CA extra y no escribe nada. Si ya existía un archivo, avisa que se
       puede borrar, pero no lo borra.
     - **Errores:** si un host falla, se avisa y se sigue. Si ninguno responde: código 1, con la pista
       de definir `EXTRA_CA_THUMBPRINT`.
- **Por qué este criterio de detección:** "pública" significa exactamente "en la que confía la imagen
  del build". Eso evita mantener una lista de CAs, no depende de AuthRoot de Windows (frágil) ni de Node
  en el host (el modo Docker no lo exige). La constante `node:22-alpine` debe coincidir con el `FROM` de
  los dos Dockerfiles, y lo verifica un test.
- **Formato y ubicación:** PEM con bloques de certificado, líneas de 64 caracteres y LF, armado desde
  `X509Certificate2.RawData` (DER público). **Nunca se usa `Export(Pfx)` ni nada que toque la clave
  privada**, y los certificados `Root` no la tienen. El archivo es `.dev/certs/extra-ca.pem`:
  - git lo ignora por `.dev/`, y se agrega además `*.pem`, `*.crt`, `*.key`, `*.pfx` y `*.p12`;
  - está fuera de los contextos de build, pero se agregan esas extensiones a los dos `.dockerignore`
    como defensa adicional;
  - se escribe con `Write-SecretFile` (§2.11).

  Las cabeceras PEM se arman en el código con `('-' * 5) + 'BEGIN CERTIFICATE' + ('-' * 5)`, para que
  el hook no detecte su propio código.
- **Salida en pantalla:** sujeto y huella de cada certificado exportado (datos públicos), por ejemplo
  "Exportada: CN=AVG Web/Mail Shield Root (huella 2381…9F47)". Una segunda ejecución con el mismo
  resultado no reescribe el archivo y dice "sin cambios".
- **Uso automático:** `-Docker` llama a `Get-ExtraCaComposeArgs`.
  - Si el archivo existe, lo valida con `Test-ExtraCaFile`: tiene que traer al menos un bloque de
    certificado, ningún bloque que no sea un certificado ni `PRIVATE KEY`, y cada bloque tiene que
    parsear como X509. Si no pasa: código 1, antes del build.
  - Si es válido, agrega `-f docker-compose.extra-ca.yml` **solo** a `up --build` y muestra "Usando CA
    extra (.dev/certs/extra-ca.pem, N certificados)".
  - `-Init` valida además `docker compose -f docker-compose.yml -f docker-compose.extra-ca.yml config
    --quiet` cuando el archivo existe.

**Alternativas descartadas:**
- *Solo huella configurable*: la spec pide detectar.
- *Comparar contra los roots que trae Node en el host*: exige Node.
- *Exportar siempre la raíz observada*: no podría decir "no hace falta".
- *Variable del `.env` en lugar de flag*: queda la variable solo para elegir a mano.

### 2.3 Criterio 3: Docker verificado en vivo

No requiere código propio: lo cubren 2.1, 2.2, 2.4 y 2.8. Lo ejecuta el tester (§6, pasos 9 y 10).

### 2.4 Criterio 4: código propio para `docker compose up --build`

- **Código 9:** "docker compose up --build falló (build o arranque de contenedores)". `Invoke-Compose`
  recibe y pasa `-OutputHints` a `Invoke-Native`.
- **Pista de TLS:** se activa con la regex
  `(?i)(x509|certificate|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to get local issuer|TLS: )`.
  - Sin CA exportada: "Error de certificados: un antivirus o proxy intercepta HTTPS. Exportá su CA con
    `.\dev.ps1 -ExportCa` y repetí `.\dev.ps1 -Docker`."
  - Con CA: "La CA de `.dev/certs/extra-ca.pem` no alcanza: volvé a exportarla o indicá la huella con
    `EXTRA_CA_THUMBPRINT`."
- **Pista genérica:** "Revisá la salida del build y `docker compose logs`".
- Se quita la pista vieja de Google Fonts, porque la CA ya cubre ese caso.

### 2.5 Criterio 5: sin `RemoteException` en 5.1

- **Causa:** con `2>&1`, cada línea de stderr llega como `ErrorRecord`. Cuando la línea está vacía,
  `ErrorRecord.ToString()` cae en `Exception.ToString()`, que es el nombre del tipo.
- **Solución:** función pura `ConvertTo-NativeOutputText`. Si el objeto es `ErrorRecord`, devuelve
  `TargetObject` cuando es string; si no, `Exception.Message`, que puede quedar vacío. Cualquier otro
  objeto pasa por `[string]`. La usa `Invoke-Native` en lugar de `[string]$_`.
- **Tests:** se arman `ErrorRecord` con `RemoteException('')`, con texto y con `TargetObject`.

### 2.6 Criterio 6: puerto con que se lanzó el frontend

- `processes.json` agrega `port` en la fila del frontend. `Save-DevProcesses` y `Get-DevProcesses`
  manejan `Port`, que vale 0 si no está, para seguir leyendo los archivos viejos.
- **Función pura `Resolve-RunningFrontendPort -Processes -ConfiguredPort`:** devuelve `{Port; Changed;
  Unknown}`.
- **Rama "ya levantado":** muestra `http://localhost:<puerto lanzado>`.
  - Si `Changed`: "FRONTEND_PORT cambió desde que se lanzó el frontend (en uso: X, en .env: Y). Ejecutá
    `.\dev.ps1 -Stop` y volvé a levantar."
  - Si `Unknown` (archivo viejo): avisa y usa el puerto del `.env`.

### 2.7 Criterio 7

`ConvertTo-FrontendPort` pasa a usar `^[0-9]{1,5}$`. Un test cubre dígitos no ASCII, por ejemplo
`[char]0x0663` repetido.

### 2.8 Criterio 8: modo desarrollo solo en loopback

- **Backend:** se crea `backend/src/infrastructure.bootstrap/config/app/listen-config.ts` con el mismo
  patrón que `jwt-config.ts`:
  ```ts
  export const DEFAULT_LISTEN_HOST = '0.0.0.0';
  export function getListenHost(config: ConfigService): string {
    const host = config.get<string>('LISTEN_HOST');
    return isString(host) && host.trim().length > 0 ? host.trim() : DEFAULT_LISTEN_HOST;
  }
  ```
  `bootstrap.ts` queda `app.listen(config.get('PORT') ?? 8080, getListenHost(config))`. **El default
  `0.0.0.0` mantiene el comportamiento de hoy**: el contenedor sigue escuchando en su red y quien arranque
  el backend sin `dev.ps1` no nota cambios. Se agrega `listen-config.spec.ts`.
- **Nombre `LISTEN_HOST` en vez de `HOST` o `BIND_ADDRESS`:**
  - `HOST` lo exportan algunas shells (tcsh, zsh), y dotenv no pisa el entorno del proceso.
  - `BIND_ADDRESS` ya significa "dónde publica compose en el host". Si alguien la pasara al contenedor
    con `127.0.0.1`, la API quedaría inaccesible dentro de Docker.
- **`docker-compose.yml`:** en el `environment` del backend se agrega `LISTEN_HOST: "0.0.0.0"`, explícito
  y documentado. El modo Docker queda igual.
- **`dev.ps1` y `backend/.env`:** `Sync-BackendEnv` suma `LISTEN_HOST` a las claves derivadas y escribe
  `LISTEN_HOST=<BIND_ADDRESS validada, o 127.0.0.1>`. Una línea local `LISTEN_HOST` se reemplaza; el
  comportamiento queda documentado en la cabecera.
- **Validación de `BIND_ADDRESS` (`ConvertTo-BindAddress`):**
  - vacía o ausente: `127.0.0.1`;
  - IPv4 válida: cuatro octetos de 0 a 255, regex estricta;
  - IPv6 válida: contiene `:`, `[IPAddress]::TryParse` da verdadero y no tiene `%`;
  - cualquier otra cosa: error con código 1, sin mostrar el valor.

  La llama `Test-RootEnv`. Es obligatoria porque el valor termina en el `-EncodedCommand` de la ventana
  y en el compose.
- **Next:** `Get-FrontendDevArgs -Port -BindHost` devuelve `-- -p <puerto> -H '<ip>'`. La IP va entre
  comillas simples y está validada, así que no admite inyección.
- **Dirección para esperas y humo (`Get-ProbeHost -BindAddress`):**

  | `BIND_ADDRESS` | Dirección que se prueba |
  |---|---|
  | `0.0.0.0`, `127.x`, vacía | `127.0.0.1` |
  | `::`, `::1` | `[::1]` |
  | Otra IPv4 | esa IPv4 |
  | Otra IPv6 | `[ip]` |

  `Wait-Http` (backend y frontend, en desarrollo y en Docker) e `Invoke-SmokeTest` (backend, frontend y
  `POST /api/v1/auth/login`) usan `http://<probe>:<puerto>`. Así **no se depende de cómo se resuelva
  `localhost`**: en Windows primero se intenta `::1`, y una conexión rechazada se reintenta durante
  unos 2 s. Las URLs que se muestran al usuario siguen con `localhost`, porque los navegadores prueban
  IPv6 y luego IPv4.
- **SSR y rewrites de Next:** apuntan a `http://localhost:8080`. Node 20 o superior (se exige 22)
  activa `autoSelectFamily` por defecto en `net.connect`, que usan `fetch`/undici y el proxy de rewrites:
  si `::1` falla, cae a `127.0.0.1`. El tester lo verifica (§6, paso 5). **Plan B** si no anda: la
  ventana del frontend define `INTERNAL_API_URL=http://127.0.0.1:8080/api` cuando `frontend/.env.local`
  no la define.

### 2.9 Criterio 9: daemon local por TCP

`Test-DockerEndpointLocal` acepta, además de `npipe://` y `unix://`, la regex
`(?i)^tcp://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?/?$`.

| Caso | Resultado | Tests |
|---|---|---|
| Esos tres hosts, con y sin puerto | Local | Positivos |
| `localhost.ejemplo.com`, `127.0.0.2`, `127.0.0.1.nip.io`, `[::1]x`, `tcp://` vacío, `tcp://user@localhost` | No local | Negativos |

### 2.10 Criterio 10: `-Stop` verifica la línea de comandos (S-5)

- **Generación:** se extrae `New-DevWindowCommand -Title -WorkDir -NpmScript -NpmArgs`, que arma el
  comando actual. La usan `Start-DevWindow` y la verificación.
- **Firma esperada (`Get-DevWindowExpectedPrefix -RootDir -Name`):**
  `$Host.UI.RawUI.WindowTitle = '<título>'; Set-Location -LiteralPath '<RootDir>\<backend|frontend>'; npm.cmd run `.
  Sale de constantes y de `RootDir`, **no del archivo**: forjar `processes.json` no alcanza.
- **Lectura (`Get-ProcessCommandLine -ProcessId`):** usa `Get-CimInstance Win32_Process`, y se puede
  redefinir en los tests.
- **Verificación (`Test-DevWindowCommandLine -CommandLine -ExpectedPrefix`):** extrae el base64 de
  `-EncodedCommand\s+([A-Za-z0-9+/=]+)`, lo decodifica en UTF-16LE y exige que empiece con la firma.
  Si el base64 es inválido, falta la línea o CIM falla, devuelve `$false`: no se mata nada y queda
  como "no vivo".
- **Uso:** `Test-DevProcessAlive` suma este chequeo al nombre y a la hora de inicio. Afecta a `-Stop`, a
  "ya levantado" y al bloqueo de `-Docker` con el modo desarrollo vivo.
- **Complemento:** `.dev/` queda con ACL solo para el dueño (§2.11). Eso cierra el "archivo editable"
  de S-5.

### 2.11 Criterio 11: permisos de archivos con secretos (S-1)

- **`Set-OwnerOnlyAcl -Path`** (archivo) y **`Set-OwnerOnlyDirectoryAcl -Path`** (directorio, con
  herencia `ContainerInherit, ObjectInherit`):
  - se crea un `FileSecurity`/`DirectorySecurity` **nuevo**, con `SetAccessRuleProtection($true, $false)`;
  - se dan tres reglas `FullControl`: el SID del usuario actual
    (`WindowsIdentity.GetCurrent().User`), SYSTEM (`S-1-5-18`) y Administradores (`S-1-5-32-544`).
    Se usan SIDs, no nombres, porque Windows está en español;
  - se aplica con `[IO.File]::SetAccessControl` / `[IO.Directory]::SetAccessControl` en 5.1, o con
    `[IO.FileSystemAclExtensions]::SetAccessControl` en 7.

  Al ser un objeto nuevo, solo se escribe la DACL completa, sin tocar el dueño. Así se evita el error
  conocido de `Set-Acl` al reescribir el owner.
- **Por qué incluir SYSTEM y Administradores:** igual pueden leer cualquier archivo (backup o toma de
  posesión), así que excluirlos no protege nada. Incluirlos evita romper antivirus, backup y consolas
  elevadas.
- **Si falla** (sistema de archivos sin ACL, otra plataforma o `UnauthorizedAccess`): devuelve `$false`
  y `Write-DevWarn "No se pudieron restringir los permisos de <ruta relativa>; se continúa."`. Nunca
  aborta.
- **`Write-SecretFile -Path -Text`** reemplaza a `Write-Utf8NoBom` para `.env`, `backend/.env` y el PEM:
  1. Si el destino existe, se le aplica la ACL antes de escribir.
  2. Se crea el temporal `<archivo>.tmp-<guid>` en la misma carpeta (ignorado por `.env.*`), se le
     aplica la ACL y recién después se escribe el contenido.
  3. Se usa `[IO.File]::Replace(tmp, destino, $null)`, que conserva la DACL ya restringida del destino,
     o `Move` si el destino no existía.
  4. Se vuelve a aplicar la ACL por las dudas.

  Así el secreto nuevo nunca queda en un archivo con permisos heredados, y una caída a mitad de camino
  no deja un `.env` truncado. `Copy-Item` del `.bak` sigue con `Set-OwnerOnlyAcl`.
- **`Protect-LocalSecretFiles -RootDir`**, llamada desde `Initialize-Config` (`-Init`, desarrollo y
  `-Docker`), corrige lo existente:
  - `.env`;
  - `backend/.env`;
  - `backend/.env.pre-003*.bak`;
  - la carpeta `.dev` y `.dev/certs`, como directorios;
  - `.dev/processes.json` y `.dev/certs/extra-ca.pem`.

  Es idempotente.

### 2.12 Criterio 12: Postgres fijado (S-6)

`image: postgres:16.11-alpine`, la misma versión menor que corre hoy, verificada en la imagen. El formato
del directorio de datos es el mismo de la 16, así que no hay migración.
- La primera vez, `up -d db` descarga la etiqueta (el daemon descarga bien con AVG) y **recrea** el
  contenedor `db` sobre el mismo volumen.
- No se fija por digest: congelaría también los parches de Alpine. Con la versión menor alcanza para
  S-6.

### 2.13 Criterios 13 y 14: usuario de humo (`-CreateSmokeUser`)

- **Filas mínimas:** **una sola fila en `User`**. El login no exige membresía, rol ni Professional
  (§1), así que el usuario no tiene acceso a ninguna organización. Hoy un token no da más acceso que no
  tenerlo (los JWT no se verifican, R-5). El criterio 19 queda en **+1 `User` y +0 en las demás tablas**.
- **Identidad:**
  - email `smoke-<8 hex>@solidus.invalid` (dominio reservado, RFC 2606);
  - `name = 'Usuario de humo (dev.ps1)'`;
  - contraseña de 48 caracteres hex (`New-RandomHex -Bytes 24`, menos de 72 bytes, el límite de bcrypt).
- **Flujo de `Invoke-CreateSmokeUser`:**
  1. `Initialize-Config`, `Assert-LocalDockerDaemon` y `Test-Prerequisites -Mode Docker`. Además se
     exigen `node` y `backend/node_modules/bcrypt`; si faltan: código 2, con la pista "ejecutá
     `.\dev.ps1` una vez".
  2. **Valores:**
     - Si `SMOKE_USER` y `SMOKE_PASSWORD` están vacíos, se generan y se escriben **primero en el
       `.env`** con `Set-DotEnvValues` (reemplaza la línea `KEY=` existente, respeta el fin de línea y
       agrega la variable si falta) y `Write-SecretFile`. Escribir antes que la base evita usuarios
       huérfanos: si después algo falla, reintentar reutiliza los mismos valores.
     - Si `SMOKE_USER` tiene valor y **no** cumple `^smoke-[0-9a-f]{8}@solidus\.invalid$`: código 1,
       "SMOKE_USER no es un usuario de humo de dev.ps1; vacialo para generar uno". Así nunca se toca la
       contraseña de un usuario real o de seed.
     - Si solo uno de los dos está vacío, se genera el que falta.
     - Si `SMOKE_PASSWORD` tiene valor, tiene que cumplir `^[A-Za-z0-9._~-]{16,72}$`.
  3. **Base:** si `db` no está corriendo, `compose up -d db` y `Wait-Postgres`, igual que en el modo
     desarrollo.
  4. **Hash bcrypt:** `node -e <script>` con `WorkingDirectory = backend` y la contraseña **por stdin**
     (`Invoke-NativeCapture -InputText`), nunca en argumentos. El script es una constante sin comillas
     dobles, porque 5.1 rompe las comillas dobles en los argumentos nativos (lo verifica un test):
     ```js
     let d='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=d.replace(/[\r\n]+$/,'');if(!/^[A-Za-z0-9._~-]{16,72}$/.test(p)){process.exit(2)}process.stdout.write(require('bcrypt').hashSync(p,10))})
     ```
     - Usa cost **10**, igual que los seeds. `bcrypt.compare` acepta cualquier cost.
     - El salto de línea que agrega el pipe de PowerShell se recorta.
     - La salida se valida con `^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$`; si no cumple: código 3.
  5. **SQL por stdin** con `compose exec -T db psql -U <user> -d <db> -tA -v ON_ERROR_STOP=1`, por el
     socket local. Sin variables de psql ni argumentos con datos: email y hash ya validados por regex
     (sin comillas posibles) se insertan como literales. Lo arma la función pura `New-SmokeUserSql`:
     ```sql
     INSERT INTO "User" ("id","email","passwordHash","name","updatedAt")
     VALUES (gen_random_uuid(), '<email>', '<hash>', 'Usuario de humo (dev.ps1)', CURRENT_TIMESTAMP)
     ON CONFLICT ("email") DO UPDATE
       SET "passwordHash" = EXCLUDED."passwordHash", "updatedAt" = CURRENT_TIMESTAMP, "deletedAt" = NULL
       WHERE "User"."name" = 'Usuario de humo (dev.ps1)'
     RETURNING (xmax = 0) AS inserted;
     ```
     - Salida `t`: "Usuario de humo creado".
     - Salida `f`: "actualizado".
     - **Sin filas**: el email existe y es de otro usuario. Código 1 y no se modificó nada (segunda
       barrera, además de la regex).
     - Error de psql, por ejemplo una tabla inexistente: código 3, "corré `.\dev.ps1` primero
       (migraciones)".
  6. **Salida en pantalla:** "Usuario de humo listo (SMOKE_USER y SMOKE_PASSWORD en .env; no se
     muestran)". Las variables con la contraseña y el hash se anulan en `finally`.
- **Idempotencia:** una segunda ejecución reutiliza los valores del `.env` y actualiza la misma fila. Se
  rehashea con otra sal: el estado es equivalente (mismo usuario, misma contraseña) y no se agregan filas.
- **Criterio 14:** `-Smoke` no cambia salvo la dirección (§2.8). Como la base es la misma para los dos
  modos, el mismo usuario sirve en desarrollo y en Docker.
- **Por qué no se hashea dentro del contenedor backend:** obliga a tener el stack Docker levantado. Es
  una operación de una sola vez, y el modo desarrollo ya exige Node.

### 2.14 Criterio 15: hook `pre-commit`

**Elegido: un `sh` mínimo que delega en PowerShell.**

- **Envoltorio `.githooks/pre-commit`** (LF por `.gitattributes`): `#!/bin/sh`. Busca la raíz con
  `git rev-parse --show-toplevel`, elige `powershell.exe` o, si no está, `pwsh`, y ejecuta
  `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<raiz>/scripts/pre-commit.ps1"`. Si no hay
  PowerShell, rechaza el commit con un mensaje: **falla cerrado**.
  - Git for Windows decide si el hook es ejecutable por el `#!` del archivo.
  - Para clones en Linux o macOS, el desarrollador lo agrega con
    `git update-index --chmod=+x .githooks/pre-commit`.
- **`scripts/pre-commit.ps1`** (entrada): carga `dev-lib.ps1` (para `Read-DotEnv`) y
  `scripts/secret-scan.ps1` (biblioteca nueva sin efectos al cargarse). Antes de llamar a git fija
  `[Console]::OutputEncoding` en UTF-8 sin BOM. Sale con 0 si no hay hallazgos y con 1 si los hay o si
  hay un error interno: también falla cerrado.
- **Qué revisa:**
  - **Lista de staged:** `git -c core.quotepath=off diff --cached --name-status -z --diff-filter=ACMR`.
    Los borrados no se revisan.
  - **Contenido:** `git -c core.quotepath=off diff --cached --no-color --no-ext-diff --unified=0
    --src-prefix=a/ --dst-prefix=b/ --diff-filter=ACMR`. Se analizan **solo las líneas agregadas**
    (`+` salvo `+++`). El número de línea sale de los hunks `@@ … +c,d @@`. Los prefijos explícitos
    evitan depender de `diff.noprefix` y `diff.mnemonicPrefix`.

    Los binarios no se analizan por contenido: los certificados y las claves se bloquean por nombre.
- **Reglas (funciones puras en `secret-scan.ps1`):**
  - **`Test-ForbiddenPath`**, sin distinguir mayúsculas:

    | Archivo | Bloqueado |
    |---|---|
    | Nombre base `.env`, o que empieza con `.env.` y no termina en `.env.example` | Sí (cubre `backend/.env*`) |
    | `*.bak` | Sí |
    | `*.sql` en la raíz (sin `/`) | Sí. Las migraciones de Prisma no se bloquean |
    | `.claude/settings.local.json` | Sí |
    | `*.crt`, `*.pem`, `*.key`, `*.pfx`, `*.p12` | Sí |
    | Cualquier ruta bajo `.dev/` | Sí |

    **Lectura de la spec:** "`backend/.env*`" se toma con la misma excepción `*.env.example`. Si no,
    `backend/.env.example`, que está versionado, no se podría commitear nunca.
  - **`Find-SecretValueHits`**: busca los valores actuales de `POSTGRES_PASSWORD`, `JWT_SECRET` y
    `SMOKE_PASSWORD`, leídos del `.env` de la raíz en memoria.
    - Se omiten los vacíos, `change-me` y los de menos de 8 caracteres, para evitar falsos positivos
      triviales.
    - Búsqueda ordinal y sensible a mayúsculas. También se busca la variante de
      `[Uri]::EscapeDataString` si es distinta.
    - Sin `.env`, se omite esta regla.
  - **`Find-SecretPatternHits`**: patrones genéricos.

    | Patrón | Regex |
    |---|---|
    | Clave privada | `-{5}BEGIN ([A-Z0-9]+ )*PRIVATE KEY-{5}` |
    | Certificado PEM | `-{5}BEGIN CERTIFICATE-{5}` (evita que la CA de AVG termine en un doc) |
    | JWT | `\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` |
    | Clave AWS | `\b(AKIA\|ASIA)[0-9A-Z]{16}\b` |
    | URL con credenciales | `[a-z][a-z0-9+.\-]*://([^\s/:@'"]+):([^\s/@'"]+)@` |
    | IP privada | `\b192\.168\.\d{1,3}\.\d{1,3}\b` |

    En las URLs con credenciales se descarta la coincidencia si la contraseña es un placeholder:
    - empieza con `<`, `$` o `{`;
    - o es `change-me`, `changeme`, `password`, `pass`, `secret`, `xxx…`, `***…`, `...`, `contraseña`,
      `clave` o `pwd`, sin distinguir mayúsculas.
  - **`Test-ClaudeSettingsJson -Text`**: si `.claude/settings.json` está staged, se lee el blob staged
    (`git show :.claude/settings.json`) y se interpreta con `ConvertFrom-Json`. Es hallazgo si
    `permissions.allow` no está vacío, si existe `permissions.defaultMode` o `defaultMode` en la raíz,
    o si el JSON es inválido (falla cerrado).
- **Mensaje:** nunca muestra valores ni la línea, solo el archivo, la línea si se conoce y el tipo.
  Muestra hasta 50 hallazgos:
  ```
  pre-commit: commit rechazado (no se muestran valores).
    .env: archivo prohibido (.env local)
    docs/x.md:12: valor de JWT_SECRET del .env local
    scripts/y.ps1:40: posible JWT
  Sacalo del stage (git restore --staged <archivo>) o corregilo y volve a intentar.
  Solo si es un falso positivo SIN secretos: git commit --no-verify. Nunca lo uses con secretos.
  ```
- **Activación (`Enable-RepoHooks -RootDir`, desde `Initialize-Config`):**
  - si `RootDir` no es un work tree de git (`git rev-parse --is-inside-work-tree`), informa y sigue;
  - si `core.hooksPath` local está vacío, lo fija en `.githooks` (`git config --local`);
  - si ya vale `.githooks`, no hace nada;
  - si tiene **otro valor**, avisa y **no lo pisa**.
- **Autoexclusión:**
  - Las regex del código no coinciden consigo mismas (por ejemplo, `-{5}` en lugar de guiones literales).
  - **Los tests arman los valores de prueba en tiempo de ejecución**, concatenando, por ejemplo,
    `'AKIA' + 'FICTICIA…'`, `'192.' + '168.0.1'` o `'ey' + 'J…'`. Ningún archivo del repo contiene un
    literal que coincida.
  - El primer commit del feature con el hook activo funciona como prueba integral sobre el repo real.

**Alternativas descartadas:**
- *Hook en `sh` puro*: duplica el parser de dotenv (comillas, comentarios, BOM) y necesitaría otro
  framework de tests (bats no está instalado). Además, leer valores con herramientas de línea de comandos
  arriesga que queden en argumentos o en archivos temporales.
- *Hook en Node*: el frontend y el backend tienen `node_modules` separados y no hay un `package.json` en
  la raíz. Agregarlo sería una dependencia nueva sin justificación.
- *Revisar el contenido completo de los archivos staged*: da falsos positivos sobre líneas que ya están
  en el repo y es más lento. Lo nuevo es lo único que entra con el commit.

### 2.15 Criterio 16

No requiere código. El diff es solo `name` (dos líneas) y el salto de línea final (§1). El PO lo incluye
en el commit.

### 2.16 Criterio 17: rotación de la contraseña de Postgres (`-RotateDbPassword`)

**Hecho clave:** en la imagen oficial, `pg_hba.conf` tiene `trust` para el socket local y para
`127.0.0.1` dentro del contenedor. Al final agrega `host all all all scram-sha-256`, que aplica a las
conexiones desde el host o desde la red de compose. Por eso:
- `ALTER ROLE` por socket local **no necesita la contraseña vieja**;
- **la recuperación ante un corte siempre es volver a ejecutar la rotación**: genera otra contraseña y
  la aplica a la base y a los archivos;
- para verificar la contraseña nueva **no sirve** conectarse a `127.0.0.1` dentro del contenedor (es
  `trust`): hay que entrar por la IP de la red de compose.

**Flujo de `Invoke-RotateDbPassword -RootDir -AssumeYes`:**
1. **Chequeos previos:**
   - `Initialize-Config` y `Assert-LocalDockerDaemon`;
   - si hay ventanas del modo desarrollo vivas: código 2, "detené con `.\dev.ps1 -Stop`";
   - `POSTGRES_USER` y `POSTGRES_DB` tienen que cumplir `^[A-Za-z0-9_][A-Za-z0-9_.-]*$` (código 1 si
     no), porque se pasan como argumentos sin comillas;
   - el `.env` tiene que poder escribirse.
2. **Confirmación:**
   - con consola interactiva, "Escribí ROTAR"; cualquier otra respuesta cancela con código 0 y "No se
     cambió nada";
   - sin consola, se exige **`-Yes`**; si falta, cancela con código 0 y el mismo mensaje. Así el tester
     puede ejecutarlo de forma no interactiva y explícita.
3. **Base:** si `db` no corre, `up -d db` y `Wait-Postgres`.
4. Se genera la contraseña nueva: 48 hex (`New-RandomHex -Bytes 24`).
5. **`ALTER ROLE` por stdin** (`compose exec -T db psql -U <user> -d <db> -q -v ON_ERROR_STOP=1`), con
   SQL armado por la función pura `New-RotatePasswordSql`:
   `SELECT format('ALTER ROLE %I WITH PASSWORD %L', current_user, '<hex>') \gexec`.
   No hay comillas propias: `%I` y `%L` las ponen. Si falla: **código 3**, "no se cambió nada".
6. **Inmediatamente**, `Set-DotEnvValues` y `Write-SecretFile` escriben `POSTGRES_PASSWORD` en `.env`.
   Si falla: **código 10**, "la base ya tiene una contraseña nueva que no se pudo guardar. Volvé a
   ejecutar `.\dev.ps1 -RotateDbPassword`: por el socket local no se necesita la anterior".
7. `Sync-BackendEnv` regenera `backend/.env`. Si falla: código 10, "corré `.\dev.ps1 -Init`".
8. **Verificación por TCP con scram:** `compose exec -T db sh -c '<script>' sh <user> <db>`, con la
   contraseña por stdin. Script:
   `PGPASSWORD=$(tr -d '\r\n') psql -h db -U $1 -d $2 -tA -c 'select 1'`.
   - `-h db` resuelve a la IP del contenedor en la red de compose, que no es `127.0.0.1`, y cae en la
     regla scram.
   - El `tr` quita el CRLF que agrega el pipe de PowerShell.
   - El script no lleva comillas dobles, por el bug de 5.1.

   Si falla: código 3, "la contraseña se guardó en .env pero la base no la acepta por TCP. Revisá
   `docker compose logs db` y volvé a rotar".
9. **Si el contenedor `backend` de compose está corriendo:** `compose up -d --no-deps --no-build
   backend`. Lo recrea porque cambió `DATABASE_URL`. `--no-deps` evita recrear `db` en medio de la
   operación.
10. **Mensaje final:** "Contraseña rotada (no se muestra)".
    - El contenedor `db` se recrea en el próximo `up` porque cambió su `POSTGRES_PASSWORD`. Es inocuo:
      esa variable solo se usa al inicializar un volumen vacío, y el volumen se conserva.
    - Se actualizan la pista de contraseña corta de `Test-RootEnv` y la pista `P1000` de `migrate
      deploy`, que hoy menciona el `.bak` que se va a borrar. Las dos pasan a recomendar
      `.\dev.ps1 -RotateDbPassword`.

**Postgres no registra la contraseña:** por defecto `log_statement = none` (el tester lo verifica). Si el
`ALTER` fallara, la sentencia podría aparecer en el log por `log_min_error_statement`, pero esa contraseña
nunca se aplicó.

**Alternativas descartadas:**
- *`\password` interactivo* (lo que el 003 recomendaba a mano): no es reproducible ni automatizable.
- *Escribir primero el `.env`*: es equivalente gracias a `trust`, pero dejar como fuente de verdad lo que
  la base ya aceptó es más claro.
- *Archivo de recuperación con la contraseña nueva*: es innecesario por `trust`, y sería otro archivo
  con un secreto.

### 2.17 Criterios 18 y 19: limpieza y datos intactos

Son operaciones manuales del tester, con verificación previa (§6). `dev.ps1` no borra volúmenes, `.bak`
ni carpetas. `Write-OrphanVolumeNotice` se mantiene: deja de avisar sola cuando el volumen ya no existe.
Datos: el criterio 19 espera **+1 `User`** y +1 en el total de `public`. La rotación no toca tablas de
`public`, porque `pg_authid` es de catálogo.

### 2.18 Códigos de salida (tabla nueva)

| Código | Significado |
|---|---|
| 0 | OK, incluso si se cancela un seed o una rotación, o si se saltea el login de humo |
| 1 | Configuración inválida: `.env`, `BIND_ADDRESS`, `FRONTEND_PORT`, `SMOKE_USER` ajeno, CA inválida o no encontrada, ningún host para detectar la CA. También errores inesperados |
| 2 | Prerrequisito o puerto: Docker, Node, `backend/node_modules` para el hash, modo desarrollo vivo al rotar o con `-Docker` |
| 3 | Base de datos: Postgres no responde, `migrate`/`generate`, SQL del usuario de humo, `ALTER ROLE` sin cambios aplicados, verificación por TCP |
| 4 | `npm install` |
| 5 | Backend o frontend no respondieron |
| 6 | Seed |
| 7 | Prueba de humo |
| 8 | Daemon de Docker no local |
| **9** | **`docker compose up --build` falló (build o arranque de contenedores)** |
| **10** | **Rotación incompleta: la base tiene una contraseña que no quedó guardada. Volver a rotar** |

### 2.19 Parámetros de `dev.ps1`

Sets nuevos:
- `ExportCa` (`-ExportCa`);
- `SmokeUser` (`-CreateSmokeUser`);
- `Rotate` (`-RotateDbPassword`, más `-Yes`, que solo vale en este set).

Hay que actualizar la ayuda: sinopsis de cada flag, tabla de códigos, `LISTEN_HOST`/`BIND_ADDRESS` en
desarrollo y el hook en `-Init`.

## 3. Archivos

### Crear
| Archivo | Contenido |
|---|---|
| `docker-compose.extra-ca.yml` | Override con `build.secrets` (§2.1) |
| `backend/docker/with-extra-ca.sh`, `frontend/docker/with-extra-ca.sh` | Envoltorio idéntico (§2.1), con LF |
| `.gitattributes` | `*.sh text eol=lf` y `.githooks/* text eol=lf` |
| `.githooks/pre-commit` | Envoltorio `sh` (§2.14), con LF |
| `scripts/pre-commit.ps1` | Entrada del hook, UTF-8 con BOM |
| `scripts/secret-scan.ps1` | Reglas puras del hook, UTF-8 con BOM, sin efectos al cargarse |
| `backend/src/infrastructure.bootstrap/config/app/listen-config.ts` y `listen-config.spec.ts` | `getListenHost` y sus tests |

### Modificar
| Archivo | Cambio |
|---|---|
| `backend/Dockerfile`, `frontend/Dockerfile` | `RUN` con red envueltos (§2.1) |
| `backend/.dockerignore`, `frontend/.dockerignore` | `*.pem`, `*.crt`, `*.key`, `*.pfx`, `*.p12` |
| `.gitignore` | Sección "Certificados y claves locales" con las mismas extensiones (`.dev/` ya está) |
| `docker-compose.yml` | `image: postgres:16.11-alpine`; `LISTEN_HOST: "0.0.0.0"` en el backend |
| `backend/src/infrastructure.bootstrap/bootstrap.ts` | `getListenHost(config)` |
| `.env.example` | Comentarios de `BIND_ADDRESS`, que ahora también afecta al modo desarrollo; `# EXTRA_CA_THUMBPRINT=` comentada con explicación; `SMOKE_*` con la mención de `-CreateSmokeUser` |
| `backend/.env.example` | `# LISTEN_HOST=127.0.0.1` comentada (lo genera `dev.ps1`) |
| `scripts/dev-lib.ps1` | Ver §2: CA, códigos y pistas, `ConvertTo-NativeOutputText`, puerto lanzado, `[0-9]`, `ConvertTo-BindAddress`, `Get-ProbeHost`, `Get-FrontendDevArgs -BindHost`, `Sync-BackendEnv` con `LISTEN_HOST`, tcp local, línea de comandos, ACL, `Write-SecretFile`, `Protect-LocalSecretFiles`, `Set-DotEnvValues`, usuario de humo, rotación, `Enable-RepoHooks` |
| `dev.ps1` | Sets y ayuda (§2.19), `Initialize-Config` (hooks y ACL), `-Docker` con override y código 9, rama "ya levantado", `Show-Urls` |
| `scripts/dev-lib.tests.ps1` | Tests nuevos (§5) y carga de `secret-scan.ps1` |
| `frontend/package-lock.json` | Ya modificado; solo se commitea |

**Documentación (criterio 21, lo hace el documentador):**
- `.claude/CLAUDE.md` y `docs/auditoria/COMANDOS.md`: CA extra y `-ExportCa`, usuario de humo, rotación,
  hook (activación, qué bloquea, `--no-verify`), código 9 y 10, loopback en desarrollo y `LISTEN_HOST`.
- `docs/auditoria/RIESGOS.md`: S-1, S-5 y S-6 resueltos. **Es un archivo local e ignorado (§10).**

**Sin cambios:** `schema.prisma` y las migraciones (no hay cambios de schema), el código del frontend,
`login-query-handler.ts` y los seeds.

## 4. Datos y contratos

- **Base:** no hay cambios de schema. Solo una fila de datos en `User`, el usuario de humo.
- **Backend:** la variable de entorno opcional `LISTEN_HOST` vale `0.0.0.0` por defecto. No cambia
  ningún endpoint.
- **`.env` (raíz):**
  - `SMOKE_USER` y `SMOKE_PASSWORD` pasan a llenarse con `-CreateSmokeUser`;
  - se agrega `EXTRA_CA_THUMBPRINT`, opcional y no se agrega sola;
  - `BIND_ADDRESS` ahora también rige el modo desarrollo y se valida como IP.
- **`backend/.env` (generado):** suma la clave derivada `LISTEN_HOST`.
- **`.dev/processes.json`:** `{name, pid, startTime, port?}`. Sigue siendo compatible hacia atrás.
- **`.dev/certs/extra-ca.pem`:** archivo nuevo, local e ignorado.
- **Git local:** `core.hooksPath=.githooks`.

## 5. Estrategia de tests

Runner propio, sin Pester, en `scripts/dev-lib.tests.ps1`, con Windows PowerShell 5.1. Todo corre en
`%TEMP%` con valores **ficticios armados en tiempo de ejecución**. No toca el `.env` real, el Docker real
ni la red, salvo el test de integración del hook, que usa un repo git temporal.

| Área | Casos |
|---|---|
| CA | Las dos copias de `with-extra-ca.sh` son idénticas y sin `\r`. La constante de imagen coincide con el `FROM` de ambos Dockerfiles. `ConvertFrom-PemBundle` cubre 0, 1 y N bloques, CRLF/LF y basura entre bloques. `ConvertTo-PemCertificate` sobre un certificado autofirmado **creado en memoria** con `CertificateRequest` de .NET 4.8 (sin tocar el almacén): ida y vuelta, líneas ≤ 64 y sin `PRIVATE`, aunque el objeto tenga clave privada. `Select-ExtraCaCandidates` (raíces contra huellas públicas): ninguna, una, duplicados. `Test-ExtraCaFile`: válido, vacío, con bloque de clave privada (armado en ejecución), con un bloque que no parsea. `Get-ExtraCaComposeArgs` con y sin archivo. Parseo de `EXTRA_CA_THUMBPRINT`: coma, espacio, inválida |
| Código 9 y pistas | La regex de TLS sobre salidas de muestra de apk, npm y Next; el texto de la pista con y sin CA |
| `ConvertTo-NativeOutputText` | `ErrorRecord` vacío da `''`, con texto, con `TargetObject`, string y `$null` |
| Puerto lanzado | `Resolve-RunningFrontendPort`: igual, distinto, sin `port`. Ida y vuelta de `Save-` y `Get-DevProcesses` con `port` |
| `[0-9]` | Dígitos no ASCII rechazados |
| Bind | `ConvertTo-BindAddress`: vacía, `127.0.0.1`, `0.0.0.0`, `::1`, `::`, inválidas (`127.1`, `localhost`, `1.2.3.256`, `fe80::1%3`, `'; calc'`), sin mostrar el valor. `Get-ProbeHost`, la tabla de §2.8. `Get-FrontendDevArgs -BindHost`. `Sync-BackendEnv` escribe `LISTEN_HOST` según `BIND_ADDRESS` y reemplaza la línea local |
| Daemon tcp | Positivos y negativos de §2.9 |
| `-Stop` | `Test-DevWindowCommandLine`: comando real armado con `New-DevWindowCommand` (acepta), otro título, otra carpeta, sin `-EncodedCommand`, base64 inválido, `$null`. `Test-DevProcessAlive` con `Get-ProcessCommandLine` redefinida |
| ACL | `Set-OwnerOnlyAcl` y `Set-OwnerOnlyDirectoryAcl` sobre archivos temporales: `AreAccessRulesProtected` y solo los 3 SIDs. Un archivo creado dentro del directorio hereda. Una falla simulada (función de aplicación redefinida para lanzar) avisa y no aborta. `Write-SecretFile`: crea, reemplaza, deja la ACL y no deja `.tmp-*` |
| `.env` | `Set-DotEnvValues`: reemplaza solo la clave, conserva el resto byte a byte y el CRLF, agrega si falta, no imprime |
| Usuario de humo | Validaciones de email y contraseña. `New-SmokeUserSql` con el literal esperado y rechazo de entradas que no cumplen la regex. El script de Node no tiene `"`. El flujo completo con `Invoke-NativeCapture` e `Invoke-ComposeCapture` redefinidas: genera y guarda primero, `t`/`f`/vacío dan 0/0/1, `SMOKE_USER` ajeno da 1 sin llamar a docker, y la contraseña no aparece en la salida capturada con `*>&1` |
| Rotación | `New-RotatePasswordSql`. Flujo con stubs: cancelación sin `-Yes` (0, nada escrito), ventanas vivas (2), falla del `ALTER` (3, `.env` intacto), falla al escribir el `.env` (10), verificación TCP fallida (3, `.env` ya actualizado), éxito (`.env` con 48 hex, `backend/.env` regenerado, `up --no-deps --no-build backend` solo si corre). La contraseña nunca aparece en la salida |
| Hook, unidad | `Test-ForbiddenPath` (`.env`, `x/.env.local`, `backend/.env.pre-003.bak`, `seed.sql`, `backend/prisma/migrations/x/migration.sql` permitido, `.env.example` y `backend/.env.example` permitidos, `.pem` y otros, `.dev/x`). `Find-SecretValueHits` (valor presente y escapado, corto o placeholder ignorado). `Find-SecretPatternHits`, uno positivo y uno negativo por patrón, incluidas las URLs placeholder de `docker-compose.yml` y `.env.example` reales. Parser del diff (archivo, número de línea, `+++` ignorado). `Test-ClaudeSettingsJson`: el JSON de HEAD (permitido), con `allow`, con `defaultMode`, inválido |
| Hook, integración | Se omite con aviso si no hay `git`. Repo temporal con `git init`, copia de `.githooks/` y de los tres `.ps1`, `.env` ficticio y `git config core.hooksPath .githooks`. Casos: commit limpio (0); `.env` staged (≠0, el mensaje nombra el archivo); archivo con el valor ficticio de `JWT_SECRET` (≠0, el valor no aparece en la salida); `.env.example` (0); `--no-verify` (0). Se usan `-c user.name=… -c user.email=test@example.invalid -c commit.gpgsign=false` |
| Activación | `Enable-RepoHooks` con `git` redefinido: vacío lo fija, `.githooks` no hace nada, otro valor avisa y no lo pisa, fuera de un repo informa y sigue |

**Backend:** `listen-config.spec.ts` cubre `undefined`, `''` y `'  '` (dan `0.0.0.0`), `'127.0.0.1'` y
`' ::1 '` (con trim). `npm test` corre `jwt-config` y `listen-config`.

**Calidad del criterio 20:**
- tests en verde;
- parser de PowerShell y BOM en los `.ps1`;
- sin las construcciones prohibidas del 003 (`??`, `?.`, `-AsHashtable`, `::Fill(`, `&&`, `||`);
- `npx tsc --noEmit` en backend y frontend;
- `npx eslint` sobre los tres `.ts` tocados o creados;
- `npm test` del backend;
- `docker compose config --quiet`, y con el override si existe la CA.

## 6. Plan de pruebas del tester (orden de operaciones reales)

Salvaguardas de `00-estado.md`:
- sin seeds;
- SQL de escritura solo el de la rotación y el del usuario de humo;
- sin borrar otros volúmenes;
- sin stash, reset ni checkout;
- sin matar procesos ajenos;
- sin imprimir `.env`.

El 3000 de pm2 no se toca: `FRONTEND_PORT=3002`. Todo se ejecuta con
`powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 …`.

0. **Estado inicial:**
   - `docker ps -a`, `docker volume ls` (lista completa) y `git status`;
   - hashes de los `package-lock`;
   - la lista de variables de `.env` (solo nombres);
   - el largo de `POSTGRES_PASSWORD` (sin el valor);
   - `.dev` vacío.

   Se cargan **en memoria**, o en un archivo del scratchpad que se borra al final, los valores para el
   barrido: los actuales de `.env`, la contraseña vieja y los valores de
   `_backup_git\002-redact\valores.txt` y del `.bak`. **Hay que hacerlo antes de borrar nada.**
1. **Calidad estática:** todo lo de §5 ("Calidad del criterio 20"). Esperado: 0 fallos.
2. **Línea base de datos:**
   - `docker compose start db`;
   - `SELECT version()`: se espera 16.11;
   - conteos de User, Organization, Patient, WorkItem y total de `public` sin `_prisma_migrations` (la
     consulta de `Get-DatabaseRowCount`): se espera 8/3/72/324/1482;
   - `SHOW log_statement`: se espera `none`;
   - existencia de la columna `User.cuit` en `information_schema.columns` (§10, punto 4).

   Todo es de solo lectura.
3. **`-Init`:**
   - código 0;
   - `git config --local core.hooksPath` vale `.githooks`;
   - `Get-Acl` de `.env`, `backend/.env`, `backend/.env.pre-003.bak` y `.dev`: herencia cortada y solo
     el usuario, SYSTEM y Administradores;
   - `backend/.env` trae la clave `LISTEN_HOST` (solo el nombre);
   - el prefijo de `.env` queda igual.
4. **`-Docker` sin CA (negativo):** todavía no hay `.dev/certs/extra-ca.pem`.
   - Se espera **código 9**, con la pista que menciona `-ExportCa`, y ninguna línea `RemoteException`.
   - Confirma que el compose sin CA es el de hoy.
   - Antes del build, la imagen `postgres:16.11-alpine` se descarga y `db` se recrea: se verifica
     `docker inspect healthops-gem-db-1 --format '{{.Config.Image}}'`.
   - Después: `-Stop`.
5. **Modo desarrollo:** `.\dev.ps1` debe dar código 0.
   - **Interfaces:** `Get-NetTCPConnection -State Listen -LocalPort 8080,3002` debe mostrar
     `LocalAddress` igual a `127.0.0.1`, no `0.0.0.0` ni `::`. El proceso de Next tiene que tener
     `-H 127.0.0.1` en su línea de comandos. `processes.json` tiene que tener `port: 3002`.
   - **IPv6 y SSR:**
     - `http://localhost:3002/login` y `http://127.0.0.1:3002/login` dan 200;
     - `POST http://127.0.0.1:3002/api/v1/auth/login` con credenciales ficticias da 401 (rewrite por
       `localhost`, prueba de `autoSelectFamily`);
     - el log de Next no tiene `ECONNREFUSED ::1` ni "Blocked cross-origin".
   - **Segunda ejecución:** "ya levantado" con la URL en 3002.
   - **Cambio de puerto:** se cambia temporalmente `FRONTEND_PORT=3003` y se ejecuta otra vez. Tiene que
     aparecer el aviso de `-Stop` y la URL con 3002. Después se restaura el valor y se verifica el hash
     del `.env`.
6. **Usuario de humo:**
   - `-CreateSmokeUser`: código 0. La salida no tiene valores. `SMOKE_USER` y `SMOKE_PASSWORD` no están
     vacíos (solo largos y la forma del email). User = 9. El usuario tiene 0 filas en
     `OrganizationMember`, `UserRole` y `Professional`.
   - Segunda ejecución: código 0 y User sigue en 9.
   - `-Smoke`: Backend OK, Frontend OK (3002) y **Login OK**.
   - No hay que capturar la consola del backend (R-1).
7. **`-Stop` y S-5:**
   1. El tester lanza **su propio** `powershell -NoProfile -NoExit -Command Start-Sleep 600`.
   2. Agrega su PID y su `StartTime` a `processes.json`, con el nombre `frontend`.
   3. Ejecuta `-Stop`. Se espera: "Procesos detenidos: 2", que son las ventanas reales, y que el proceso
      del tester **siga vivo**. Luego lo cierra el propio tester.

   Datos: 9/3/72/324/1483.
8. **`-ExportCa`:**
   - código 0;
   - exporta `CN=AVG Web/Mail Shield Root` con la huella `<huella SHA-1 de la CA local>`;
   - el archivo solo tiene bloques de certificado;
   - `git check-ignore -v .dev/certs/extra-ca.pem` lo da por ignorado;
   - ACL restringida;
   - una segunda ejecución dice "sin cambios" y el hash es el mismo;
   - `docker compose -f docker-compose.yml -f docker-compose.extra-ca.yml config --quiet` da 0.
9. **Docker en vivo (criterio 3):**
   - `.\dev.ps1 -Docker`: código 0.
   - `docker ps`: `127.0.0.1:8080->8080` y `127.0.0.1:3001->3000`.
   - `-Smoke`: backend OK, frontend en 3001 OK y **Login OK**.
   - **La CA no está en las imágenes:**
     - `docker image inspect healthops-gem-backend` (y `-frontend`): `Config.Env` no tiene
       `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS` ni la variable de Turbopack;
     - `docker history --no-trunc` no muestra el certificado;
     - `docker run --rm --entrypoint sh <imagen> -c 'ls -A /run/secrets /tmp; sha256sum /etc/ssl/certs/ca-certificates.crt'`:
       las carpetas están vacías o no existen, y el hash coincide con el de `node:22-alpine`.
   - `docker compose logs backend` no tiene errores de descarga ni de TLS. No se guarda el log, porque
     tiene la contraseña de humo (R-1).
   - Datos sin cambios.
10. **Rotación (con el stack Docker levantado):**
    - `-RotateDbPassword -Yes`: código 0. `POSTGRES_PASSWORD` tiene 48 hex (solo largo y forma). El
      resto del `.env` no cambia: se compara el hash sin esa línea. `backend/.env` se regenera. El
      contenedor backend se recrea.
    - `docker compose logs db` no contiene la contraseña nueva (conteo en memoria).
    - `-Smoke` en Docker: Login OK.
    - `-Stop`. Modo desarrollo: código 0, `migrate deploy` OK y ya no aparece el aviso de contraseña
      corta. `-Smoke`: Login OK. `-Stop`.
    - `-Docker` (recrea `db` por el cambio de entorno): código 0. `-Smoke`: Login OK. `-Stop`.
    - Opcional: la contraseña vieja ya no conecta por TCP.
11. **Conteos finales:** 9/3/72/324/1483. Las únicas diferencias son +1 User y +1 en el total.
12. **Limpieza autorizada (criterio 18), en este orden:**
    1. Borrar `backend/.env.pre-003*.bak`.
    2. Para cada uno de los dos volúmenes huérfanos, `docker ps -a --filter volume=<v>` tiene que salir
       vacío. Recién ahí, `docker volume rm backend_postgres_data healthops-gem_healthops_postgres_data`.
    3. `docker volume ls` tiene que dar la lista del paso 0 menos esos dos.
       `healthops-gem_solidus_postgres_data` sigue presente, y los conteos se repiten.
13. **Barrido final** con los valores del paso 0 más los nuevos (contraseña rotada, `SMOKE_PASSWORD` y
    `JWT_SECRET`). Se revisa:
    - `git diff HEAD`;
    - los archivos sin seguimiento no ignorados;
    - todo `docs/features/004-*`;
    - las salidas capturadas.

    Se espera 0. Además, se corre `scripts/pre-commit.ps1` en un repo temporal con una copia del diff, o
    se deja al commit del PO.
14. **Borrar `C:\Repositorios\_backup_git\`**, último paso, después del barrido. El PO puede pedir
    postergarlo hasta después del push. Se borra también el archivo de valores del scratchpad.
15. **Cierre:**
    - `-Stop`;
    - `git status` muestra solo lo esperado (§3, más `.claude/settings.json` del harness);
    - el 3000 de coach-claudio está intacto.

## 7. Plan de implementación (pasos chicos)

1. **Archivos base:** `.gitattributes`, los dos `with-extra-ca.sh` (LF), los Dockerfiles,
   `docker-compose.extra-ca.yml`, los `.dockerignore` y `.gitignore`. Verificación: `docker compose
   config --quiet`, y `docker compose build` sin override falla igual que hoy (TLS en `apk`).
2. **CA:** funciones PEM y CA, `-ExportCa` y sus tests. Con autorización del PO (no toca datos), se
   verifica `docker compose -f … -f docker-compose.extra-ca.yml build`. **Si `apk` falla, se activa el
   plan B de §2.1.** Si falla Turbopack, se informa al PO antes de seguir.
3. `ConvertTo-NativeOutputText`, código 9 con pistas y `-OutputHints` en `Invoke-Compose`. Tests.
4. Criterios 7 y 9. Tests.
5. Criterio 8: `listen-config.ts` con su spec, `bootstrap.ts`, `LISTEN_HOST` en compose,
   `ConvertTo-BindAddress`, `Get-ProbeHost`, `Sync-BackendEnv` y `Get-FrontendDevArgs`. Las esperas y
   el humo pasan a usar la dirección de prueba. Tests, `tsc`, eslint y `npm test`.
6. Criterios 6 y 10: `port` en `processes.json`, `New-DevWindowCommand` y la verificación de la línea de
   comandos. Tests.
7. Criterio 11: ACL, `Write-SecretFile` y `Protect-LocalSecretFiles`. Los escritores existentes migran a
   `Write-SecretFile`. Tests, y los 240 previos tienen que seguir pasando.
8. Criterio 12: imagen de Postgres.
9. `Set-DotEnvValues` y `-CreateSmokeUser`. Tests.
10. `-RotateDbPassword`. Tests.
11. Hook: `secret-scan.ps1`, `pre-commit.ps1`, `.githooks/pre-commit` y `Enable-RepoHooks`. Tests de
    unidad y de integración.
12. `dev.ps1`: sets, ayuda, tabla de códigos y `.env.example`.
13. **Calidad completa (§5).** No se ejecuta `dev.ps1` en modo real contra los `.env` del usuario:
    eso lo hace el tester, igual que en el 003.

## 8. Impacto

- **Rendimiento:**
  - CIM agrega unos 100 a 300 ms por proceso registrado en `-Stop`, "ya levantado" y `-Docker`;
  - las ACL tardan milisegundos;
  - el hook agrega entre 1 y 2 s por commit (arranque de PowerShell y `git diff`);
  - `-ExportCa` tarda unos segundos (4 conexiones TLS y un `docker run --network none`);
  - el build no cambia, salvo un `cat` por cada `RUN` con CA.
- **Compatibilidad:**
  - **Sin CA**, los builds son los de hoy, pero ahora requieren BuildKit por `RUN --mount`. Compose v2
    siempre lo usa, y `docker build` también desde Docker 23. El builder clásico
    (`DOCKER_BUILDKIT=0`) deja de funcionar.
  - **Backend sin `LISTEN_HOST`:** sigue en `0.0.0.0`.
  - **`processes.json` viejos:** se siguen leyendo.
  - **Quien usaba el modo desarrollo desde la LAN:** ahora necesita `BIND_ADDRESS=0.0.0.0`, que ya era
    el opt-in documentado para Docker.
  - **PowerShell 7:** solo se verifica de forma estática (`FileSystemAclExtensions`).
  - **Linux y macOS:** el hook necesita `pwsh`; las ACL se omiten con aviso.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| `apk` (apk-tools 3 en Alpine 3.24) ignora `SSL_CERT_FILE` y `SSL_CA_CERT_FILE` | Se verifica en el paso 2. Plan B en §2.1 (agregar y restaurar en el mismo `RUN`, sin la CA en la capa) |
| Turbopack ignora `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS` o `SSL_CERT_FILE` (la variable es experimental) | Se verifica en el paso 2. Si falla, se informa al PO: las opciones son `next build --webpack` dentro de Docker (usa `NODE_EXTRA_CA_CERTS`) o `next/font/local`. Ambas cambian el build del frontend y requieren una decisión |
| La CA de AVG se cuela en el repo o en una imagen | `.dev/` y `*.pem` ignorados. El hook bloquea por nombre y por contenido PEM. Secreto de BuildKit sin capas, verificado en el paso 9. Las imágenes no se publican |
| `localhost` resuelve a `::1` con el bind en `127.0.0.1` | Las esperas y el humo usan `127.0.0.1`. El SSR depende de `autoSelectFamily` (Node 22 o superior). Se verifica en el paso 5, y hay plan B en §2.8 |
| Next dev bloquea recursos de desarrollo si el origen no coincide con `-H` | Se verifica en el paso 5 (HMR y log). Si pasa, se documenta navegar por `localhost`, o se suma `allowedDevOrigins` en un feature aparte |
| Rotación cortada a mitad de camino | Código 10 y "volvé a rotar": por el socket local con `trust` no hace falta la contraseña anterior. Escritura atómica del `.env` |
| La rotación queda registrada en el log de Postgres | `log_statement = none`, verificado en el paso 2. El `ALTER` va por stdin, no por argumentos |
| Falsos positivos del hook | Solo se revisan líneas agregadas, con exclusión de placeholders y tests armados en ejecución. `--no-verify` documentado, nunca para secretos |
| Hook desactivado (otro `core.hooksPath` o clon sin `-Init`) | `Enable-RepoHooks` avisa. Es un control de ayuda, no de seguridad: se sigue revisando antes de cada commit |
| CRLF en `.sh` o en el hook | `.gitattributes`. Test de "sin `\r`" |
| `db` recreado por el cambio de imagen o de entorno | Mismo volumen y misma versión menor. Conteos en los pasos 2, 7, 9, 11 y 12 |
| El usuario de humo es un usuario real | Una fila, sin organización ni roles, dominio `.invalid` y nombre identificable. Solo se actualiza si el nombre coincide. Login con R-1 y R-5 abiertos hasta el 005 |
| `docker compose logs backend` contiene `SMOKE_PASSWORD` y el token (R-1) | No guardar ni compartir esos logs. Lo corrige el 005 |
| Borrado de volúmenes y de `_backup_git` (irreversible) | Verificar que ningún contenedor use los volúmenes. Nombres exactos. `_backup_git` al final, después del barrido que usa sus valores |
| `docker run` de `-ExportCa` descarga `node:22-alpine` si falta | La descarga va por el daemon, que confía en el almacén de Windows. Corre con `--network none` y `--rm` |
| Archivos vacíos que BuildKit deja como punto de montaje en `/tmp` o `/run/secrets` | Se verifica en el paso 9. Sin contenido no es un problema |
| `.claude/settings.json` ensuciado por el harness | Regla 12: restaurarlo a HEAD antes del commit. El hook lo bloquea si se stagea con `allow` |

## 10. Notas para el PO

1. **`.claude/settings.json`:** el harness agregó permisos durante esta sesión. Al menos
   `Bash(echo "hooksPath rc=$?")` y `Bash(echo "autocrlf rc=$?")`, y probablemente `docker image *`,
   `git grep *` y `docker buildx *`. El resto ya estaba. No lo toqué. Hay que restaurarlo antes del
   commit (regla 12).
2. **`docs/auditoria/RIESGOS.md` está en `.gitignore`** (primera línea): el criterio 21 se cumple en el
   archivo local, pero ese cambio no se versiona. Si la intención es versionarlo, hay que decidirlo
   aparte, porque habría que revisar su contenido sensible.
3. **Lectura de "`backend/.env*`" en el criterio 15:** se aplica con la excepción `*.env.example` (si no,
   `backend/.env.example` no se podría commitear).
4. **Posible drift de schema, preexistente y fuera de alcance:**
   - `schema.prisma` declara `User.cuit String? @unique`, pero ninguna migración crea esa columna en
     `User`;
   - la base local seguramente la tiene, porque el login del 003 respondió 401 y no 500;
   - en una base creada solo con migraciones, `user.findUnique` del login fallaría;
   - el tester lo confirma en el paso 2;
   - si se confirma, conviene un ítem de BACKLOG (migración que la cree).

   No afecta al usuario de humo.
5. **`_backup_git`:** se borra en el paso 14. Si el PO prefiere conservarlo hasta después del push, el
   criterio 18 queda verificado por el PO en el cierre.
6. **Plan B de Turbopack:** si hace falta, es una decisión de producto o técnica sobre el build del
   frontend. Se escala, no se aplica sin aprobación.

VEREDICTO: APROBADO
