# 05 — Revisión: 002-sin-credenciales-en-repo (FASE A)

> Este informe no contiene valores secretos. Se revisó solo la fase A (criterios 1 a 10) sobre el
> working tree y el commit local `edb234d` (feature 001). Se usó únicamente lectura y verificación.

## 1. Resultado de las verificaciones que corrí

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` backend | 0 errores |
| `npx tsc --noEmit` frontend | 0 errores |
| `npx jest src/infrastructure.bootstrap/config/app/jwt-config.spec.ts` | 1 suite, 7 tests OK |
| `npx eslint` sobre `jwt-config.ts`, `jwt-config.spec.ts`, `app-module.ts`, `auth-module.ts` | 0 errores |
| `docker compose config --quiet` en la raíz y en `backend/` | código 0 (solo el warning preexistente de `version`) |
| `git check-ignore -v` de `.env`, `backend/.env`, `.claude/settings.local.json`, `docs/superpowers/plans/x.md` | las 4 ignoradas, con regla |
| `git check-ignore -v --no-index .env.example backend/.env.example` | solo la regla de negación `!.env.example` (no quedan ignorados) |
| `git ls-files -ci --exclude-standard` | 0 líneas |
| `grep -c -F -f valores.txt` sobre `git ls-files` (working tree) | 0 coincidencias en todos los archivos |
| Mismo control sobre `settings.json`, compose, `.env.example` x2, `jwt-config*.ts`, 01/03/04 del feature | 0 |
| `git show edb234d` contra `valores.txt` | 0 coincidencias en el diff |
| `.env` raíz y `backend/.env` (solo nombres de clave) | raíz: `POSTGRES_USER/PASSWORD/DB`, `JWT_SECRET`. backend: las 7 previas + `JWT_SECRET` + `POSTGRES_*` |
| `.claude/skills/` | no existe; `.claude/agents/` conserva los 9 agentes y está trackeado |
| `.claude/settings.local.json` y `docs/superpowers/` | presentes en disco, fuera del índice (`git ls-files` no los lista) |

## 2. Cumplimiento de la spec y del diseño

- **Criterio 1 (compose):** cumple. Los dos compose usan `${VAR:?mensaje}` entre comillas dobles,
  `DATABASE_URL` se arma con las variables y la raíz agrega `JWT_SECRET`. No usan `env_file`, como
  pedía el diseño. El compose raíz lee el `.env` de la raíz, que tiene las cuatro variables que
  referencia.
- **Criterio 2 y 3:** cumple. Los `.env` existen y están ignorados. Los `.env.example` coinciden con el
  diseño y no tienen valores reales. `JWT_SECRET=change-me` es más corto que 32 a propósito.
- **Criterio 4:** cumple. No queda ningún fallback: `grep` de `process.env` y `JWT_SECRET` en `src`
  solo encuentra `jwt-config.ts`. Los dos `JwtModule` usan `registerAsync` con el helper, lo que
  además arregla el orden de carga de `dotenv` (H-1).
- **Expiración:** sin cambios. `AuthModule` sigue en `8h` y el global en `1d`. El test verifica
  `exp - iat = 8 * 3600`.
- **Criterios 5, 6, 8 y 9:** cumplen (ver hallazgos M-1 y M-2 sobre `settings.json`).
- **Criterio 7 y 10:** cumplen. `COMANDOS.md` y `ESTADO.md` ya no tienen valores, y el barrido con
  `valores.txt` da 0. La lista de falsos positivos de 04 es razonable.
- **Commit `edb234d`:** no introduce credenciales nuevas. Solo agrega reglas de `.gitignore`, borra
  seeds y generadores, y agrega los informes del feature 001. La contraseña de Postgres en
  `COMANDOS.md` ya estaba en el HEAD previo (también `docker-compose.yml`, `auth-module.ts`,
  `ESTADO.md`, `backend/docker-compose.yml` y `settings.local.json` en HEAD). La fase B las purga.

## 3. Hallazgos

### Bloqueantes
Ninguno.

### Menores

**M-1. `.claude/settings.json` conserva entradas de poco valor y una con la ruta de la lista de valores.**
`.claude/settings.json`, bloque `permissions.allow`:
- `Bash(grep -cF -f /c/Repositorios/_backup_git/002-redact/valores.txt docs/features/... ; git stash list | wc -l)`
  y `Read(//c/Repositorios/_backup_git/002-redact/**)` no contienen valores, pero publican la ruta
  del archivo de secretos y son entradas puntuales que el harness agregó durante la sesión. Sugerencia:
  quitarlas antes de C2 (el desarrollador ya lo previó en 04, sección 7).
- `Read(//c/Repositorios//**)` da lectura a todo `C:\Repositorios`, incluido `_backup_git` con el bundle
  y los `.env` de respaldo. `Bash(git filter-repo *)` permite cualquier subcomando de reescritura.
  Sugerencia: pasar ambos a `.claude/settings.local.json`, o acotarlos, y dejar en `settings.json` solo
  permisos de solo lectura. No es una credencial, así que no bloquea.
- `Bash(grep -iE '\\.env\($|\\.\)')` parece una entrada truncada y sin utilidad. Sugerencia: borrarla.

**M-2. Posible pérdida en `settings.json` por el `git stash` accidental, no recuperable.**
Evaluación: el `settings.json` de HEAD solo tenía `"agent": "po"` y 14 `curl` con credenciales. Lo que
se perdió es lo que el PO tenía sin commitear (según 04: permisos del harness, patrones de `grep` con
sintaxis compleja y `additionalDirectories`, que se reconstruyó). Los 14 `curl` eran justamente lo que
había que quitar, así que la pérdida relevante es acotada: permisos de conveniencia que se vuelven a
conceder con "permitir siempre". El desarrollador lo informó con transparencia y lo dejó
documentado. Sugerencia: que el PO avise al usuario en el cierre; no requiere cambio de código.

**M-3. Texto poco claro en `docs/auditoria/ESTADO.md`.** Línea del `AuthModule`: queda "un secreto de
fallback hardcodeado, eliminado en el feature 002, /8h)". La coma y la barra rompen la frase.
Sugerencia: "(`AuthModule` con un secreto de fallback hardcodeado, eliminado en el feature 002; expiración
8h); ahora `JWT_SECRET` es obligatorio."

