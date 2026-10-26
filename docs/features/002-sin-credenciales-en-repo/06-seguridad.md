# 06 — Seguridad: 002-sin-credenciales-en-repo (fases A y B)

> El agente de seguridad no tenía permiso para crear archivos y devolvió el informe en su
> respuesta. El PO lo transcribió acá sin cambios de fondo.
> Este informe no contiene valores secretos. Todo se cita por archivo, commit o conteo.

## 1. Alcance y método
- Se auditó el working tree, HEAD (`0639505`) y el historial completo reescrito.
  - El historial son 9 commits en 4 refs: `main` y 3 ramas `claude/*`, todas en `0590c8c`.
  - No hay tags, stash, notes ni reflog. El worktree `.claude/worktrees/bold-meninsky-a75726` está
    en `0590c8c`.
- `git fsck --unreachable --no-reflogs` da 0 objetos. `count-objects` da `garbage: 0` y 569 objetos
  en un solo pack.
- Cambios sin commit: `.claude/settings.json` (+2 permisos que agregó el harness al aprobar comandos
  de esta auditoría) y `04-implementacion.md` (fase B).
- Dependencias: el 002 no toca `package.json` ni lockfiles. No se corrió `npm audit`, porque requiere
  red y no hay dependencias nuevas.

## 2. Resultados por punto

### 2.1 Working tree y HEAD: limpio
- `git ls-files` + grep con la lista `valores.txt` (13 valores): 0 archivos.
- JWT con dos segmentos `eyJ`, `$2a$/$2b$/$2y$` y `BEGIN … PRIVATE KEY`: 0 coincidencias en
  archivos versionados.
- Patrones de proveedores (`ghp_`, `AKIA`, `sk-`, `xox`, `AIza`) sobre todas las revisiones: 0.
- URLs `postgres://usuario:clave@`: solo placeholders (`change-me`, `${…}`) y textos descriptivos.
- `password`, `secret` y `token` con valor asignado: solo nombres de variable y placeholders.
- Correos: solo de dominio ficticio (`@solid.com`, `@ejemplo.com`). No hay correos de aspecto real.
- `.env`, `backend/.env` y `.claude/settings.local.json` están ignorados (`.gitignore:24`,
  `backend/.gitignore:39`, `.gitignore:27`) y fuera del índice.
- Los dos `.env.example` tienen solo placeholders. `JWT_SECRET=change-me` mide menos de 32 caracteres
  y el backend lo rechaza al arrancar.

### 2.2 Historial completo: limpio
- `git grep -c -F -f valores.txt` sobre las 9 revisiones: 0. Los mensajes de commit también dan 0.
- Regex JWT, bcrypt y claves privadas sobre todas las revisiones: 0.
- Búsqueda activa de secretos fuera de la lista: contraseñas en JSON y asignaciones `password=`,
  `secret=` y `pwd=` con valor literal. No se encontró ninguna que no fuera placeholder.
- `.claude/settings.json` histórico: 14 entradas con marcas `<REDACTED_JWT>`, `<ORG_ID>`,
  `<USER_ID>` y `<PATIENT_ID>`, sin valores reales.
- `auth-module.ts` y los compose conservan las marcas de reemplazo, sin restos.
- Metadatos de commit: autor y committer con el correo personal del usuario (ver M-5).
- Limitación: no se puede demostrar la ausencia de un secreto que no aparezca en la lista ni en los
  patrones genéricos. Ese riesgo es bajo, pero no es cero.

### 2.3 Código: correcto
- `jwt-config.ts` no tiene fallback. Lanza `Error` si falta, está vacío o mide menos de 32
  caracteres. Los mensajes no incluyen el valor.
- Solo hay dos `JwtModule` con `registerAsync`: `app-module.ts` (1d) y `auth-module.ts` (8h). No hay
  `process.env.JWT_SECRET` directo ni se loguea el secreto.
- La validación solo mira la longitud, no la entropía. Es razonable para este alcance.
- Los tests usan secretos ficticios generados en runtime.

### 2.4 Docker: correcto
- `backend/.dockerignore` y `frontend/.dockerignore` excluyen los `.env` y conservan `.env.example`.
- Los compose usan solo `${VAR:?mensaje}`, sin claves literales.

### 2.5 Remoto: no verificable desde acá
- `git ls-remote origin` devuelve 0 refs con código 0. Hay tres casos posibles, indistinguibles
  desde acá: (a) repo vacío, (b) repo privado sin credenciales válidas, (c) repo inexistente (menos
  probable).
- La ref local `origin/main` ya no existe (`[origin/main: gone]`), que es lo esperado.
- Qué implica cada caso para el push:
  - Repo vacío o inexistente: no hace falta force, alcanza con `git push -u origin main`.
  - Repo con historial viejo: `--force-with-lease` con hash explícito, solo si `main` remoto sigue
    en `b689c80`.
  - Si el historial viejo estuvo publicado, los valores están expuestos aunque se haga force push.
