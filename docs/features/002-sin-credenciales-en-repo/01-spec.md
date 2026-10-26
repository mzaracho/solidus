# 002 — Ninguna credencial en el repo (ni en el historial)

## Contexto
Después del feature 001 (seeds fuera de git), la revisión de seguridad encontró credenciales
versionadas. El usuario decidió que **ninguna clave puede subirse a GitHub**, ni siquiera las de
prueba o desarrollo. Las credenciales tienen que vivir solo en archivos locales que git ignore.

Datos del repo:
- Hay un **único repo git**, el raíz, con remoto `origin` → `https://github.com/mzaracho/solidus.git` y
  rama `main`. `backend/` y `frontend/` son carpetas comunes desde el commit `b689c80`, no repos
  independientes como dice `CLAUDE.md`.
- Los cambios del feature 001 están en el working tree y en el índice, **sin commit**.

Inventario de credenciales (relevado por el PO, no exhaustivo; el desarrollador debe barrer de nuevo):

| Dónde | Qué |
|---|---|
| `.claude/settings.json` líneas 4-17 | permisos `Bash(curl ...)` con un JWT completo, `x-org-id` y `x-user-id` |
| `.claude/settings.local.json` | otro JWT, curl de login con contraseñas, `PGPASSWORD=...`; está versionado aunque el `.gitignore` lo cubre |
| `docker-compose.yml` (raíz) líneas 8-10 y 24 | usuario y contraseña de Postgres, y `DATABASE_URL` con la contraseña |
| `backend/docker-compose.yml` líneas 7-9 | usuario y contraseña de Postgres |
| `backend/src/infrastructure.bootstrap/modules/features/auth/auth-module.ts:12` | secreto JWT de fallback hardcodeado |
| `docs/auditoria/COMANDOS.md` líneas 22 y 53 | contraseña de Postgres |
| `docs/superpowers/plans/2026-04-22-multi-org-professional.md:139` | correo de aspecto real y contraseña en un curl |
| `docs/auditoria/RIESGOS.md`, `ESTADO.md` | citan contraseñas de prueba y el secreto de fallback (RIESGOS está ignorado; verificar si estuvo versionado alguna vez) |
| Historial git | todo lo anterior, más los seeds del feature 001 (que incluyen usuarios de prueba con contraseña) |

## Decisiones del usuario (2026-10-26)
1. `docs/superpowers/` sale de git pero **se conserva en disco** (ignorada).
2. Se **desinstalan los skills de Superpowers** de `.claude/skills/`. Son 14 carpetas: brainstorming,
   dispatching-parallel-agents, executing-plans, finishing-a-development-branch, receiving-code-review,
   requesting-code-review, subagent-driven-development, systematic-debugging, test-driven-development,
   using-git-worktrees, using-superpowers, verification-before-completion, writing-plans y
   writing-skills. Se borran del repo y del disco.
3. Se **reescribe el historial** para purgar credenciales y archivos sensibles, en vez de solo rotar.
4. Se elimina el secreto JWT de fallback. El backend debe fallar al arrancar si falta `JWT_SECRET`.
5. Se actualiza `CLAUDE.md`: es un único repo.

El usuario autorizó explícitamente modificar `.env`, `.claude/settings*.json`, `.claude/skills/` y
`.claude/CLAUDE.md` para este feature. También autorizó los commits locales que hagan falta para
reescribir el historial. **El force push NO está autorizado todavía**: el PO lo va a confirmar con el
usuario al final, con el resultado verificado.

## Historia de usuario
Como responsable del proyecto, quiero que ningún archivo del repo ni ningún commit de su historial
contenga contraseñas, tokens ni secretos, y que esas claves vivan solo en archivos locales ignorados,
para poder publicar el repo en GitHub sin exponer credenciales.

## Criterios de aceptación

### Fase A — working tree
1. **Docker Compose sin claves:** `docker-compose.yml` (raíz) y `backend/docker-compose.yml` no
   contienen usuarios ni contraseñas literales. Las toman de variables (`${POSTGRES_USER}`,
   `${POSTGRES_PASSWORD}`, `${POSTGRES_DB}`, `${JWT_SECRET}`, etc.), preferentemente con la forma
   `${VAR:?mensaje}` para que falle con un mensaje claro si falta la variable. `DATABASE_URL` del
   servicio backend se arma con esas variables.
2. **Archivos `.env` locales:**
   - Existe un `.env` local en la raíz (para el compose raíz) y `backend/.env` se completa con las
     variables que necesita el compose del backend. Ambos están ignorados por git.
   - Los valores locales conservan las credenciales actuales de Postgres, para no romper el volumen
     de datos existente.
   - Se agrega un `JWT_SECRET` aleatorio fuerte, de 32 bytes o más.
3. **`.env.example` versionados:** existen `.env.example` (raíz) y `backend/.env.example`, con todas las
   variables necesarias y valores de ejemplo (por ejemplo `change-me`), sin claves reales.
   `.env.example` no queda ignorado.
4. **Sin fallback de JWT:** `auth-module.ts` ya no tiene un secreto de fallback. Si `JWT_SECRET` falta,
   el backend falla al arrancar con un mensaje claro. El otro `JwtModule` (`app-module.ts`) tampoco
   puede quedar con secreto `undefined` en silencio. `npx tsc --noEmit` del backend pasa sin errores y
   el lint no suma errores nuevos en los archivos tocados.
5. **`.claude/settings.json`:** no contiene tokens, JWT, contraseñas ni ids de org o usuario. Las
   entradas `curl` con token se eliminan o se reemplazan por permisos genéricos sin credenciales.
   Se conserva el resto (por ejemplo `"agent": "po"`).
