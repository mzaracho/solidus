# 04 — Implementación: 002-sin-credenciales-en-repo (FASE A)

> Este informe no contiene valores secretos. Solo se implementó la fase A (criterios 1 a 10).
> No se hizo la fase B (sin filter-repo, sin backup, sin reescritura), ni push, ni commit de la
> fase A. Los cambios quedan en el working tree y en el índice para el revisor.

## 1. Commit del feature 001 (C1)
- Hash: `edb234d` — `chore(001): sacar seeds y datos de prueba del control de versiones`. Local, sin push.
- 19 archivos:
  - bajas de `seed.sql`, `seed_activities.sql`, `seed_psicolsa.sql`, `seed_test_users.sql`,
    `truncate.sql`, `generate_seed.py`, `generate_seed_from_xlsx.py` y del gitlink
    `.claude/worktrees/bold-meninsky-a75726`;
  - `.gitignore`, `backend/.gitignore`, `frontend/.gitignore`;
  - `docs/auditoria/COMANDOS.md`;
  - `docs/features/001-gitignore-seeds/` (7 archivos).
- Excluido, según D-3: `.claude/settings.json` (contenía JWT, así que se limpió en esta fase) y
  `docs/features/002-*`.
- Nota: `COMANDOS.md` en C1 todavía tiene la contraseña de Postgres. Ya estaba en `HEAD` y no suma
  exposición nueva. Se limpia en esta fase (ver 2) y la fase B la purga del historial. No había
  forma de separarlo sin mezclar los dos features.

## 2. Archivos modificados en la fase A
Todos los diffs se ven con `git diff HEAD` (partiendo de C1). Los archivos nuevos están marcados con
`git add -N` (intent-to-add) para que aparezcan en el diff. No hay contenido staged salvo las bajas.

**Creados**
- `.env.example` y `backend/.env.example`: contenido del diseño 3.1, con `change-me`.
  `JWT_SECRET=change-me` tiene menos de 32 caracteres a propósito.
- `backend/src/infrastructure.bootstrap/config/app/jwt-config.ts`: `getRequiredJwtSecret` y
  `jwtModuleAsyncOptions`, tal como en el diseño 3.3. El parámetro está tipado como
  `JwtSignOptions['expiresIn']`.
- `backend/src/infrastructure.bootstrap/config/app/jwt-config.spec.ts`: 7 tests (ver 3).

**Modificados**
- `docker-compose.yml` (raíz): `POSTGRES_*` y `DATABASE_URL` con `${VAR:?mensaje}` entre comillas
  dobles, y se agregó `JWT_SECRET` al servicio `backend`.
- `backend/docker-compose.yml`: `POSTGRES_*` con `${VAR:?mensaje}` que remite a `backend/.env`.
- `backend/src/infrastructure.bootstrap/modules/app-module.ts`: usa `jwtModuleAsyncOptions('1d')` y
  se quitó el import duplicado de `ConfigService`.
- `backend/src/infrastructure.bootstrap/modules/features/auth/auth-module.ts`:
  `JwtModule.registerAsync(jwtModuleAsyncOptions('8h'))`. Sin secreto de fallback.
- `.gitignore`: reglas `.env`, `.env.*`, `!.env.example`, `.claude/settings.local.json` y
  `docs/superpowers/`. `backend/.gitignore` y `frontend/.gitignore`: `!.env.example`.
- `backend/.dockerignore`: `.env`, `.env.*`, `!.env.example`. `frontend/.dockerignore`: `.env*`,
  `!.env.example`.
- `docs/auditoria/COMANDOS.md`: se sacó la credencial de la línea del compose y el bloque del `.env`
  usa placeholders. `JWT_SECRET` figura como obligatorio. `docs/auditoria/ESTADO.md`: se sacó el valor
  del fallback.
- `.claude/settings.json`: se quitaron las entradas con credenciales y también los `curl` y los
  patrones que contenían valores (ver 5, desvío 3).

**Quitados del índice, conservados en disco**
- `.claude/settings.local.json` y `docs/superpowers/` (8 archivos).

**Borrados del índice y del disco**
- Las 14 carpetas de `.claude/skills/` (y la carpeta `skills/`). `.claude/agents/`,
  `.claude/CLAUDE.md`, `.claude/launch.json` y `.claude/worktrees/` no se tocaron.

**Locales ignorados (no versionados)**
- `.env` (raíz), nuevo: `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB` con los valores actuales
  de los compose (copiados por script, sin imprimirlos) y un `JWT_SECRET` aleatorio de 32 bytes
  (64 caracteres hex).
