# 03 — Diseño técnico: 002-sin-credenciales-en-repo

> Este documento no contiene ningún valor secreto. Las credenciales se nombran por su variable,
> archivo y línea, nunca por su valor. Los valores reales solo se escriben en archivos locales
> **fuera del repo** (ver 4.4).

## 1. Resumen

- **Fase A (working tree).** Las credenciales salen de los archivos versionados y pasan a dos `.env`
  locales e ignorados: uno en la raíz, para el compose raíz, y `backend/.env`, que ya existe y
  sirve al compose del backend y a Nest.
  - Se versionan dos `.env.example`.
  - `JWT_SECRET` pasa a ser obligatorio en los dos `JwtModule`. Ambos usan `registerAsync` con
    `ConfigService` y un helper común que falla al arrancar.
  - Se limpia `.claude/settings.json`. Salen del índice `.claude/settings.local.json` y
    `docs/superpowers/`, y se borran los 14 skills de Superpowers.
- **Fase B (historial).** Se reescribe el historial en el mismo repo con `git filter-repo --force`,
  en una sola corrida que combina `--invert-paths`, `--replace-text` y `--replace-message`.
  - Antes de correrlo se hace un backup con `git bundle`, se commitea y se resuelve el worktree
    registrado.
  - Después se restaura `origin` **sin hacer fetch**.
  - Se verifica: el árbol de HEAD tiene que dar el mismo hash que antes de reescribir, y no tiene
    que quedar ningún valor ni ruta purgada en ningún objeto alcanzable.
  - El force push queda documentado y **no se ejecuta**.

## 2. Hallazgos del relevamiento que condicionan el diseño

| # | Hallazgo | Impacto |
|---|---|---|
| H-1 | `backend/src/api/main.ts` importa `bootstrap` **antes** de `'dotenv/config'`. Por eso, cuando se evalúa el decorador `@Module` de `AuthModule`, `process.env.JWT_SECRET` todavía no salió de `backend/.env`. Con `npm run start:dev`, el login firma siempre con el secreto de fallback, aunque el `.env` lo defina. | `JwtModule.register({ secret: process.env... })` no sirve. Hay que usar `registerAsync` + `ConfigService`: `ConfigModule.forRoot` carga `.env` y la factory corre en tiempo de DI. |
| H-2 | Hay dos `JwtModule`. El global (`app-module.ts`, `1d`, secreto de `ConfigService`) lo usan los guards, que solo hacen `decode`. El de `AuthModule` (`8h`, con fallback) lo usa `LoginQueryHandler` para el único `sign`. | Que el secreto sea obligatorio no rompe tokens viejos: hoy no se verifican (riesgo S1, fuera de alcance). Se mantienen los dos registros para no cambiar la expiración (ver 5). |
| H-3 | `@types/jsonwebtoken` 9.0.10 tipa `expiresIn` como `StringValue \| number`, no como `string`. | El helper tiene que tipar su parámetro como `JwtSignOptions['expiresIn']`. Si se tipa como `string`, `tsc` falla. |
| H-4 | `backend/.env` tiene hoy `NODE_ENV`, `PORT`, `NODE_TLS_REJECT_UNAUTHORIZED`, `APP_NAME`, `DATABASE_URL`, `CORS_ORIGIN` y `CORS_METHODS`, varias con espacios alrededor del `=`. **No tiene** `JWT_SECRET` ni `POSTGRES_*`. | Hay que agregar las variables. Además hay que validar que Docker Compose parsee el archivo (ver riesgo R-6). |
| H-5 | El `.gitignore` raíz **no** ignora `.env`, `.claude/settings.local.json` ni `docs/superpowers/`. Lo confirma `git check-ignore`: solo `backend/.env` está cubierto, por `backend/.gitignore:39`. | Hay que agregar reglas en el `.gitignore` raíz. |
| H-6 | `backend/.dockerignore` no excluye `.env`. El `COPY . .` del stage `builder` copia `backend/.env` a una capa de la imagen intermedia. | Se recomienda excluirlo (ver 3.4). |
| H-7 | Historial: 8 commits. Ramas `main` (= `origin/main` = `b689c80`), `claude/bold-meninsky-a75726`, `claude/cool-shaw-e0a7e3` y `claude/gallant-nobel-2c467e` (las tres en `8a226bd`). Hay un único remoto, `origin`. No hay tags ni stash. | `filter-repo` reescribe todas las refs. |
| H-8 | Worktree registrado `C:/Repositorios/healthops-gem/.claude/worktrees/bold-meninsky-a75726`: HEAD **detached** en `8a226bd`, sin cambios (`git status` vacío). El repo tiene `extensions.worktreeConfig = true`. | Ver 4.5: `filter-repo` exige `--force`, y el HEAD del worktree mantiene vivo el historial viejo. |
| H-9 | `8a226bd` solo toca `seed_psicolsa.sql`. Su mensaje incluye el nombre y apellido de una profesional, que también aparece en el correo de aspecto real de `docs/superpowers/plans/...:139`. | Al purgar los seeds, el commit queda vacío y `filter-repo` lo descarta (`--prune-empty=auto`). Igual se agrega `--replace-message` como defensa (regla 3 de CLAUDE.md). Las tres ramas `claude/*` van a quedar apuntando a la reescritura de `88327f2`. |
| H-10 | Hasta `80de329`, `backend` y `frontend` eran gitlinks (modo 160000) a commits de `github.com/mzaracho/solidus-backend` y `solidus-frontend`. | Esos repos externos tienen en **su** historial el secreto de fallback y la contraseña del compose. Reescribir este repo no los limpia (ver R-9, decisión del PO). |
| H-11 | Ningún `.env` estuvo versionado nunca. `docs/auditoria/RIESGOS.md` tampoco. | La regla de `.env` en `--invert-paths` es solo una salvaguarda. |
| H-12 | Ubicación de valores sensibles en el historial, en rutas que **no** se purgan por ruta: JWT y UUID de org, usuario y paciente en `.claude/settings.json`; URL de Postgres con contraseña en `docker-compose.yml` y `docs/auditoria/COMANDOS.md`; `POSTGRES_PASSWORD` en los dos compose; secreto de fallback en `auth-module.ts` y `docs/auditoria/ESTADO.md`. Las contraseñas de usuarios de prueba, el correo de aspecto real y el nombre aparecen solo en rutas que se purgan (seeds, generadores, `settings.local.json`, `docs/superpowers/`). | Define qué categorías van en `--replace-text`. |
| H-13 | El harness de Claude Code agrega solo a `.claude/settings.json` los comandos que se aprueban con "permitir siempre". Por eso ese archivo aparece modificado "por algo ajeno". | Hay riesgo de volver a contaminarlo (R-7). La limpieza de `settings.json` se hace al final de la fase A y se re-barre antes de cada commit. |
| H-14 | `git filter-repo` **no está instalado**. Hay Python 3.12.10 y pip 25.0.1, con `Scripts` en el PATH. Git 2.56.0.windows.2. `core.autocrlf=true`. `C:\Repositorios` no es un repo git. Ya existe `C:\Repositorios\_backup_git\`, con `backend.git` y `frontend.git`. | Se instala con pip (4.1). Los backups y los archivos de expresiones van a `C:\Repositorios\_backup_git\`. |

## 3. Fase A — diseño (criterios 1 a 10)

### 3.0 Paso previo recomendado: commit del feature 001
El índice tiene hoy exactamente el resultado del feature 001: bajas de seeds, generadores y gitlink en
stage, más los tres `.gitignore` y `COMANDOS.md` modificados. Se recomienda que el desarrollador cree
**primero** el commit local C1 con ese contenido, antes de editar nada:
- `git add .gitignore backend/.gitignore frontend/.gitignore docs/auditoria/COMANDOS.md docs/features/001-gitignore-seeds/`
  (las bajas ya están en stage).
- No incluir `.claude/settings.json`.
- Mensaje sugerido: `chore(001): sacar seeds y datos de prueba del control de versiones`.

Así el revisor de la fase A ve con `git diff HEAD` solo los cambios del 002. Sin este paso, los
mismos archivos (`.gitignore` y `COMANDOS.md`) mezclan los dos features, y separarlos exige
`git add -p`, que no está soportado en este entorno. El usuario ya autorizó "los commits locales que
hagan falta". C1 todavía contiene la contraseña de Postgres en `COMANDOS.md`, que `--replace-text`
limpia en la fase B. El PO confirma (D-3).

### 3.1 Variables por archivo

Variables que necesita cada archivo (los `.env` reales no se versionan; los `.env.example` sí):

| Variable | `.env` raíz (compose raíz) | `backend/.env` (compose backend + Nest + Prisma CLI) | Notas |
|---|---|---|---|
| `POSTGRES_USER` | sí | sí (nueva) | Valor local = el actual de los compose (criterio 2, no romper el volumen). |
| `POSTGRES_PASSWORD` | sí | sí (nueva) | Ídem. Solo caracteres URL-safe (`[A-Za-z0-9_-]`): se interpola dentro de `DATABASE_URL`. |
| `POSTGRES_DB` | sí | sí (nueva) | No es secreto. |
| `JWT_SECRET` | sí | sí (nueva) | Aleatorio, 32 bytes (64 caracteres hex). Puede ser distinto en cada archivo. |
| `DATABASE_URL` | no (la arma el compose) | ya existe, sin cambios | Apunta a `localhost:5433`. Queda literal: Nest no expande variables (`expandVariables` está apagado) y no se cambia eso. |
| `NODE_ENV`, `APP_NAME`, `PORT` | no (literales en el compose, no son secretos) | ya existen | El `Logger` exige `NODE_ENV` y `APP_NAME`. |
| `CORS_ORIGIN`, `CORS_METHODS`, `BODY_SIZE_LIMIT` | no | existen u opcionales | Se documentan como opcionales en el ejemplo. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | no | existe | No se copia al ejemplo. Seguridad debería revisar si sigue haciendo falta. |

**Cómo crear los valores locales sin exponerlos:**
- Para `JWT_SECRET`, generar y escribir directo al archivo, sin imprimir en la terminal, por
  ejemplo en Git Bash:
  `printf 'JWT_SECRET=%s\n' "$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")" >> .env`
  (lo mismo para `backend/.env`).