**M-4. Archivos nuevos en estado intent-to-add (` A`).** `git status` muestra los archivos nuevos
(`.env.example`, `jwt-config*.ts`, `01`/`03` del feature) como ` A`. Antes de C2 hay que hacer
`git add` explícito de esos archivos y de `04-implementacion.md` y `05-revision.md`, que está sin
trackear. Sugerencia: en la fase B correr `git add -A -- <rutas del 002>` y revisar `git status`
(no usar `git add .` a ciegas por el re-barrido de `settings.json`).

### Sugerencias

**S-1. Cobertura de tests.** El test cubre el helper y el `JwtModule` con `8h`. No hay un test que
cubra el `1d` del módulo global de `app-module.ts`, ni uno de arranque del `AppModule` completo.
Es aceptable porque ambos usan la misma función. Sugerencia opcional: un caso `jwtModuleAsyncOptions('1d')`
que verifique `exp - iat = 86400`.

**S-2. Test de `trim`.** El helper rechaza `'   '` pero acepta un secreto con espacios al inicio o al
final que sume 32 caracteres. Es coherente con el diseño y no hay riesgo real. Sin acción.

**S-3. `DATABASE_URL` y contraseñas con caracteres especiales.** El compose raíz interpola
`POSTGRES_PASSWORD` dentro de la URL. Si alguien usa `@`, `/` o `:` en la contraseña, la URL se
rompe sin mensaje claro. El diseño lo documenta (solo `[A-Za-z0-9_-]`), pero el `.env.example` no lo
dice. Sugerencia: agregar un comentario de una línea en `.env.example` raíz y en `backend/.env.example`.

**S-4. Cambio de comportamiento a documentar.** El compose raíz antes arrancaba sin `JWT_SECRET`
(con el fallback). Ahora todos los subcomandos de `docker compose` fallan si falta `.env`. Está en
el diseño (sección 3.2) y debe quedar en `CLAUDE.md`/`COMANDOS.md` (tarea del documentador).

**S-5. `NODE_TLS_REJECT_UNAUTHORIZED` en `backend/.env`.** Sigue en el `.env` local y no se copió al
ejemplo, como indicaba el diseño. Para el rol de seguridad: conviene revisar si sigue haciendo falta.

## 4. Convenciones del proyecto

- El helper sigue el patrón de `*-config.ts` de `config/app/` y usa `isString` de `config/core`.
- `throw new Error` es defendible: es validación de configuración en el arranque (precedente:
  `logger.ts`), no un error de negocio.
- Prettier/ESLint limpios, comillas simples y trailing commas.
- Los archivos nuevos quedan con LF y el repo usa CRLF por `autocrlf`. Git los normaliza; solo
  produce warnings. Sin acción.
- No se tocó schema ni se necesitan migraciones.

## 5. Seguridad (solo lo evidente)

- No hay credenciales en archivos versionados del working tree ni en el diff de `edb234d`.
- Los mensajes de error del helper no incluyen el valor del secreto.
- `backend/.dockerignore` y `frontend/.dockerignore` ahora excluyen `.env` y la imagen `builder` no
  copia el `.env` local.
- El secreto de `JWT_SECRET` sigue sin usarse para verificar tokens (riesgo S1, fuera de alcance).

VEREDICTO: APROBADO