- `backend/.env`: se agregaron `JWT_SECRET` (otro aleatorio de 32 bytes) y `POSTGRES_*`. Las líneas
  existentes no se modificaron.
- Fuera del repo: `C:\Repositorios\_backup_git\002-redact\valores.txt` (lista de valores sensibles
  para los barridos). Contiene secretos y no se imprime. Es el primer archivo de la fase B y se
  crea ahora porque el barrido 3.8 lo necesita.

## 3. Verificaciones y resultados
| Verificación | Resultado |
|---|---|
| `git commit` C1 | `edb234d`, 19 archivos |
| `git check-ignore -v` de `.env`, `backend/.env`, `docs/superpowers/...` | Cada ruta tiene regla |
| `git check-ignore -v --no-index .claude/settings.local.json` | Regla `.gitignore:27` |
| `git check-ignore -v --no-index .env.example backend/.env.example frontend/.env.example` | Solo la regla de negación `!.env.example` (no quedan ignorados) |
| `git ls-files -ci --exclude-standard` | 0 líneas |
| `docker compose config --quiet` en la raíz y en `backend/` | Código 0. Solo avisa que `version` está obsoleto (preexistente). `backend/.env` con espacios alrededor de `=` no es un problema (R-6 descartado) |
| Prueba negativa con `--env-file` vacío, en los dos compose | Falla con el mensaje de `:?` para cada variable (`POSTGRES_*` y `JWT_SECRET`). Las variables no estaban exportadas en el shell |
| `npx tsc --noEmit` backend | 0 errores |
| `npx tsc --noEmit` frontend | 0 errores |
| `npx eslint` sobre los 4 archivos tocados o nuevos del backend | 0 errores. Hubo uno de prettier en `auth-module.ts` (el formato de `imports`) y se corrigió |
| `npx jest` (backend) | 1 suite, 7 tests pasan. Son los primeros tests del backend |
| `JWT_SECRET= npx nest start` | Falla con código 1 y el mensaje "JWT_SECRET is not defined. Set it in backend/.env (local) or in the root .env (Docker Compose). See .env.example." El mensaje se ve en consola |
| `nest start` con el `.env` completo | Pasa la inicialización de los `JwtModule`. Se corta después porque la base no está levantada en `localhost:5433`. No se probó el login ni `docker compose up` (ver 6) |
| Barrido 3.8, patrones fuertes (`eyJ`, `PGPASSWORD=`, URL con usuario y clave, `Bearer`) sobre `git ls-files` | Solo coinciden `postgresql://change-me:change-me@...` (placeholder de `backend/.env.example`) y las líneas de 03-diseno-tecnico.md que describen el propio barrido |
| Barrido con `valores.txt` (`grep -F -f`) sobre archivos versionados y nuevos | Sin coincidencias |
| Barrido de correos (`@gmail`, `@hotmail`, `@outlook`, `@yahoo`) | Sin coincidencias |
| Barrido de `.claude/settings.json` (`eyJ`, `Bearer`, `x-org`, `curl`, valores conocidos) | Sin coincidencias |

## 4. Falsos positivos del barrido (palabras `password`, `secret`, `token`, `bearer`)
- Código de login y auth: `login-query-handler.ts`, `login-response-dto.ts`, `auth-controller.ts`,
  guards, `verify-token-*`, `i-verify-token-service.ts` y `auth-guard-provider.ts`. Son nombres de
  campos y lógica.
- `schema.prisma` y la migración `init_auth` (`passwordHash`).
- Frontend: `login/page.tsx`, `page.tsx`, `middleware.ts`, `Sidebar.tsx`, `providers.tsx` y
  `services/data.ts` (manejo de la cookie `auth_token`).
- `jwt-config.ts` y `jwt-config.spec.ts`: nombre `JWT_SECRET` y secretos de prueba generados en
  runtime (`'x'.repeat(n)`).