- Para `POSTGRES_*`, copiar los valores actuales del `docker-compose.yml` al `.env` **antes** de
  editar el compose, sin mostrarlos en la salida ni en los informes.
- Escribir las líneas nuevas con la forma `CLAVE=valor`, sin espacios alrededor de `=` y sin `$`
  en los valores.

**`.env.example` (raíz), contenido propuesto:**
```dotenv
# Copiar a .env (no se versiona) y completar. Lo lee docker compose desde la raíz.
POSTGRES_USER=change-me
POSTGRES_PASSWORD=change-me
POSTGRES_DB=solidus_db
# Mínimo 32 caracteres. Generar con:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=change-me
```

**`backend/.env.example`, contenido propuesto:**
```dotenv
# Copiar a backend/.env (no se versiona). Lo leen Nest (ConfigModule), Prisma CLI y
# backend/docker-compose.yml.
NODE_ENV=development
APP_NAME="Solidus API"
PORT=8080
DATABASE_URL="postgresql://change-me:change-me@localhost:5433/solidus_db?schema=public"
# Mínimo 32 caracteres (ver comando en el .env.example de la raíz). Sin esto el backend no arranca.
JWT_SECRET=change-me
# Para backend/docker-compose.yml (deben coincidir con DATABASE_URL)
POSTGRES_USER=change-me
POSTGRES_PASSWORD=change-me
POSTGRES_DB=solidus_db
# Opcionales
# BODY_SIZE_LIMIT=50mb
# CORS_ORIGIN=["http://localhost:3000"]
# CORS_METHODS=["GET","POST"]
```
`JWT_SECRET=change-me` tiene menos de 32 caracteres a propósito. Si alguien copia el ejemplo sin
editarlo, el backend falla al arrancar (3.3).

### 3.2 Docker Compose (criterio 1)

**Mecanismo:** cada compose interpola `${VAR}` desde el `.env` del *project directory*, que por
defecto es el directorio del archivo compose. El compose raíz lee `.env` de la raíz y
`backend/docker-compose.yml` lee `backend/.env`. Las variables del shell tienen precedencia sobre
el `.env`. **No** se usa `env_file`:
- en la raíz, `env_file: backend/.env` inyectaría el `DATABASE_URL` de `localhost:5433` en el
  contenedor y pisaría el que apunta a `db:5432`;
- en el compose del backend, el servicio `db` solo necesita tres variables.

Se usa `${VAR:?mensaje}`, que falla si la variable está vacía o no definida, en **todas** las
apariciones. Todos los valores interpolados van entre comillas dobles, para evitar ambigüedades
de YAML con `:?`.

`docker-compose.yml` (raíz), solo las líneas que cambian:
```yaml
  db:
    environment:
      POSTGRES_USER: "${POSTGRES_USER:?Definir POSTGRES_USER en .env (ver .env.example)}"
      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:?Definir POSTGRES_PASSWORD en .env (ver .env.example)}"
      POSTGRES_DB: "${POSTGRES_DB:?Definir POSTGRES_DB en .env (ver .env.example)}"
  backend:
    environment:
      DATABASE_URL: "postgresql://${POSTGRES_USER:?Definir POSTGRES_USER en .env}:${POSTGRES_PASSWORD:?Definir POSTGRES_PASSWORD en .env}@db:5432/${POSTGRES_DB:?Definir POSTGRES_DB en .env}?schema=public"
      JWT_SECRET: "${JWT_SECRET:?Definir JWT_SECRET en .env (ver .env.example)}"
      # PORT, CORS_ORIGIN, APP_NAME, NODE_ENV: sin cambios (no son secretos)
```
`backend/docker-compose.yml`: las mismas tres líneas del servicio `db`, con mensajes que remitan
a `backend/.env`.

**Fuera de alcance, sin cambios:**
- `version: '3.8'`, que es obsoleto y solo genera un warning.
- Las IP de LAN de `CORS_ORIGIN` y `NEXT_PUBLIC_API_BASE_URL`.
- Los nombres de los volúmenes (`solidus_postgres_data` y `postgres_data`). No se tocan, para
  conservar los datos.

**Validación:**
- `docker compose config --quiet` en la raíz y en `backend/`. Usar `--quiet`: sin ese flag imprime
  los valores interpolados, incluidos los secretos.
