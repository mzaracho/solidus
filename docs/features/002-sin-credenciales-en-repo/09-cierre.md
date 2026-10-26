# 09 — Cierre: 002-sin-credenciales-en-repo

## Resultado
Feature **entregado localmente**. Todas las etapas se aprobaron: arquitecto, revisor (fase A),
seguridad (A+B), tester (A+B) y documentador. No hubo rechazos. Los hallazgos menores de la revisión
(M-1 a M-4) se corrigieron antes de la fase B.

**No se hizo push.** El commit final (C3) y el push al remoto esperan la confirmación del usuario.

## Qué se entregó
- **Docker Compose sin claves:** los dos `docker-compose.yml` leen las credenciales de `.env` con
  `${VAR:?mensaje}`. Hay `.env` locales (raíz y `backend/`), que conservan la contraseña actual de
  Postgres y tienen un `JWT_SECRET` aleatorio nuevo, y `.env.example` versionados solo con
  placeholders. Los `.dockerignore` excluyen los `.env`.
- **JWT sin fallback:** helper `jwt-config.ts`. Los dos `JwtModule` usan `registerAsync`, y el backend
  no arranca si `JWT_SECRET` falta o tiene menos de 32 caracteres. Las expiraciones no cambiaron
  (8h y 1d). Hay 12 tests en `jwt-config.spec.ts`.
- **Configuración de Claude:** `.claude/settings.json` quedó sin permisos guardados.
  `.claude/settings.local.json` salió del índice y es local; recibió todos los permisos movidos.
- **Superpowers:** `docs/superpowers/` salió del índice y se conserva en disco, ignorada. Se
  desinstalaron las 14 carpetas de skills de `.claude/skills/`.
- **Historial reescrito** con git filter-repo:
  - se purgaron los seeds, los generadores, `truncate.sql`, `settings.local.json`,
    `docs/superpowers/` y `.claude/worktrees/`;
  - se reemplazaron 13 valores sensibles, entre ellos JWT, contraseñas, el secreto de fallback, el
    correo de aspecto real, los UUID y el nombre en un mensaje de commit;
  - pasaron de 10 a 9 commits, con `main` en `0639505`, y el árbol de HEAD no cambió.
- **Backup:** está en `C:\Repositorios\_backup_git\` (bundle verificado, copia del `.git` previo y
  copia de los archivos locales).
- **Documentación:**
  - `.claude/CLAUDE.md`: único repo, sección Credenciales, regla 3 reforzada y regla 12 nueva sobre
    permisos con credenciales.
  - `COMANDOS.md`, `ARQUITECTURA.md` y `BACKLOG.md` (ítem 18 resuelto).
  - `CLAUDE.borrador.md`, marcado como obsoleto.

## Verificación de criterios de aceptación
| # | Criterio | Evidencia | Estado |
|---|---|---|---|
| 1 | Compose sin claves, con `${VAR:?}` | 05, 06 §2.4, 07 (`config --quiet` y archivo de variables vacío) | Cumple |
| 2 | `.env` locales con las credenciales actuales y `JWT_SECRET` fuerte | 04, 07 | Cumple |
| 3 | `.env.example` versionados con placeholders | 05, 06 §2.1, 07 | Cumple |
| 4 | Sin fallback JWT; falla al arrancar; tsc y lint OK | 05, 06 §2.3, 07 (12 tests y arranque con código 1) | Cumple |
| 5 | `settings.json` sin credenciales | 06, 08; verificado por el PO (`allow` vacío) | Cumple |
| 6 | `settings.local.json` fuera del índice, en disco e ignorado | 06 §2.1, 07 | Cumple |
| 7 | Docs sin claves | 05, 06 §2.1 | Cumple |
| 8 | `docs/superpowers/` fuera del índice, en disco e ignorada | 05, 07 | Cumple |
| 9 | 14 skills eliminados; `.claude/agents/` intacto | 05, 07 | Cumple |
| 10 | Barrido del working tree sin credenciales | 04, 05, 06 §2.1 | Cumple |
| 11 | Backup fuera del repo | 04 fase B, 07 (`bundle verify`) | Cumple |
| 12 | Commits locales previos, sin push | 04 (`edb234d`, luego C2) | Cumple |
| 13 | Purga de rutas y valores en todo el historial | 04 fase B, 06 §2.2 | Cumple |
| 14 | Historial verificado sin valores ni rutas purgadas | 06 §2.2 (0 coincidencias, fsck sin objetos sueltos), 07 | Cumple |
| 15 | Árbol intacto, archivos locales en disco, tsc OK | 04 (mismo hash de árbol), 07 | Cumple |
| 16 | `origin` restaurado, sin push y con el comando documentado | 04, 06 §2.5, 07 | Cumple |
| 17 | `CLAUDE.md` y docs actualizados | 08; revisado por el PO | Cumple |

Nota del PO: corregí en `CLAUDE.md` la mención a "7 tests", porque ahora son 12, y la dejé sin
número fijo.

## Pasos omitidos
- **UX/UI:** no hay interfaz de usuario.
- **Informes de seguridad:** el agente no podía escribir archivos. El PO transcribió su informe en
  06-seguridad.md.

## Pendientes, a decisión o acción del usuario
1. **Commit C3 y push:**
   - Hay que commitear los cambios de documentación, `settings.json`, los tests nuevos y los informes
     04 y 06 a 09. Antes, revisar `git diff .claude/settings.json`, porque el harness lo vuelve a
     ensuciar.
   - Antes del push hay que verificar el remoto, porque `git ls-remote` devolvió 0 refs: ¿existe el
     repo, es privado, está vacío, tiene forks?
   - Si el repo está vacío, alcanza con `git push -u origin main`. Si tiene el historial viejo:
     `git push --force-with-lease=refs/heads/main:b689c802168d51c14e0e14e2e33f353c63a61e64 origin main`.
   - Pushear solo `main`, sin las ramas `claude/*`. No hacer fetch antes del push.
2. **Rotar credenciales:** si el historial viejo estuvo publicado, hay que dar por expuestas la
   contraseña de Postgres, las de los usuarios de prueba y el secreto JWT viejo.
3. **Repos viejos `solidus-backend` y `solidus-frontend` en GitHub:** conservan secretos en su
   historial. Archivarlos como privados, borrarlos o reescribirlos.
4. **Caché de GitHub:** pedir la purga de los SHA viejos al soporte de GitHub, si el historial estuvo
   publicado.
5. **Backup `C:\Repositorios\_backup_git\`:** contiene todos los secretos viejos. No sincronizarlo con
   una nube y borrarlo después del push.
6. **Opcionales de seguridad:**
   - hook `pre-commit`/`pre-push` que bloquee tokens y contraseñas;
   - correo `noreply` de GitHub en los commits;
   - IP de la red local en el compose;
   - revisar `NODE_TLS_REJECT_UNAUTHORIZED` en `backend/.env`.
7. **Documentación menor:**
   - `docs/auditoria/COMANDOS.md:86` dice "7 tests" y ahora son 12;
   - `ESTADO.md` y `RIESGOS.md` todavía mencionan gitlinks;
   - decidir si `RIESGOS.md` se versiona, porque CLAUDE.md lo cita y hoy está ignorado.
8. **Skills en el historial:** las rutas de `.claude/skills/` siguen en commits viejos. No contienen
   credenciales y no estaba pedido purgarlas.
9. **Riesgo S1:** sigue abierto. Los JWT no se verifican, así que el secreto obligatorio todavía no
   protege las sesiones (ver BACKLOG ítem 1).