- Documentación: README, `API_DOCUMENTATION*.md` y `OVERVIEW_ES.md` ("Bearer token", "tokens de
  acceso"). `docs/auditoria/{ARQUITECTURA,BACKLOG,COMANDOS,ESTADO}.md` hablan de `JWT_SECRET` y de
  tokens sin valores.
- `.claude/CLAUDE.md` (regla 3) y `.claude/agents/{seguridad,ux-ui}.md`: la frase "secretos, tokens".
- Los `.env.example`, `docker-compose.yml` y `backend/docker-compose.yml`: nombres de variable y
  `${...}`.
- Informes de los features 001 y 002: citan los patrones de búsqueda y no valores.
- `myuser` (usuario de Postgres, no es un secreto) sigue en comandos `psql -U myuser` de
  `.claude/CLAUDE.md`, `ARQUITECTURA.md`, `COMANDOS.md`, `CLAUDE.borrador.md` y
  `backend/prisma/seed.ts`. El diseño 3.7 lo permite. Los dos primeros los actualiza el documentador.

## 5. Desvíos del diseño y decisiones
1. **C1 incluye `COMANDOS.md` con la contraseña de Postgres que ya estaba en `HEAD`.** Es lo que
   dice el diseño 3.0. La alternativa era dejar `COMANDOS.md` fuera de C1, pero habría mezclado los
   dos features en el diff. La fase B lo purga con `--replace-text`. Decisión del PO si prefiere otra.
2. **Se perdió y se reconstruyó parte de `.claude/settings.json` por un error mío.**
   - Ejecuté `git stash` sin intención durante una verificación, y para recuperar el estado hice
     `git checkout -- .claude/settings.json` y `git stash pop --index`.
   - Todo el resto del trabajo se recuperó (stash vacío, índice y working tree verificados). El
     `settings.json` que tenía el PO antes de que yo empezara, con cambios sin commit, se
     descartó.
   - Lo reconstruí a partir del volcado que leí al inicio: `additionalDirectories` y `"agent": "po"`,
     más las entradas sin credenciales. Los patrones de grep con sintaxis compleja no se pudieron
     transcribir y se dejaron fuera.
   - Si el PO tiene una copia con permisos que quiera conservar, los agrega a
     `.claude/settings.local.json`.
3. **`settings.json`: se quitaron también patrones `grep`/`xargs` y entradas que mencionaban
   valores conocidos** (porque contenían literales sensibles) además de los `curl` con token. El
   diseño pedía quitar solo los curl. El resultado final tiene 12 entradas `Bash(...)`/`Read(...)`
   sin credenciales.
   - Siguen siendo permisos amplios: `Bash(git filter-repo *)` y `Read(//c/Repositorios//**)`. Ya
     estaban, y el PO decide si los deja.
   - El harness volvió a agregar entradas durante mi trabajo (H-13, R-7). Se limpiaron
     las que sumé yo (`git stash *`, `git checkout *`, `python -`). Re-barrer `settings.json` antes
     de C2.
4. **Archivos nuevos con LF.** Los archivos del repo se ven como CRLF en el working tree (autocrlf).
   Los nuevos que escribí con LF (`jwt-config*.ts`) quedan igual en el índice (LF). A los editados
   a mano les preservé CRLF.
5. **No hice `docker compose up -d db` ni el login real.** Postgres no está levantado, y el diseño lo
   marca como verificación del tester. No se tocó ningún dato.
6. `valores.txt` se creó fuera del repo en la fase A (el diseño lo ubica en la fase B).

## 6. Cómo probarlo
1. `git diff HEAD --stat` y `git status`: deben aparecer los archivos de la sección 2. `.env`,
   `backend/.env`, `.claude/settings.local.json` y `docs/superpowers/` no deben aparecer.
2. En la raíz y en `backend/`, `docker compose config --quiet` debe dar código 0. Con
   `--env-file <archivo vacío fuera del repo>` debe fallar con el mensaje de `:?`.
3. `cd backend`:
   - `npx tsc --noEmit` y `npx jest`;
   - `JWT_SECRET= npx nest start` debe fallar con el mensaje claro;
   - con la base levantada (`docker compose up -d` en `backend/`), `npm run start:dev` y el login
     deben funcionar.
4. Barrido: `git ls-files -z | xargs -0 grep -InE 'eyJ[A-Za-z0-9_-]{10,}\.|PGPASSWORD=[^.<$ ]|Bearer [A-Za-z0-9]{10,}'`
   debe salir sin resultados. La URL del `.env.example` que aparece es un placeholder.

## 7. Dudas pendientes
- D-2 (repos viejos `solidus-backend` y `solidus-frontend`): queda para el usuario.
- Los permisos `git filter-repo *` y `Read(//c/Repositorios//**)` de `settings.json`: ¿se mantienen?
- Fase B: antes de C2 hay que re-barrer `settings.json` y confirmar el estado de `.claude/worktrees/`
  (el HEAD del worktree sigue en `8a226bd`).
- Los permisos "siempre" del harness con credenciales deberían ir a `settings.local.json`. El
  documentador tiene que dejarlo en `CLAUDE.md`.