- Prueba negativa: `docker compose --env-file <archivo vacío fuera del repo> config --quiet` tiene
  que fallar con el mensaje de `:?`. Antes, verificar que el shell no tenga exportadas las
  variables (`env | grep -c '^POSTGRES_\|^JWT_SECRET'` debe dar 0).
- Atención: con `:?`, **todos** los subcomandos de compose (`up`, `down`, `ps`, `logs`) fallan si
  falta el `.env`. Es el comportamiento buscado y hay que documentarlo.

### 3.3 `JWT_SECRET` obligatorio (criterio 4)

**Helper nuevo:** `backend/src/infrastructure.bootstrap/config/app/jwt-config.ts`. Sigue el patrón
de los `*-config.ts` que ya existen en esa carpeta (`cors-config.ts`, `body-parser-config.ts`), que
reciben `ConfigService`.

```ts
import { ConfigService } from '@nestjs/config';
import { JwtModuleAsyncOptions, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { isString } from '../core/type-guards';

export const JWT_SECRET_MIN_LENGTH = 32;

export function getRequiredJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!isString(secret) || secret.trim().length === 0) {
    throw new Error(
      'JWT_SECRET is not defined. Set it in backend/.env (local) or in the root .env (Docker Compose). See .env.example.',
    );
  }
  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters long.`, // nunca incluir el valor
    );
  }
  return secret;
}

export function jwtModuleAsyncOptions(
  expiresIn: JwtSignOptions['expiresIn'],
): JwtModuleAsyncOptions {
  return {
    inject: [ConfigService],
    useFactory: (config: ConfigService): JwtModuleOptions => ({
      secret: getRequiredJwtSecret(config),
      signOptions: { expiresIn },
    }),
  };
}
```

**Uso:**
- `app-module.ts`: `JwtModule.registerAsync({ global: true, ...jwtModuleAsyncOptions('1d') })`.
  Se elimina el `useFactory` inline y quedan sin uso los imports duplicados de `ConfigService`.
- `auth-module.ts`: `JwtModule.registerAsync(jwtModuleAsyncOptions('8h'))`. Desaparece el fallback.

`ConfigService` está disponible en `AuthModule` porque `ConfigModule.forRoot({ isGlobal: true })`
es global. No hace falta importarlo en el módulo.

**Decisiones:**
- **`throw new Error` y no excepciones HTTP de Nest.** Es una validación de configuración en el
  arranque, no un error de negocio. El precedente en el proyecto es el constructor de
  `infrastructure.bootstrap/config/core/logger.ts`, que lanza `Error` si faltan `NODE_ENV` o
  `APP_NAME`. La regla de CLAUDE.md sobre excepciones HTTP aplica a los handlers.
- **Mínimo de 32 caracteres.** El criterio 2 exige 32 bytes o más. Hoy no existe ningún
  `JWT_SECRET` configurado, así que no rompe ningún entorno. Además bloquea el placeholder del
  ejemplo. El mensaje de error nunca incluye el valor.
- **Comportamiento al fallar:** la factory lanza durante `NestFactory.create`. Nest registra el
  error, vacía el buffer de logs (`bufferLogs: true` + `autoFlushLogs`) y aborta el proceso con
  código distinto de 0. El tester debe confirmar que el mensaje se ve en consola.
- **Se descartó usar `ConfigService.getOrThrow`:** no rechaza la cadena vacía y su mensaje no dice
  dónde definir la variable.
- **Se descartó un `validate` global en `ConfigModule.forRoot`:** centraliza bien, pero invita a
  validar otras variables y sale del alcance. El helper puede mudarse ahí más adelante.

### 3.4 `.gitignore` y `.dockerignore` (criterios 2, 3, 6 y 8)

Agregar al final del **`.gitignore` raíz**, sin tocar lo existente:
```gitignore
# --- Credenciales locales (nunca se versionan) ---
.env
.env.*
!.env.example
.claude/settings.local.json