6. **`.claude/settings.local.json`:** sale del índice (`git rm --cached`), queda en disco y lo ignora el
   `.gitignore` raíz. Es el lugar para permisos locales que necesiten tokens.
7. **Docs sin claves:** ningún archivo versionado de `docs/` (ni el resto del repo) contiene
   contraseñas, tokens ni secretos literales. Se reemplazan por placeholders como `<POSTGRES_PASSWORD>`
   o referencias a `.env`.
8. **`docs/superpowers/`:** sale del índice, queda en disco y queda ignorada.
9. **Skills de Superpowers:** las 14 carpetas de `.claude/skills/` listadas arriba se eliminan del índice
   y del disco. No se tocan `.claude/agents/` ni otros archivos de `.claude/`. Si quedan referencias a
   esos skills en archivos versionados, se informan o se limpian.
10. **Barrido final del working tree:** un barrido de los archivos versionados (`git ls-files` + grep de
    patrones como `eyJ`, `password`, `PGPASSWORD`, `secret`, `Bearer` y los valores conocidos) no
    encuentra credenciales literales. Los falsos positivos, como nombres de campos o código de login,
    se listan y justifican.

### Fase B — historial
11. **Backup:** antes de reescribir se crea un respaldo completo del repo (por ejemplo
    `git bundle create --all`) **fuera del repo**, por ejemplo en `c:\Repositorios\` con un nombre que
    incluya la fecha. Se informa su ruta.
12. **Commits locales:** los cambios de los features 001 y 002 se commitean localmente, con mensajes
    claros, antes de la reescritura. No se hace push.
13. **Purga del historial:** con `git filter-repo` (o equivalente) se reescribe todo el historial de
    todas las ramas locales.
    - (a) Se eliminan de todos los commits los archivos sensibles: `seed*.sql`, `truncate.sql`,
      `generate_seed*.py`, `.claude/settings.local.json`, `docs/superpowers/`, `.claude/worktrees/` y
      cualquier `.env` que haya estado versionado.
    - (b) Se reemplazan en todos los commits los valores de credenciales conocidos: JWT (`eyJ...`),
      contraseñas de Postgres, el secreto de fallback, contraseñas de usuarios de prueba y el correo
      de aspecto real.
14. **Verificación del historial:** después de la reescritura, `git log --all -p` (o `git grep` sobre
    todos los commits) no encuentra ninguno de los valores sensibles ni los archivos purgados.
15. **Trabajo intacto:** el árbol del último commit coincide con el working tree previsto. Los archivos
    locales (`.env`, `settings.local.json`, seeds, `docs/superpowers/`) siguen en disco.
    `npx tsc --noEmit` del backend y del frontend siguen sin errores.
16. **Remoto:** se restaura la configuración de `origin` si `filter-repo` la quitó. **No se hace push.**
    Se deja documentado el comando exacto de force push y lo que implica.

### Documentación
17. **`CLAUDE.md`** refleja que hay un único repo (`github.com/mzaracho/solidus`, rama `main`) con
    `backend/` y `frontend/` como carpetas. Además documenta:
    - que las credenciales viven solo en `.env` y `.claude/settings.local.json` (locales e ignorados);
    - los `.env.example`;
    - que los seeds son locales.

    Se corrigen también `docs/auditoria/COMANDOS.md` (sección 1 y credenciales) y
    `docs/auditoria/ARQUITECTURA.md` (estructura y mención a superpowers).

## Fuera de alcance
- El force push al remoto: lo confirma el usuario al final.
- Rotar contraseñas de la base local o de los usuarios de prueba (el usuario eligió reescribir el
  historial). Se recomienda, pero no se ejecuta.
- Arreglar la verificación de JWT o la toma del tenant desde headers (riesgos S1/S2 de RIESGOS.md).
- Borrar o modificar `.claude/worktrees/bold-meninsky-a75726` en disco. Si bloquea la reescritura, se
  informa al PO antes de tocarlo.
- `docs/auditoria/CLAUDE.borrador.md`: el documentador decide si lo actualiza o lo marca como obsoleto.
- Cambiar el contenido funcional de seeds o de código, más allá del fallback de JWT.

## Riesgos
- **Reescritura de historial:** cambia todos los hashes. Cualquier otro clon o fork queda divergente y
  hay que volver a clonar. GitHub puede conservar commits viejos en caché, PRs o forks; para una
  purga completa puede hacer falta pedir soporte a GitHub. Se mitiga con el backup (criterio 11) y con
  la confirmación previa al push.
- **Backend no arranca:** si falta `JWT_SECRET` (es el comportamiento buscado), o si la imagen de
  Docker no recibe las variables. Se mitiga con `.env.example` y documentación.
- **Volumen de Postgres:** cambiar la contraseña en `.env` no cambia la del volumen ya inicializado.
  Por eso los valores locales se conservan.
- **Sesiones:** cambiar el secreto JWT invalida las sesiones activas. Es aceptable en desarrollo.
- **Worktree registrado** (`.claude/worktrees/bold-meninsky-a75726`): puede interferir con
  `filter-repo`.
- **`git filter-repo` no instalado:** se puede instalar con `pip install git-filter-repo`.

## Pasos del flujo
- Requiere UX/UI: **no**.
- Requiere seguridad: **sí** (es el objetivo del feature).
- Arquitecto: **sí** (diseño de variables y `.env`, y plan de reescritura del historial).
- Documentador: **sí** (`CLAUDE.md`, `COMANDOS.md`, `ARQUITECTURA.md`).
- Cambios de schema: ninguno.
- Orden especial: desarrollador fase A → revisor → desarrollador fase B → seguridad (A+B) → tester
  (A+B) → documentador. Los cambios del documentador quedan como commit nuevo encima del historial
  ya reescrito, sin credenciales. Push: solo con confirmación del usuario.