- No hacer `git fetch`, `pull` ni `remote update` antes del push, para no reintroducir el
  historial viejo.

## 3. Hallazgos

No hay hallazgos BLOQUEANTES.

### MAYOR
**M-1. Estado del remoto sin confirmar.** Hay que verificar con credenciales del usuario o por la web:
1. que el repo existe y su visibilidad;
2. qué hay en `main`;
3. si hay forks, PR o ramas con el historial viejo.

Recién entonces se elige entre push normal y force con lease. Pendiente del usuario.

**M-2. El backup en `C:\Repositorios\_backup_git\` contiene todos los secretos viejos.**
Contiene el bundle, la copia del `.git` previo, los `.env`, `settings.local.json`, los seeds, los
archivos de expresiones y las copias de `backend.git` y `frontend.git`. Remediación:
1. confirmar que la carpeta no está en OneDrive, Dropbox ni respaldos automáticos;
2. restringir los permisos NTFS a tu usuario;
3. borrarla cuando el push y la limpieza en GitHub estén cerrados.

**M-3. Los repos viejos `solidus-backend` y `solidus-frontend` en GitHub conservan los secretos**
(fallback JWT y contraseña de Postgres). Remediación: hacerlos privados y archivarlos, borrarlos o
reescribirlos con el mismo procedimiento, y revisar forks.

**M-4. Caché de GitHub, forks, PR y clones.** Los valores viejos deben considerarse expuestos.
Remediación:
1. rotar la contraseña de Postgres y las de los usuarios de prueba;
2. considerar comprometidos los JWT y el secreto de fallback viejos;
3. pedir a GitHub Support la purga de commits en caché (los SHA viejos se listan desde el bundle);
4. avisar a quien tenga un clon que debe volver a clonar.

Nota: los guards solo hacen `decode` sin verificar (riesgo S1 de RIESGOS.md), así que hasta resolver
S1 el secreto no protege las sesiones.

### MENOR
**M-5. Correo personal en los metadatos de commit.** Se hará público con el push. Opcional: usar el
correo `noreply` de GitHub en `git config user.email` y, si se quiere, reescribir con `--mailmap`.

**M-6. `.claude/settings.json` se vuelve a ensuciar con cada aprobación de permisos.** Además, HEAD
tiene 2 entradas `Bash(node "…\scratchpad\…")` con la ruta del usuario de Windows y un id de sesión.
No son secretos, pero no corresponde versionarlas. Remediación:
1. dejar `permissions.allow` vacío en el commit C3 y descartar los cambios del harness antes del push;
2. agregar una regla en `.claude/CLAUDE.md`: los permisos con tokens, contraseñas, headers
   `Authorization` o URLs con credenciales van solo en `.claude/settings.local.json`;
3. agregar un hook `pre-commit` que rechace JWT, `Bearer …`, URLs `postgres://u:clave@`,
   `PGPASSWORD=…`, claves privadas, valores de `valores.txt` y cambios en `.claude/settings.json`
   sin `ALLOW_SETTINGS=1`;
4. agregar un hook `pre-push` con el mismo barrido.

**M-7. IP de LAN en `docker-compose.yml` y `docs/auditoria`.** No es un secreto, pero expone la
topología de red. Queda a criterio del usuario.

**M-8. `NODE_TLS_REJECT_UNAUTHORIZED` en `backend/.env` local.** No se verificó (no se abrió `.env`).
Si está en `0`, desactiva la verificación TLS de Node. Revisar si todavía hace falta.

**M-9. `docs/auditoria/RIESGOS.md` está ignorado**, pero `CLAUDE.md` lo cita. Quien clone el repo
no lo tendrá. Decidir si se versiona.

## 4. Lista de verificación antes del push
1. `git status` limpio. Descartar los cambios del harness en `.claude/settings.json` y revisar el
   diff de C3.
2. Barrer los archivos de C3 con `git grep -F -f valores.txt` y con los patrones genéricos.
3. Confirmar el estado del remoto (M-1).
4. Rotar credenciales (M-4).
5. Hacer push solo de `main`, sin las ramas `claude/*`.
6. Recién después: `git fetch origin && git branch -u origin/main`.

## Resumen
HEAD y el historial reescrito están limpios: 0 coincidencias con los 13 valores conocidos y con los
patrones genéricos, 0 objetos inalcanzables y código sin fallback. Los riesgos que quedan son
operativos (remoto, backup, repos viejos, caché de GitHub, rotación de credenciales) y ninguno es
una credencial en el repo.

VEREDICTO: APROBADO