# --- Planes/specs de Superpowers (locales, no se versionan) ---
docs/superpowers/
```
- `.env` y `.env.*` no llevan `/`, así que aplican en todos los niveles (raíz, `backend/` y
  `frontend/`).
- `!.env.example` las reincluye en todos los niveles. Ningún directorio padre queda excluido, así
  que la negación funciona.
- `backend/.gitignore` (`.env`, `.env.*.local`) y `frontend/.gitignore` (`.env*`) siguen como
  están. Solo se agrega `!.env.example` en los dos, para dejar explícita la intención. En el
  frontend hoy no existe ese archivo, pero `.env*` lo ignoraría.

Agregar `.env` y `.env.*` a **`backend/.dockerignore`**, y `.env*` a **`frontend/.dockerignore`**
(recomendado):
- así el `.env` no se copia a la capa `builder` (H-6);
- en runtime no se usa, porque las variables vienen del `environment:` del compose.

**Validación:**
- `git check-ignore -v .env backend/.env .claude/settings.local.json docs/superpowers/plans/x.md`
  devuelve una regla para cada ruta.
- `git check-ignore -v --no-index .env.example backend/.env.example` no devuelve nada (código de
  salida 1).
- `git ls-files -ci --exclude-standard` queda vacío.

### 3.5 `.claude/settings.json` y `.claude/settings.local.json` (criterios 5 y 6)

**`settings.json`:**
- Se eliminan las 14 entradas `Bash(curl ...)` de las líneas 4 a 17 (JWT, `x-org-id`, `x-user-id`,
  UUID de organización y de paciente). **No** se reemplazan por un permiso genérico, por mínimo
  privilegio: quien necesite curl con token lo agrega en `settings.local.json`.
- Se conservan `additionalDirectories`, `"agent": "po"` y las demás entradas `Bash(...)` sin
  credenciales. Los patrones de grep que agregó el harness solo contienen nombres de patrones,
  no valores, pero se revisan una por una.
- Se hace **al final** de la fase A, justo antes del commit C2, y se re-barre (H-13).

**`settings.local.json`:**
- Se ejecuta `git rm --cached .claude/settings.local.json`.
- El archivo queda en disco sin cambios: su contenido es local y lo administra el usuario.
- Queda ignorado por la regla de 3.4.

### 3.6 `docs/superpowers/` y skills (criterios 8 y 9)

`git rm -r --cached docs/superpowers` (queda en disco).

**Skills:** se borran del índice y del disco con
`git rm -r -- .claude/skills/<carpeta>` para cada una de estas **14 carpetas**, que son exactamente
las que existen hoy en `.claude/skills/`:
1. `.claude/skills/brainstorming`
2. `.claude/skills/dispatching-parallel-agents`
3. `.claude/skills/executing-plans`
4. `.claude/skills/finishing-a-development-branch`
5. `.claude/skills/receiving-code-review`
6. `.claude/skills/requesting-code-review`
7. `.claude/skills/subagent-driven-development`
8. `.claude/skills/systematic-debugging`
9. `.claude/skills/test-driven-development`
10. `.claude/skills/using-git-worktrees`
11. `.claude/skills/using-superpowers`
12. `.claude/skills/verification-before-completion`
13. `.claude/skills/writing-plans`
14. `.claude/skills/writing-skills`

**Después del borrado:**
- Si queda algún archivo no trackeado dentro de esas carpetas, borrar solo esas 14 rutas. Si
  `.claude/skills/` queda vacía, se elimina.
- No se tocan `.claude/agents/`, `.claude/CLAUDE.md`, `.claude/launch.json`,
  `.claude/scheduled_tasks.lock` ni `.claude/worktrees/`.

**Referencias en archivos versionados:** la única es `docs/auditoria/ARQUITECTURA.md:27`
(`docs/superpowers/...`), y la actualiza el documentador (criterio 17). Ningún archivo
de `.claude/agents/` referencia esos skills. Los skills no se purgan del historial porque no
contienen credenciales y la spec no lo pide.

### 3.7 Docs sin claves (criterio 7)

| Archivo | Cambio |
|---|---|
| `docs/auditoria/COMANDOS.md:22` | Reemplazar `usuario/contraseña` por "credenciales en `backend/.env` (ver `backend/.env.example`)". |
| `docs/auditoria/COMANDOS.md` (bloque del `.env`, hoy en las líneas 47 a 54) | `DATABASE_URL` con `<POSTGRES_USER>:<POSTGRES_PASSWORD>`. `JWT_SECRET` pasa a "obligatorio, mínimo 32 caracteres; el backend no arranca sin él". |
| `docs/auditoria/ESTADO.md:145` | Quitar el valor literal del fallback ("secreto de fallback hardcodeado, eliminado en 002"). |

Los cambios estructurales (sección 1 de `COMANDOS.md`, `ARQUITECTURA.md` y `CLAUDE.md`) son del
documentador. Los usuarios de Postgres que aparecen en comandos `psql -U ...` no son secretos.
Pueden pasar a `<POSTGRES_USER>` por consistencia, a criterio del desarrollador.

### 3.8 Barrido final del working tree (criterio 10)

Comandos (Git Bash, desde la raíz):
```bash
git ls-files -z | xargs -0 grep -InE 'eyJ[A-Za-z0-9_-]{10,}\.|PGPASSWORD=[^.<$ ]|postgres(ql)?://[^:@/[:space:]]+:[^@$<[:space:]]+@|Bearer [A-Za-z0-9]{10,}'
git ls-files -z | xargs -0 grep -InEi 'password|secret|token' # revisar a mano y listar falsos positivos
git grep -n -F -f C:/Repositorios/_backup_git/002-redact/valores.txt   # debe salir con código 1
git grep -n -E -i '@(gmail|hotmail|outlook|yahoo)\.' -- . ':!**/package-lock.json'
```
**Falsos positivos esperados**, que se listan en `04-implementacion.md`:
- `login-query-handler.ts:26` (`readonly password`), `frontend/src/app/login/page.tsx:19`,
  `schema.prisma` (`passwordHash`), las migraciones (`"passwordHash"`) y los docs de API
  ("Bearer token");
- la regla 3 de CLAUDE.md y los agentes ("secretos, tokens");
- los textos `PGPASSWORD=...` y `eyJ...` de `01-spec.md` y de `001/06-seguridad.md`;
- los `<placeholder>` de los `.env.example` y de este documento.

## 4. Fase B — reescritura del historial (criterios 11 a 16)

Todos los comandos se corren en **Git Bash** con `MSYS_NO_PATHCONV=1` y rutas `C:/...`, para que
MSYS no reescriba argumentos. Variables de conveniencia:
```bash
export MSYS_NO_PATHCONV=1
REPO=C:/Repositorios/healthops-gem
BK=C:/Repositorios/_backup_git
RX=$BK/002-redact
WT=$REPO/.claude/worktrees/bold-meninsky-a75726
cd "$REPO"
```

### 4.0 Precondiciones (abortar si alguna falla)
1. La fase A está aprobada por el revisor y el barrido 3.8 está limpio.
2. Están hechos los commits C1 (feature 001) y C2 (fase A del 002). Ver 4.3.
3. `git status --porcelain` no muestra archivos trackeados modificados. Puede haber archivos
   no trackeados o ignorados.
4. **Ninguna ruta a purgar sigue trackeada en HEAD:**
   `git ls-tree -r --name-only HEAD | grep -E '^(seed.*\.sql|truncate\.sql|generate_seed.*\.py|\.claude/settings\.local\.json|docs/superpowers/|\.claude/worktrees/)|(^|/)\.env$'`
   tiene que salir vacío. Es crítico: al terminar, `filter-repo` hace `reset --hard` y **borra
   del disco** los archivos que estaban trackeados en HEAD y desaparecen del árbol nuevo.
5. **HEAD no contiene ningún valor a reemplazar:**
   - `git grep -n -F -f "$RX/valores.txt" HEAD` sale con código 1;
   - `git grep -n -E 'eyJ[A-Za-z0-9_-]{10,}\.eyJ' HEAD` sale con código 1.
6. Se registran, para la verificación posterior:
   - `git rev-parse HEAD^{tree}` → `TREE_ANTES`;
   - `git rev-parse 80de329:seed.sql` → `BLOB_SEED_VIEJO`;
   - `git rev-parse b689c80:.claude/settings.json` → `BLOB_SETTINGS_VIEJO`.
   Son hashes, no secretos.
7. `git worktree list` coincide con H-8. Si cambió, avisar al PO.

### 4.1 Instalación de `git filter-repo`
```bash
python -m pip install git-filter-repo
git filter-repo --version
```
- Usa el Python 3.12 del usuario, que ya tiene `Scripts` en el PATH.
- Requiere red. Es un cambio de entorno fuera del repo que la spec ya prevé.
- Si `git filter-repo` no se encuentra después de instalar, revisar con
  `python -m pip show -f git-filter-repo` dónde quedó `git-filter-repo.exe` y agregar esa carpeta
  al PATH de la sesión.
- No descargar el script a mano desde la web.

### 4.2 Backup (criterio 11)
```bash
FECHA=$(date +%Y-%m-%d)
git bundle create "$BK/healthops-gem-$FECHA-pre-002.bundle" --all
git bundle verify "$BK/healthops-gem-$FECHA-pre-002.bundle"
git bundle list-heads "$BK/healthops-gem-$FECHA-pre-002.bundle"   # debe listar las 5 refs de H-7 + HEAD
mkdir -p "$BK/healthops-gem-$FECHA-pre-002-local"
cp -p .env backend/.env .claude/settings.local.json "$BK/healthops-gem-$FECHA-pre-002-local/"
cp -rp docs/superpowers seed*.sql truncate.sql generate_seed*.py "$BK/healthops-gem-$FECHA-pre-002-local/"
```
- La copia de archivos locales es una red de seguridad para el criterio 15.
- El bundle no guarda el config, el índice, los hooks ni los metadatos del worktree. Si se
  quiere un rollback completo, copiar también el `.git` entero:
  `cp -rp .git "$BK/healthops-gem-$FECHA-pre-002.git-dir"`.
- **El backup contiene los secretos.** Queda fuera de todo repo, no se sube a ningún lado y se
  borra cuando el usuario confirme el push y la limpieza en GitHub.
- Informar la ruta del bundle en `04-implementacion.md`.

**Rollback:**
- Para recuperar en otra carpeta: `git clone "$BK/...bundle" C:/Repositorios/healthops-gem-restaurado`.
- Para recuperar en el mismo repo:
  `git fetch --update-head-ok "$BK/...bundle" '+refs/heads/*:refs/heads/*'` y después
  `git reset --hard main`. Los archivos ignorados no se tocan.

### 4.3 Commits previos y orden (criterio 12)
| Orden | Commit | Contenido | Cuándo |
|---|---|---|---|
| C1 | `chore(001): sacar seeds y datos de prueba del control de versiones` | Lo descripto en 3.0 | Inicio de la fase A (recomendado) |
| C2 | `chore(002): credenciales fuera del repo (env, JWT obligatorio, settings de Claude)` | Todo lo de la fase A: compose, `.env.example` x2, `jwt-config.ts` y su spec, los dos módulos, los `.gitignore` y `.dockerignore`, `settings.json`, las bajas de `settings.local.json`, `docs/superpowers` y los skills, `COMANDOS.md`, `ESTADO.md` y `docs/features/002-.../` (01, 03, 04 y 05) | Inicio de la fase B, antes del backup |
| — | **Reescritura** (4.6) | — | — |
| C3 | Documentador y demás informes (06 a 09, `CLAUDE.md`, `ARQUITECTURA.md`, `COMANDOS.md` sección 1) | Encima del historial reescrito, después del barrido 3.8 | Después de seguridad y tester |

- Si el PO no aprueba C1, C2 incluye todo, con un mensaje que nombre los dos features.
- Antes de C2 y antes de C3, re-barrer `.claude/settings.json` (H-13).
- Los informes de seguridad y del tester (06 y 07) se escriben después de la reescritura. Como
  van en C3, quedan fuera del alcance de `filter-repo`. Por eso es obligatorio barrerlos antes
  de commitear.

### 4.4 Archivos de expresiones (fuera del repo)
Carpeta: `C:\Repositorios\_backup_git\002-redact\`. **Nunca** dentro de `healthops-gem`, ni en
el scratchpad de un agente: es efímero y otro agente no lo ve.

Reglas de formato para los tres archivos:
- UTF-8 **sin BOM**, fin de línea **LF**, una regla por línea, **sin comentarios ni líneas vacías**.
  `filter-repo` interpreta una línea `# ...` como un literal a reemplazar.
