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

---

# FASE B — reescritura del historial (criterios 11 a 16)

> Sin valores secretos. **No se hizo push.** Este archivo se modificó después de C2 y queda sin
> commitear (para el commit C3 posterior a la reescritura).

## B.1 Correcciones previas (05-revision.md)
- **M-1:** `.claude/settings.json` quedó con `"agent": "po"`, `additionalDirectories` y
  `permissions.allow` vacío. Las 18 entradas que tenía (incluidas `Read(//c/Repositorios//**)`,
  `Bash(git filter-repo *)` y las que mencionaban `_backup_git` y `valores.txt`) se movieron a
  `.claude/settings.local.json` (ignorado), sin duplicar ni borrar nada.
  - El harness volvió a agregar permisos a `settings.json` varias veces durante la fase B (cada
    comando aprobado). Cada vez se movieron a `settings.local.json` y se restauró el archivo con
    `git checkout -- .claude/settings.json`, antes de C2 y antes de `filter-repo`. Sigue pasando
    mientras se aprueben comandos: **volver a verificar `git status` antes de C3 y del push**.
- **M-3:** frase de `docs/auditoria/ESTADO.md` corregida como sugería la revisión.
- **M-4:** `git add` explícito de los archivos de la fase A y de `docs/features/002-.../` (01, 03, 04
  y 05). Quedaron en C2.
- Barrido con `valores.txt` sobre todo lo que fue a C2 (`git diff --cached` en líneas agregadas,
  `git grep --cached`, archivos del feature y `settings.json`): **0 coincidencias**. Regex de JWT
  (`eyJ...eyJ`) sobre `git ls-files`: 0.

## B.2 Decisiones aplicadas
- **D-1 = W1:** el HEAD del worktree ya fue re-apuntado por `filter-repo` a la rama reescrita
  (`0590c8c`). Solo hizo falta `git -C <worktree> reset --mixed` para reescribir su índice. La
  carpeta del worktree no se tocó: las sumas SHA-256 de sus 63 archivos son idénticas antes y
  después. Los seeds se ven como no trackeados dentro del worktree.
- **D-3:** C1 ya existía (`edb234d`, hoy `252f459`).
- **D-4 = sí:** se reemplazaron en el historial el nombre del mensaje de `8a226bd`
  (`--replace-message`) y los 3 UUID de `settings.json` (organización, usuario y paciente).
  - Los UUID **no aparecen** en ningún archivo del árbol de HEAD (`git grep` con `valores.txt` sobre
    HEAD: código 1), así que se podían reemplazar.
  - El nombre solo aparecía en rutas purgadas y en ese mensaje.
- `8a226bd` quedó vacío y `filter-repo` lo descartó (de 10 commits a 9). Las tres ramas `claude/*`
  apuntan ahora a `0590c8c` (la reescritura de `88327f2`).

