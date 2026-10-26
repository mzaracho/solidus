# 08 — Documentación: 002-sin-credenciales-en-repo

> Este informe no contiene valores secretos. No se tocó código fuente, `.gitignore`, `.env` ni
> `.claude/agents/`. No se hizo `git add`, commit, push ni fetch. El usuario autorizó modificar
> `.claude/CLAUDE.md` y `.claude/settings*.json` en este feature.

## 1. Qué cambió y qué documentación quedó desactualizada
Según `04-implementacion.md` y `06-seguridad.md`: hay un único repo git (`github.com/mzaracho/solidus`,
rama `main`), las credenciales salieron del repo, `JWT_SECRET` es obligatorio (32+ caracteres), los
compose usan `${VAR:?mensaje}`, existen `.env.example`, los seeds y `docs/superpowers/` son locales y el
backend ya tiene sus primeros tests (`jwt-config.spec.ts`, 7). Quedaban desactualizados `CLAUDE.md`,
`COMANDOS.md`, `ARQUITECTURA.md`, `BACKLOG.md` (ítem 18) y `CLAUDE.borrador.md`.

## 2. Archivos modificados
| Archivo | Cambio |
|---|---|
| `.claude/CLAUDE.md` | Estructura de repo único; sección nueva "Credenciales"; regla 3 reforzada; regla 12 nueva (M-6); comandos actualizados |
| `docs/auditoria/COMANDOS.md` | Sección 1: un solo `git clone`; paso de copiar `.env.example` a `.env`; notas de tests y compose |
| `docs/auditoria/ARQUITECTURA.md` | Árbol de estructura sin gitlinks; `docs/superpowers` local; variables y seeds locales |
| `docs/auditoria/BACKLOG.md` | Ítem 18 marcado como resuelto |
| `docs/auditoria/CLAUDE.borrador.md` | Nota "OBSOLETO" al inicio |
| `.claude/settings.json` | `permissions.allow` vacío; se conservan `"agent": "po"` y `additionalDirectories` |
| `.claude/settings.local.json` (ignorado) | Recibió las entradas de `allow` de `settings.json` que no tenía |
| `docs/features/002-sin-credenciales-en-repo/08-documentacion.md` | Este informe |

## 3. Resumen de cambios
**`.claude/CLAUDE.md`**
- Estructura: se quitaron `solidus-backend`, `solidus-frontend`, `.gitmodules` y "repos independientes".
  Ahora dice que hay un único repo con `backend/` y `frontend/` como carpetas y que todo se versiona
  en la raíz.
- Sección "Credenciales" (breve): archivos locales ignorados (`.env`, `backend/.env`,
  `.claude/settings.local.json`), plantillas `.env.example`, `JWT_SECRET` obligatorio de 32+ caracteres.
  Seeds, generadores y `docs/superpowers/` figuran como locales.
- Regla 3: se agregó que ninguna credencial, ni siquiera de prueba, puede subirse a GitHub.
- Regla 12 (M-6): los permisos con tokens, contraseñas, `Authorization`, ids o URLs con credenciales
  van solo en `settings.local.json`; antes de cada commit se revisa `git diff .claude/settings.json`.
- Comandos: paso inicial de copiar los `.env.example`; `docker compose` raíz requiere el `.env`.
- Ajuste verificable: Jest ya no figura "sin tests" (existe `jwt-config.spec.ts`, 7 tests, según 04).

**`docs/auditoria/COMANDOS.md`:** sección 1 con `git clone https://github.com/mzaracho/solidus.git`;
subsección de variables (copiar a `.env` y `backend/.env`, reemplazar `change-me`, generar `JWT_SECRET`);
línea de `npm test` y bloque de Docker actualizados. Se conservó CRLF.

**`docs/auditoria/ARQUITECTURA.md`:** árbol corregido; se reemplazó la tabla de punteros de gitlinks
por una nota histórica; se aclaró que `docs/superpowers/` se conserva en disco sin versionar y que los
skills de Superpowers se desinstalaron.

**`.claude/settings.json` (M-6.1):** quedó con `"agent": "po"`, `additionalDirectories` igual y `allow`
vacío. Las entradas pasaron a `settings.local.json` sin duplicar ni borrar: el archivo pasó de 141 a 145
entradas (4 agregadas). No se copiaron valores a este informe.

## 4. Verificación
Barrido `grep -c -F -f C:\Repositorios\_backup_git\002-redact\valores.txt` sobre los archivos
modificados: ver resultado en la respuesta de la tarea (debe dar 0 en todos; `settings.local.json`
queda fuera por ser local e ignorado).

## 5. Pendientes
- El harness vuelve a agregar permisos a `.claude/settings.json` al aprobar comandos: revisar
  `git diff .claude/settings.json` antes del commit C3 y del push (regla 12).
- `docs/auditoria/ESTADO.md` (línea 132) y `RIESGOS.md` (línea 142) todavía mencionan gitlinks sin
  `.gitmodules`; no estaban en el alcance de esta tarea. `RIESGOS.md` está ignorado (M-9).
- `BACKLOG.md` ítems 6 y 19 (rotar credenciales, secretos por `.env` en Docker) quedan parcialmente
  cubiertos; no se re-etiquetaron. Sigue pendiente rotar credenciales (M-4 de 06-seguridad).
- `docker-compose.yml` conserva la IP LAN en `NEXT_PUBLIC_API_BASE_URL` (M-7); `COMANDOS.md` sección 5
  lo sigue advirtiendo.
- Push y estado del remoto: pendientes del usuario (M-1, 04 B.8). El backup `C:\Repositorios\_backup_git\`
  contiene secretos viejos y debe borrarse al cerrar (M-2).
- La mención a `psql -U myuser` queda en CLAUDE.md, ARQUITECTURA.md y COMANDOS.md (usuario, no secreto;
  permitido por el diseño 3.7).