- Crearlos desde Git Bash (`printf`/editor con LF), no con `Out-File` de PowerShell 5, que
  agrega BOM.
- Comprobar con `cat -A archivo | grep -c '\^M'`, que debe dar 0, y con `head -c3 archivo | od -c`,
  que no debe mostrar un BOM.
- No imprimir su contenido en la terminal ni en informes.

**`replace-text.txt`** (para `--replace-text`). Formato `literal:VALOR==>REEMPLAZO` o
`regex:PATRÓN==>REEMPLAZO`. Se usa el prefijo `literal:` explícito. Categorías, en este orden:

| Categoría | Regla (esquema, sin valores) | Reemplazo |
|---|---|---|
| JWT | `regex:eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]*)?` | `<REDACTED_JWT>` |
| Contraseña de Postgres | `literal:<valor actual de POSTGRES_PASSWORD>` | `<POSTGRES_PASSWORD>` |
| Secreto de fallback JWT (`auth-module.ts:12` en HEAD previo) | `literal:<valor>` | `<REDACTED_JWT_SECRET>` |
| Contraseñas de usuarios de prueba (una línea por cada contraseña distinta de los seeds, de `settings.local.json` y del plan de superpowers) | `literal:<valor>` | `<TEST_PASSWORD>` |
| Correo de aspecto real (`docs/superpowers/plans/2026-04-22-multi-org-professional.md:139`) | `literal:<correo>` | `profesional@ejemplo.com` |
| UUID de organización, usuario y paciente de `.claude/settings.json` (recomendado, coherente con el criterio 5) | `literal:<uuid>` | `<ORG_ID>`, `<USER_ID>`, `<PATIENT_ID>` |

- **Se usan literales y no regex contextuales** para contraseñas y URL. Una regex genérica como
  `postgres://usuario:pass@` o `PGPASSWORD=\S+` también matchea los placeholders legítimos de HEAD
  (`${POSTGRES_PASSWORD}` en el compose, `PGPASSWORD=...` en la spec) y cambiaría el árbol final.
  La regex de JWT exige dos segmentos `eyJ` con 10 caracteres o más, así que no matchea los
  textos `eyJ...` de la documentación.
- **Control de colaterales antes de correr**, imprimiendo solo rutas y conteos, nunca valores:
  ```bash
  grep '^literal:' "$RX/replace-text.txt" | sed 's/^literal://; s/==>.*//' > "$RX/.tmp-lits"
  while IFS= read -r v; do git grep -l -F -e "$v" $(git rev-list --all) | sed 's/^[0-9a-f]*://' | sort | uniq -c; echo "--"; done < "$RX/.tmp-lits"
  rm "$RX/.tmp-lits"
  ```
  Si un literal aparece en rutas que no son de credenciales (código o `package-lock.json`), es
  una palabra común y hay que reemplazarlo por una regex con contexto **que no matchee HEAD**.
  Revalidar con la precondición 4.0.5.

**`replace-message.txt`** (para `--replace-message`, que reescribe los mensajes de commit):
- `literal:<nombre y apellido de la profesional del mensaje de 8a226bd>==>profesional de prueba`;
- `literal:<correo de aspecto real>==>profesional@ejemplo.com`.

Es una defensa: lo esperado es que `8a226bd` se descarte por quedar vacío (H-9).

**`valores.txt`** (solo para verificar con `grep -F -f`). Un valor literal por línea, sin prefijo:
- todos los `literal:` de los dos archivos anteriores;
- los `JWT_SECRET` nuevos de `.env` y `backend/.env`, para comprobar que nunca se commitearon;
- el JWT completo de `settings.json` y el de `settings.local.json`.

### 4.5 Worktree registrado (`.claude/worktrees/bold-meninsky-a75726`)
**Estado:** HEAD detached en `8a226bd`, limpio y registrado en
`.git/worktrees/bold-meninsky-a75726/`. Su carpeta tiene copias de seeds y está ignorada.

**Interferencias con la reescritura:**
1. `filter-repo` aborta con "you have multiple worktrees" salvo que se use `--force`. Igual hace
   falta `--force`, porque el repo no es un clon fresco (tiene reflogs y objetos sueltos).
2. `filter-repo` reescribe las ramas, pero el HEAD detached de otro worktree no es una rama: no
   está garantizado que se actualice. Si queda en el `8a226bd` viejo, `git gc` conserva ese
   historial (los HEAD y los índices de todos los worktrees cuentan como raíces) y además
   `git rev-list --all` lo incluye (por defecto `--all` mira todos los worktrees). El criterio 14
   fallaría localmente.
3. El índice del worktree referencia los blobs de los seeds viejos y también los mantiene vivos.