## B.3 Archivos de expresiones y backup (fuera del repo)
Carpeta `C:\Repositorios\_backup_git\`. **Contiene secretos: no subir ni compartir; borrar cuando el
usuario cierre el push y la limpieza en GitHub.**
- Bundle: `C:\Repositorios\_backup_git\healthops-gem-2026-10-26-pre-002.bundle`
  (`git bundle verify` OK: "records a complete history"; 7 heads listadas).
- Copia completa de `.git` previa: `C:\Repositorios\_backup_git\healthops-gem-2026-10-26-pre-002.git-dir`.
- Archivos locales: `C:\Repositorios\_backup_git\healthops-gem-2026-10-26-pre-002-local\`
  (`.env` raíz y de backend, `settings.local.json`, `docs/superpowers`, seeds, `truncate.sql`,
  generadores).
- Expresiones: `C:\Repositorios\_backup_git\002-redact\{replace-text,replace-message,valores}.txt`.
  UTF-8 sin BOM, LF, sin comentarios ni líneas vacías (verificado). `replace-text.txt` tiene 9 reglas
  (JWT por regex, contraseña de Postgres, secreto de fallback, 2 contraseñas de usuarios de prueba,
  correo de aspecto real, UUID de org, usuario y paciente). `valores.txt` pasó de 9 a 13 valores:
  la fase A no había incluido las contraseñas de prueba, el correo ni el nombre, y se completaron
  relevándolos del historial con un script (sin imprimirlos).
- Control de colaterales previo: cada literal aparece solo en rutas de credenciales (compose,
  `ESTADO.md`, `COMANDOS.md`, `auth-module.ts`, `settings*.json`) o en rutas purgadas. Ninguno en
  código o `package-lock.json`. Control positivo: `git grep -F -f valores.txt` encontraba valores
  en 85 pares revisión/ruta antes de reescribir.

## B.4 Hashes antes y después
| | Antes | Después |
|---|---|---|
| HEAD de `main` | `6b8548031b2b1f588d392aa95728f311fef135ff` | `063950508343d337459708ad707b73f98ed14754` |
| Árbol de HEAD | `71df27f62c66c375a7bc90ee750282902d1c53a7` | `71df27f62c66c375a7bc90ee750282902d1c53a7` (**igual**) |
| Commits (`rev-list --all`) | 10 | 9 |
| Ramas `claude/*` | `8a226bd` | `0590c8c` |
| `origin/main` (ref local) | `b689c80` | eliminada (sin fetch) |

El mapeo viejo→nuevo (`.git/filter-repo/commit-map`) se borró al terminar; los SHA viejos se pueden listar desde el bundle del backup. Los hashes de
`main` de arriba cambiarán si se hace un commit C3 encima.

## B.5 Precondiciones y corrida
- Ruta purgada trackeada en HEAD: 0. Valores o JWT en HEAD: 0 (código 1).
- Archivos locales presentes antes y después: `.env`, `backend/.env`, `settings.local.json`, 5 seeds,
  `truncate.sql`, 2 generadores y los 8 archivos de `docs/superpowers/` (17 sumas SHA-256 idénticas;
  `settings.local.json` difiere solo porque recibió los permisos de M-1, y es superconjunto del
  backup).
- Dry run: sin errores. En `fast-export.filtered` el único valor que seguía apareciendo era el
  nombre, y solo dentro de blobs de archivos purgados (que el export incluye aunque no los
  referencie ningún commit). Se comprobó en el historial que el nombre no estaba en ninguna ruta no
  purgada. Se borró `.git/filter-repo/` antes de la corrida real.
- Una sola corrida real con `--invert-paths`, `--replace-text` y `--replace-message`
  (argumentos del diseño 4.6). Aviso esperado: "Removing 'origin' remote".

## B.6 Verificación (solo conteos)
| # | Verificación | Resultado |
|---|---|---|
| V1 | árbol de HEAD | igual al previo |
| V2 | `rev-list --all --objects` con rutas purgadas | 0 |
| V3 | `log --all --name-only` con rutas purgadas | 0 |
| V4 | `git grep -F -f valores.txt` sobre todas las revisiones | código 1 (sin coincidencias) |
| V5 | regex JWT sobre todas las revisiones | código 1 |
| V6 | `git log --all -p` con valores / con regex JWT | 0 / 0 |
| V7 | mensajes de commit con valores | 0 |
| V8 | objetos `b689c80`, `8a226bd`, blob del seed viejo y blob del settings viejo | los 4 no existen |
| V9 | inalcanzables (`fsck --unreachable --no-reflogs`) y `garbage` | 0 y 0 (569 objetos en pack) |
| V10 | worktree | HEAD `0590c8c`; 2 modificados y 5 no trackeados (los seeds); archivos intactos |
| V11 | ramas y remotos | `main` y 3 `claude/*` con hashes nuevos; sin `refs/remotes/*`; `origin` configurado |
| V12 | `git status` | sin cambios trackeados; ignorados: `.env`, `backend/.env`, `settings.local.json`, `docs/superpowers/`, seeds, generadores |
| V13 | archivos locales | presentes, sumas iguales (salvo `settings.local.json`, ver B.5) |
| V14 | `tsc --noEmit` backend y frontend; `jest` backend | 0 errores; 7 de 7 tests pasan |
| V15 | `git ls-remote origin` (solo lectura) | **inconcluyente**: sale con código 0 pero sin listar ninguna ref (ver B.9) |
| — | reflog, stash, `FETCH_HEAD`, `ORIG_HEAD` | 0 líneas de reflog, 0 stash, ninguno de los dos archivos |
| — | `.git` contiene `8a226bd` o `b689c80` | nada (se borró `.git/filter-repo/`) |

## B.7 Estado de `origin` y del worktree
- `origin` restaurado a `https://github.com/mzaracho/solidus.git` (fetch y push) con
  `git remote add`, y `branch.main.remote` y `branch.main.merge` reconfigurados. **No se ejecutó
  fetch, pull ni `remote update`.** `git branch -vv` muestra `[origin/main: gone]`, esperado.
- Worktree `.claude/worktrees/bold-meninsky-a75726`: registrado, HEAD detached en `0590c8c`, carpeta
  intacta. No se borró ni se movió.

## B.8 Force push pendiente (NO ejecutado, requiere confirmación del usuario)
```bash
git ls-remote origin refs/heads/main          # confirmar que sigue en b689c802168d51c14e0e14e2e33f353c63a61e64
git push --force-with-lease=refs/heads/main:b689c802168d51c14e0e14e2e33f353c63a61e64 origin main
git fetch origin && git branch -u origin/main && git status   # recién después del push
```
- Solo se empuja `main`; las `claude/*` no existen en el remoto y no deben subirse.
- Cambian todos los hashes: otros clones o forks quedan divergentes y hay que volver a clonar.
- GitHub puede seguir sirviendo los commits viejos (caché, PR, forks) hasta su GC; para una purga
  completa hay que pedirlo al soporte de GitHub con los SHA viejos (listables desde el bundle).
- El historial viejo ya estuvo publicado: los valores deben considerarse expuestos. Se recomienda
  rotar la contraseña de Postgres y las de los usuarios de prueba (fuera de alcance).
- **Antes del push:** `git status` limpio, re-barrer `settings.json` y barrer con `valores.txt` los
  archivos de C3.

## B.9 Dudas y desvíos de la fase B
1. **`git ls-remote origin` no devolvió refs** (código 0, salida vacía), ni con el patrón de `main`
   ni sin él. Puede ser que el repo sea privado y no haya credenciales cargadas, o que el remoto
   esté vacío o no exista. Con `--force-with-lease` con hash explícito el push se rechazaría si
   `main` en GitHub no está en `b689c80`. Antes de pushear, que el PO o el usuario verifique el
   remoto (por ejemplo `git ls-remote` con sus credenciales, o la web de GitHub).
2. `valores.txt` no incluía todos los valores que enumera el diseño (4.4); se completó. Conviene que
   seguridad revise si hay otras contraseñas de prueba fuera de los patrones que usé
   (`"password":`, `PGPASSWORD=`, `password = '...'`, URL con clave y correos).
3. Se reemplazaron como contraseñas de prueba solo 2 literales y como correo uno. Los demás
   correos de los seeds (usuarios de prueba) no se reemplazaron: no son secretos y solo existían en
   rutas purgadas. Los 3 que aparecen en `COMANDOS.md` siguen en HEAD y el árbol no cambió.
4. Los hashes bcrypt de `PASSWORD_HASH` de los seeds se purgaron junto con los seeds; no se
   incluyeron como valores.
5. Los backups (`_backup_git`) contienen todos los secretos viejos y los `solidus-backend.git` /
   `solidus-frontend.git` previos también (D-2 sigue abierta).

---

# Cierre: noreply, C3 y push

- **Correo:** `user.email` a nivel repo (no global) con el correo `noreply` de GitHub
  (`<id>+mzaracho@users.noreply.github.com`, id obtenido de la API pública). `user.name` sin cambios.
- **Revisión previa:** `settings.json` quedó con `allow` vacío (los permisos nuevos del harness se
  movieron a `settings.local.json`, ignorado). `COMANDOS.md` ya no fija el número de tests.
- **C3:** `2fd0876` antes del mailmap, `305de5c` después. Barrido del stage: 0 coincidencias con
  `valores.txt`; los patrones genéricos solo coinciden con texto que describe el patrón.
- **Reescritura de autor/committer** con `git filter-repo --mailmap` (archivo fuera del repo):

  | Commit | Antes | Después |
  |---|---|---|
  | C1 (001) | `252f459` | `cc8246f` |
  | C2 (002) | `0639505` | `312dfb8` |
  | C3 | `2fd0876` | `305de5c` |

  Verificado: ningún commit conserva el correo anterior, el árbol de HEAD es idéntico
  (`6171c85`), los archivos locales siguen en disco y `valores.txt` da 0 en `git rev-list --all`
  y en los mensajes. El worktree `bold-meninsky-a75726` pasó por `reset --mixed`. `origin` se
  restauró porque filter-repo lo quita. Bundle previo en `C:\Repositorios\_backup_git\pre-mailmap.bundle`.
- **Push:** `git push -u origin main` sin force, solo `main`, sin fetch previo: exitoso (rama nueva en
  un remoto vacío). `git ls-remote origin` muestra `main` en `305de5c`, igual al HEAD local, y la
  rama trackea `origin/main`.
