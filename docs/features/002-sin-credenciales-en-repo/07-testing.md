# 07 — Testing: 002-sin-credenciales-en-repo (fases A y B)

> No se imprimieron ni leyeron valores de `.env`, `settings.local.json` ni `valores.txt`; solo se usaron
> conteos y códigos de salida. No se hizo commit, push ni fetch. No se levantó la base.
> Único archivo de proyecto tocado: `backend/src/infrastructure.bootstrap/config/app/jwt-config.spec.ts`.

## 1. Resultado base
| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit` backend | 0 errores |
| `npx tsc --noEmit` frontend | 0 errores |
| `npx jest` backend (antes de mis cambios) | 1 suite, 7 tests pasan (según 04; el spec existente es el único del backend) |
| `npx jest` backend (después) | 1 suite, **12 tests pasan** |
| `npx eslint` sobre el spec modificado | 0 errores |

## 2. Tests agregados en `jwt-config.spec.ts` (criterio 4)
- `jwtModuleAsyncOptions('1d')` firma con `exp - iat = 86400` (módulo global de `app-module.ts`; sugerencia S-1 de la revisión).
- El módulo falla al compilar con `JWT_SECRET` vacío y con `JWT_SECRET` corto.
- Test estático: `app-module.ts` y `auth-module.ts` usan `jwtModuleAsyncOptions(` y no tienen fallback (`||`, `??`, `secret: process.env`, `get('JWT_SECRET', default)`).
- Ya existían: sin secreto (`undefined`, `''`, `'   '`), corto (el mensaje no incluye el valor), válido con 32 caracteres, y firma/verificación con `8h`.

## 3. Criterios

| # | Criterio | Prueba | Resultado |
|---|---|---|---|
| 1 | Compose sin claves | Inspección de `docker-compose.yml` y `backend/docker-compose.yml`: todas las variables `POSTGRES_*`, `DATABASE_URL` y `JWT_SECRET` usan `${VAR:?mensaje}`. `docker compose config --quiet` en la raíz y en `backend/`: código 0. Con `--env-file` vacío (variables sin exportar): ambos fallan con el mensaje de `:?` (raíz: `POSTGRES_USER`, `JWT_SECRET`, `POSTGRES_DB`; backend: las tres `POSTGRES_*`) | PASA |
| 2 | `.env` locales | `.env` y `backend/.env` existen y `git check-ignore -v` los cubre (`.gitignore:24`, `backend/.gitignore:39`). No se abrieron para verificar valores. Que el `.env` conserve las credenciales del volumen y tenga un `JWT_SECRET` de 32 bytes o más: no verificable sin leerlos. `JWT_SECRET` ejercido indirectamente por el arranque de 04 | PASA (valores no verificados) |
| 3 | `.env.example` | Ambos versionados (`git ls-files`); `check-ignore --no-index` solo muestra la regla de negación `!.env.example`; contienen `change-me`, sin claves reales | PASA |
| 4 | Sin fallback JWT | 12 tests de jest (sección 2); `tsc` 0 errores; lint del spec sin errores. Revisé `jwt-config.ts` y los dos módulos: ambos usan el helper | PASA |
| 5 | `settings.json` | HEAD: 0 coincidencias con `eyJ`, `Bearer`, `x-org`, `x-user`, `curl`, `password`; conserva `"agent": "po"`. Working copy: 0 coincidencias, pero ver hallazgos H-1 y H-2 | PASA |
| 6 | `settings.local.json` | `git ls-files` no lo lista; está en disco; `.gitignore:27` lo ignora | PASA |
| 7 | Docs sin claves | `git grep -F -f valores.txt HEAD`: código 1 (0 coincidencias). Regex de JWT, `PGPASSWORD=` y `Bearer`: solo líneas de informes de 03/04 que describen el barrido | PASA |
| 8 | `docs/superpowers/` | 0 archivos versionados; existe en disco; `.gitignore:30` la ignora | PASA |
| 9 | Skills | `.claude/skills/` no existe en disco; 0 archivos versionados bajo esa ruta; `.claude/agents/` con sus 9 archivos versionados y sin cambios. Queda una mención a `docs/superpowers` en `docs/auditoria/ARQUITECTURA.md:27` (lo cubre el criterio 17) | PASA |
| 10 | Barrido del working tree | `git ls-files -z \| xargs -0 grep -InE 'eyJ...\|PGPASSWORD=...\|Bearer ...'`: solo líneas de 03/04 que citan el patrón. URL con clave: `backend/.env.example:6` y `03-diseno-tecnico.md:105` (placeholder `change-me`), `COMANDOS.md:53` (`<POSTGRES_USER>:<POSTGRES_PASSWORD>`). Son falsos positivos justificados | PASA |
| 11 | Backup | `C:\Repositorios\_backup_git\healthops-gem-2026-10-26-pre-002.bundle` existe; `git bundle verify`: "records a complete history". También existe la copia `.git-dir` | PASA |
| 12 | Commits locales | `252f459` (001) y `0639505` (002) están en `main`; `origin/main` no existe como ref local, y no hay `FETCH_HEAD` (no se hizo fetch). No puedo probar la ausencia de push, solo que no hay ref remota ni FETCH_HEAD | PASA |
| 13 | Purga | (a) `git log --all --name-only` filtrado por `seed*.sql`, `truncate.sql`, `generate_seed*.py`, `settings.local.json`, `docs/superpowers/`, `.claude/worktrees/` y `.env`: 0 rutas. (b) `git rev-list --all \| xargs git grep -c -F -f valores.txt`: 0 coincidencias (xargs sale 123 porque `git grep` devuelve 1 sin coincidencias). Regex JWT sobre `git log --all -p`: 0 | PASA |
| 14 | Verificación del historial | `git log --all -p` con `valores.txt`: 0 líneas; mensajes de commit con `valores.txt`: 0; `fsck --unreachable --no-reflogs`: 0 líneas | PASA |
| 15 | Trabajo intacto | Árbol de HEAD `71df27f6...` igual al previo a la reescritura (04, B.4). En disco: `.env`, `backend/.env`, `settings.local.json`, `docs/superpowers/`, `.claude/worktrees/bold-meninsky-a75726`, `truncate.sql`, 4 seeds y 2 generadores. `tsc` backend y frontend: 0 errores | PASA |
| 16 | Remoto | `origin` = `https://github.com/mzaracho/solidus.git` (fetch y push), `branch.main.remote=origin`. Sin refs remotas ni FETCH_HEAD. El comando de force push está documentado en 04 B.8. El push no se puede probar de forma directa | PASA |
| 17 | `CLAUDE.md`, `COMANDOS.md`, `ARQUITECTURA.md` | No evaluado | pendiente (documentador) |

Prueba de arranque sin secreto: con `JWT_SECRET=` (vacío) en el entorno del proceso, `npx nest start` termina con código 1 y el mensaje "JWT_SECRET is not defined. Set it in backend/.env (local) or in the root .env (Docker Compose). See .env.example." La falla ocurre durante la instanciación de providers, antes de abrir conexión con la base. Con el `.env` real no se arrancó la app.

## 4. Bugs
Ninguno en el código de producción.

## 5. Hallazgos no bloqueantes
- **H-1 (06-seguridad M-6, conocido, no se cuenta como fallo):** `HEAD:.claude/settings.json` tiene 2 entradas `Bash(node "...scratchpad...")`. No son credenciales. Se limpian en C3.
- **H-2:** el working copy de `.claude/settings.json` ya tiene cambios sin commit del harness (3 entradas `git notes/count-objects/hash-object` más el reemplazo de las 2 entradas de scratchpad). No tienen credenciales, pero hay que descartarlos antes de C3 o del push.
- **H-3:** el historial conserva los archivos de `.claude/skills/` (46 rutas únicas). El criterio 13 no los incluye en la purga y no contienen valores sensibles según el barrido. Se informa por si el usuario quería purgarlos del historial.
- **H-4:** `git worktree list` muestra el worktree detached con HEAD en `0590c8c`, ya re-apuntado. Eso es coherente con 04 B.7.
- **H-5:** el spec nuevo emite avisos de CRLF/LF al hacer `git diff`. No afecta.

## 6. No pude verificar
- Los valores de `.env` y `backend/.env`: no se abrieron por restricción. No pude confirmar que conserven las credenciales del volumen ni la longitud del `JWT_SECRET` local.
- Que el push no se haya hecho: solo hay evidencia indirecta (sin refs remotas, sin FETCH_HEAD). Tampoco pude ver el estado real del remoto.
- `docker compose up`, login real y conexión a la base: no se levantó la base por restricción.
- La cobertura del `AppModule` completo con la base: la validación se probó con el helper, los módulos JWT y el arranque real sin secreto.
- Criterio 17: pendiente del documentador.

VEREDICTO: APROBADO