**Opciones** (la spec pide informar al PO antes de tocar el worktree, ver D-1):
- **W1 (recomendada): re-apuntar los metadatos del worktree sin tocar su carpeta.** Después de
  `filter-repo`:
  ```bash
  NEW=$(git rev-parse refs/heads/claude/bold-meninsky-a75726)   # rama que apuntaba al mismo commit
  git -C "$WT" rev-parse HEAD                                   # inspeccionar: ¿sigue en 8a226bd...?
  git -C "$WT" update-ref --no-deref HEAD "$NEW"                # escribe .git/worktrees/<n>/HEAD
  git -C "$WT" reset --mixed -q "$NEW"                          # reescribe SOLO su índice
  ```
  - `reset --mixed` no modifica archivos del árbol de trabajo. La carpeta queda igual, byte a
    byte, y los seeds pasan a verse como no trackeados dentro del worktree.
  - Antes y después se registra `ls -la "$WT"` y una suma de los archivos para demostrarlo.
  - Si `filter-repo` ya actualizó el HEAD, solo se hace el `reset --mixed`.
- **W2: no tocar el worktree.** El push queda limpio: solo viajan los objetos alcanzables desde
  `main` reescrita. Pero el historial viejo sigue en el `.git` local, mientras exista el worktree.
  La verificación se haría con `--single-worktree`. El criterio 14 queda parcial, y hay que
  declararlo.
- **Descartadas:** `git worktree remove` o borrar la carpeta, porque la spec las deja fuera de
  alcance. Reescribir en un clon `--mirror` aparte deja este repo local con el historial viejo y
  no cumple el criterio 15.

### 4.6 Ejecución
1. **Dry run**:
   ```bash
   git filter-repo --force --dry-run <mismos argumentos que el paso 2>
   ```
   - Revisar solo conteos en `.git/filter-repo/fast-export.filtered`, por ejemplo
     `grep -c '<REDACTED_JWT>' ...` y `grep -c -F -f "$RX/valores.txt" ...`, que debe dar 0.
   - No hacer `diff` a pantalla: mostraría los valores.
   - Al terminar, borrar `.git/filter-repo/fast-export.*`.
2. **Corrida real** (una sola invocación):
   ```bash
   git filter-repo --force \
     --invert-paths \
     --path seed.sql --path seed_activities.sql --path seed_psicolsa.sql --path seed_test_users.sql \
     --path truncate.sql --path generate_seed.py --path generate_seed_from_xlsx.py \
     --path-glob 'seed*.sql' --path-glob 'generate_seed*.py' \
     --path .claude/settings.local.json \
     --path docs/superpowers/ \
     --path .claude/worktrees/ \
     --path-regex '(^|/)\.env(\.(?!example$)[^/]*)?$' \
     --replace-text "$RX/replace-text.txt" \
     --replace-message "$RX/replace-message.txt"
   ```
   - Las rutas explícitas dejan auditable lo que se purga. Los globs son una salvaguarda.
   - `--path .claude/worktrees/` cubre el gitlink de `180f125`, `80de329` y `b689c80`.
   - La regex de `.env` excluye `.env.example`, que existe en C2.
   - `--prune-empty` queda en `auto`: se descarta `8a226bd`.
3. Guardar la salida: hashes viejo→nuevo en `.git/filter-repo/commit-map` y aviso de
   "Removing 'origin' remote".

### 4.7 Posproceso
```bash
# Worktree (si el PO eligió W1): pasos de 4.5
rm -f .git/FETCH_HEAD .git/ORIG_HEAD
git reflog expire --expire=now --all
git gc --prune=now
# Remoto (criterio 16): restaurar SIN fetch
git remote -v
git remote get-url origin 2>/dev/null || git remote add origin https://github.com/mzaracho/solidus.git
git config branch.main.remote origin
git config branch.main.merge refs/heads/main
```
**No ejecutar `git fetch`, `git pull` ni `git remote update`** hasta que se haga el force push.
Cualquiera de esos comandos trae de vuelta el `main` viejo desde GitHub a `refs/remotes/origin/main`,
con todos los secretos. Si pasa por error, borrar la ref
(`git update-ref -d refs/remotes/origin/main`) y repetir `reflog expire` + `gc`.

### 4.8 Verificación (criterios 14 y 15)
Cada comando tiene que dar el resultado indicado. Se informan conteos y códigos de salida, no
contenido.

| # | Comando | Esperado |
|---|---|---|
| V1 | `git rev-parse HEAD^{tree}` | Igual a `TREE_ANTES` (el árbol final no cambió) |
| V2 | `git rev-list --all --objects \| grep -cE ' (seed[^/]*\.sql\|truncate\.sql\|generate_seed[^/]*\.py\|\.claude/settings\.local\.json\|docs/superpowers(/\|$)\|\.claude/worktrees(/\|$))'` | 0 |
| V3 | `git log --all --format= --name-only \| sort -u \| grep -cE '^(seed.*\.sql\|truncate\.sql\|generate_seed.*\.py\|\.claude/settings\.local\.json\|docs/superpowers/\|\.claude/worktrees/)\|(^\|/)\.env$'` | 0 |
| V4 | `git grep -c -F -f "$RX/valores.txt" $(git rev-list --all)` | Sin salida, código 1 |
| V5 | `git grep -c -E 'eyJ[A-Za-z0-9_-]{10,}\.eyJ' $(git rev-list --all)` | Sin salida, código 1 |
| V6 | `git log --all -p \| grep -c -F -f "$RX/valores.txt"` y lo mismo con `-E 'eyJ[A-Za-z0-9_-]{10,}\.eyJ'` | 0 |
| V7 | `git log --all --format=%B \| grep -c -F -f "$RX/valores.txt"` | 0 |
| V8 | `git cat-file -e b689c80; git cat-file -e 8a226bd; git cat-file -e $BLOB_SEED_VIEJO; git cat-file -e $BLOB_SETTINGS_VIEJO` | Los cuatro fallan (objetos inexistentes) |
| V9 | `git fsck --full --unreachable --no-reflogs \| wc -l` y `git count-objects -v` | 0 inalcanzables, `garbage: 0` |
| V10 | `git worktree list`, `git -C "$WT" rev-parse HEAD`, `git -C "$WT" status --short \| head` | Con W1: HEAD del worktree = commit nuevo; solo aparecen archivos no trackeados |
| V11 | `git branch -a -vv` y `git remote -v` | `main` y las tres `claude/*` con hashes nuevos; `origin` configurado, sin `refs/remotes/origin/*` |
| V12 | `git status --porcelain` y `git status --ignored --porcelain \| grep '^!!'` | Sin cambios trackeados; aparecen como ignorados `.env`, `backend/.env`, `.claude/settings.local.json`, seeds, generadores y `docs/superpowers/` |
| V13 | `ls` o `test -f` de cada archivo local de 4.2 | Todos presentes; sumas iguales al backup |
| V14 | `cd backend && npx tsc --noEmit && npm test` y `cd frontend && npx tsc --noEmit` | Sin errores |
| V15 | `git ls-remote origin refs/heads/main` (solo lectura, no baja objetos) | Sigue en `b689c80...` (nadie pisó el remoto) |

Con W2, V4 a V9 se corren agregando `--single-worktree` donde aplique, y se declara la excepción.

Después de verificar, borrar `.git/filter-repo/` (contiene `commit-map` y `ref-map`, sin
secretos; se puede conservar hasta el push si se quiere trazabilidad).

### 4.9 Force push (documentado, NO se ejecuta)
Comando, cuando el usuario lo confirme:
```bash
git ls-remote origin refs/heads/main          # confirmar que sigue en b689c802168d51c14e0e14e2e33f353c63a61e64
git push --force-with-lease=refs/heads/main:b689c802168d51c14e0e14e2e33f353c63a61e64 origin main
git fetch origin && git branch -u origin/main && git status   # recién después del push
```
- **`--force-with-lease` con el hash explícito.** Como no hay ref de seguimiento local, el lease
  va contra el valor conocido del remoto. Si alguien empujó algo entre medio, el push se rechaza.
- **Solo se empuja `main`.** Las ramas `claude/*` no existen en el remoto y no deben subirse.
  Recomendación: borrarlas en local después del push, a decisión del usuario.
- **Qué implica:**
  - cambian todos los hashes: cualquier otro clon o fork queda divergente y hay que volver a
    clonarlo, no hacer `pull`;
  - GitHub puede seguir sirviendo los commits viejos por SHA, en caché, PR o forks, hasta su GC.
    Para una purga completa hay que pedírselo al soporte de GitHub (guía "Removing sensitive
    data from a repository") con la lista de SHA viejos de `commit-map`;
  - el historial viejo ya estuvo publicado (`origin/main = b689c80`): los valores deben
    considerarse expuestos. Ver R-10.

## 5. Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Unificar los dos `JwtModule` (dejar solo el global con `8h` y quitar el de `AuthModule`) | Sería viable: solo el login firma y los guards solo decodifican. Pero cambia de qué módulo resuelve `JwtService` `LoginQueryHandler`, y la spec pide no tocar código más allá del fallback. El helper común ya elimina la duplicación de la validación. La unificación conviene hacerla junto con S1 (verificar JWT), cuando se rediseñe la autenticación. |
| `ConfigModule.forRoot({ validate })` / Joi | Joi es una dependencia nueva. Un `validate` global invita a validar todo el `.env` y sale del alcance. |
| `ConfigService.getOrThrow('JWT_SECRET')` | Acepta la cadena vacía y su mensaje no dice dónde definir la variable. |
| Mover el `import 'dotenv/config'` antes de `bootstrap` en `main.ts` | Arregla H-1 solo en parte y sigue dependiendo de `process.env` en tiempo de decorador. `registerAsync` es el patrón que ya usa `app-module.ts`. |
| `env_file:` en los compose | En la raíz traería `DATABASE_URL` de localhost al contenedor. Las variables explícitas en `environment:` son más claras. |
| `expandVariables` en Nest para armar `DATABASE_URL` desde `POSTGRES_*` en `backend/.env` | Cambia la configuración de Nest y Prisma CLI la parsea distinto. El valor duplicado vive en un archivo local ignorado, así que no hay exposición. |
| BFG Repo-Cleaner | Necesita Java y no reemplaza mensajes de commit con la misma granularidad. `filter-repo` es la herramienta que recomienda Git y la que menciona la spec. |
| `git filter-branch` | Está deprecado, es lento y más propenso a errores. |
| Reescribir en un clon `--mirror` aparte | Deja el repo de trabajo con el historial viejo y no cumple el criterio 15 (ver 4.5). |
| Regex genéricas para contraseñas y URL en `--replace-text` | Matchean los placeholders legítimos de HEAD y cambiarían el árbol final (ver 4.4). |

## 6. Archivos a crear o modificar

**Crear:**
- `.env` (raíz, local, ignorado);
- `.env.example` (raíz);
- `backend/.env.example`;
- `backend/src/infrastructure.bootstrap/config/app/jwt-config.ts`;
- `backend/src/infrastructure.bootstrap/config/app/jwt-config.spec.ts`;
- `docs/features/002-sin-credenciales-en-repo/04-implementacion.md` y los demás informes del flujo;
- fuera del repo: `C:\Repositorios\_backup_git\002-redact\{replace-text,replace-message,valores}.txt`,
  el bundle y la copia de archivos locales.

**Modificar:**
- `docker-compose.yml` y `backend/docker-compose.yml`;
- `backend/.env` (local: agregar `JWT_SECRET` y `POSTGRES_*`);
- `backend/src/infrastructure.bootstrap/modules/app-module.ts` y
  `backend/src/infrastructure.bootstrap/modules/features/auth/auth-module.ts`;
- `.gitignore`, `backend/.gitignore` y `frontend/.gitignore`;
- `backend/.dockerignore` y `frontend/.dockerignore` (recomendado);
- `.claude/settings.json`;
- `docs/auditoria/COMANDOS.md` y `docs/auditoria/ESTADO.md` (valores);
- del documentador: `.claude/CLAUDE.md`, `docs/auditoria/ARQUITECTURA.md` y la sección 1 de
  `COMANDOS.md`.

**Quitar del índice, conservando en disco:** `.claude/settings.local.json` y `docs/superpowers/`.

**Borrar del índice y del disco:** las 14 carpetas de 3.6.

**No tocar:** `.claude/agents/`, `.claude/worktrees/` (salvo W1, metadatos en `.git/`),
`backend/src/api/main.ts`, los guards y `LoginQueryHandler`.

## 7. Modelos de datos y contratos
- Base de datos: sin cambios de schema ni migraciones.
- API HTTP: sin cambios. El login sigue firmando con `8h` y con el mismo payload.
- **Contrato de configuración (cambio incompatible a propósito):** `JWT_SECRET` pasa a ser
  obligatorio y de 32 caracteres o más, tanto en local como en Docker. Los compose exigen
  `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB` (y `JWT_SECRET` en el raíz). Los dos
  `.env.example` lo documentan.

## 8. Manejo de errores
| Situación | Comportamiento |
|---|---|
| Falta o está vacío `JWT_SECRET` (Nest) | `Error` en la factory del `JwtModule`. Nest lo registra y el proceso termina con código distinto de 0. El mensaje dice dónde definirla. |
| `JWT_SECRET` tiene menos de 32 caracteres | `Error` con la longitud mínima, sin mostrar el valor. |
| Falta una variable en un compose | `docker compose` falla antes de crear contenedores, con el mensaje de `:?`. |
| `filter-repo` falla a mitad de camino | No toca refs hasta el final. Si quedó un estado dudoso, restaurar desde el bundle (4.2). |
| La verificación V1 da un árbol distinto | **No seguir.** Algún reemplazo afectó HEAD: identificar la regla (`git diff TREE_ANTES HEAD --stat`, sin `-p` en pantalla), corregirla y restaurar desde el bundle para repetir. |
| V4 a V8 encuentran restos | Revisar W1, `refs/remotes`, `FETCH_HEAD`, reflogs y stash. Repetir 4.7. |

## 9. Rendimiento y compatibilidad
- Rendimiento: sin impacto en runtime. La validación corre una vez, al arrancar.
- **Sesiones.** Los tokens firmados con el fallback siguen siendo aceptados, porque los guards
  hacen `decode` sin verificar (S1, fuera de alcance). No hay corte de sesiones. Cuando se arregle
  S1, esos tokens dejarán de valer.
- **Volúmenes de Postgres.** Se conservan las credenciales actuales: no hay que reinicializar.
- **Desarrolladores con un clon existente.** Después del push tienen que volver a clonar y crear
  sus `.env` a partir de los ejemplos. Los seeds no vienen en el clon.
- **Docker.** `docker compose up --build -d` necesita el `.env` raíz. Sin él, el arranque falla
  con un mensaje claro.

## 10. Plan de implementación en pasos chicos

**Fase A** (desarrollador). Al final de cada paso, verificar.
1. Commit C1 (3.0), si el PO lo aprueba (D-3).
2. Agregar las reglas al `.gitignore` raíz y `!.env.example` en backend y frontend. Verificar con
   `check-ignore` (3.4).
3. Correr `git rm --cached .claude/settings.local.json` y `git rm -r --cached docs/superpowers`.
   Verificar `git ls-files -ci --exclude-standard`, que debe quedar vacío.
4. Correr `git rm -r` de los 14 skills. Verificar `ls .claude/skills` y que `.claude/agents`
   siga intacto.
5. Crear el `.env` raíz y completar `backend/.env` (3.1). Crear los dos `.env.example`.
6. Editar los dos compose. Verificar con `docker compose config --quiet`, la prueba negativa y
   `docker compose up -d db` en `backend/` (el volumen existente levanta y acepta login).
7. Crear `jwt-config.ts` y su spec, y adaptar los dos módulos. Verificar con `npx tsc --noEmit`,
   `npx eslint` sobre los cuatro archivos y `npm test`.
8. Prueba manual: `npm run start:dev` con el `.env` completo levanta y el login devuelve un
   token. `JWT_SECRET= npm run start:dev` falla con el mensaje (la variable vacía del shell tiene
   precedencia y no se edita el `.env`).
9. `.dockerignore` (recomendado). Opcional: `docker compose build backend`.
10. Limpiar los valores de `COMANDOS.md` y `ESTADO.md`.
11. Limpiar `.claude/settings.json` (3.5).
12. Barrido 3.8 y lista de falsos positivos en `04-implementacion.md`.

**Fase B** (desarrollador, después del revisor). Seguir 4.0 a 4.8 en orden: precondiciones,
instalación, C2, backup, archivos de expresiones, control de colaterales, dry run, corrida real,
posproceso (W1 si se aprueba), restauración de `origin` y verificación V1 a V15. Si algo no da lo
esperado, parar y reportar al PO.

## 11. Riesgos
| # | Riesgo | Mitigación |
|---|---|---|
| R-1 | `reset --hard` de `filter-repo` borra archivos locales que seguían trackeados | Precondición 4.0.4 y copia de los archivos locales en 4.2 |
| R-2 | Un reemplazo cambia el árbol final (por ejemplo, rompe el compose) | Literales en lugar de regex, control de colaterales, dry run y V1 (igualdad de árbol) |
| R-3 | Archivo de expresiones con BOM o CRLF: los reemplazos fallan sin aviso y las verificaciones con `grep -f` dan falsos negativos | Reglas de formato de 4.4 y su comprobación. Un control positivo antes del rewrite: `git grep -c -F -f valores.txt $(git rev-list --all)` **sí** tiene que encontrar coincidencias |
| R-4 | El worktree mantiene vivo el historial viejo | W1 (D-1) |
| R-5 | Un `git fetch` posterior reintroduce el historial viejo | Advertencia de 4.7. Lease con hash explícito |
| R-6 | `docker compose` no parsea `backend/.env` por las líneas con espacios alrededor de `=` | Validar con `config --quiet`. Si falla, normalizar esas líneas a `CLAVE=valor`: no cambia la semántica para dotenv ni para Nest |
| R-7 | El harness vuelve a escribir comandos con tokens en `.claude/settings.json` | Re-barrido antes de C2, de C3 y del push. Documentar en `CLAUDE.md` (documentador) que los permisos "siempre" con credenciales van a `settings.local.json` |
| R-8 | Los informes 06 a 09 se escriben después del rewrite y podrían copiar valores | Barrido 3.8 obligatorio antes de C3. Seguridad y tester citan por archivo y línea, nunca por valor |
| R-9 | Los repos `solidus-backend` y `solidus-frontend` en GitHub, y sus copias en `_backup_git/`, tienen los mismos secretos en su historial | Fuera del alcance de este repo. El PO decide si se archivan, se hacen privados, se borran o se reescriben (D-2) |
| R-10 | El historial viejo ya estuvo en GitHub | Recomendar rotar la contraseña de Postgres local y las de los usuarios de prueba, aunque la spec lo deja fuera, y pedir la purga a GitHub después del push |
| R-11 | `filter-repo` no queda en el PATH en Windows | Ver 4.1 |
| R-12 | El backup y los archivos de expresiones contienen los secretos | Fuera de todo repo. Se borran cuando el usuario cierre el push |

## 12. Estrategia de tests

**Unitarios (Jest, nuevo `jwt-config.spec.ts`).** Son los primeros tests del backend; `npm test`
deja de fallar con "No tests found".
- `getRequiredJwtSecret`: lanza error con `undefined`, con `''` y con `'   '`; lanza el error de
  longitud con 31 caracteres; devuelve el valor con 32.
- Los mensajes de error no contienen el valor recibido.
- Integración liviana con `@nestjs/testing`:
  - `Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), JwtModule.registerAsync(jwtModuleAsyncOptions('8h'))] }).compile()`;
  - sin `JWT_SECRET`, `compile()` se rechaza con el mensaje. Guardar `process.env.JWT_SECRET`,
    borrarlo y restaurarlo en `afterEach`;
  - con un secreto de prueba ficticio de 32 caracteres o más, `JwtService.sign` y `verify`
    funcionan, y `exp - iat` da `8 * 3600`.

**Estáticos:** `npx tsc --noEmit` en backend y frontend, y `npx eslint` sobre los archivos tocados,
sin errores nuevos.

**Manuales (tester):**
- arranque con y sin `JWT_SECRET`;
- login real en local;
- `docker compose config --quiet`, la prueba negativa y el arranque de `db` con el volumen
  existente;
- `docker compose up --build -d` en la raíz, si el entorno lo permite;
- `check-ignore` y `ls-files` de 3.4;
- barrido 3.8;
- para la fase B, la tabla V1 a V15 completa.
El tester **no** ejecuta seeds ni `TRUNCATE`.

## 13. Decisiones que el PO debe tomar antes de la fase B
- **D-1 Worktree:** aprobar W1, que re-apunta HEAD e índice en `.git/worktrees/...` sin tocar la
  carpeta, o elegir W2, que lo deja intacto y deja el historial viejo local. Recomendación: W1.
- **D-2 Repos viejos `solidus-backend` y `solidus-frontend` en GitHub:** quedan fuera de este
  feature, pero contienen el secreto de fallback y la contraseña del compose en su historial.
  Sin tratarlos, el objetivo de "ninguna clave en GitHub" no se cumple del todo. Decidir si se
  hacen privados, se archivan, se borran o van a un feature aparte.
- **D-3 Commit C1 al inicio de la fase A:** confirmar. Si no se aprueba, C2 incluye los dos features.
- **D-4 Reemplazo de UUID de `settings.json` en el historial y `--replace-message` con el nombre:**
  recomendado. Confirmar si ese nombre corresponde a una persona real, para la regla 3.

La spec es viable y coherente con la arquitectura. Los puntos anteriores son decisiones operativas
que la propia spec anticipa ("si bloquea la reescritura, se informa al PO") y no la invalidan.

VEREDICTO: APROBADO
