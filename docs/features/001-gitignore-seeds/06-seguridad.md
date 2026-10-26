# 06 — Seguridad: 001-gitignore-seeds

> El agente de seguridad no tenía permiso para crear archivos y devolvió el informe en su
> respuesta. El PO lo transcribió acá sin cambios de fondo.

## Alcance
Revisé el cambio con comandos de solo lectura. El feature solo modifica `.gitignore` y el índice,
así que no toca endpoints, autenticación, sesiones, entradas ni criptografía. Lo evalué como
control de fuga de datos y secretos hacia el control de versiones. No corrí auditoría de
dependencias, porque no hay cambios en `package.json`. No copio tokens ni contraseñas en este
informe y los referencio por archivo y línea.

## Resultado sobre el feature
- **Cobertura de los archivos del inventario:** los 7 archivos de seeds y generadores, más el
  gitlink `.claude/worktrees/bold-meninsky-a75726`, salieron del índice. `git status --ignored`
  los muestra como ignorados (`!!`) y siguen en disco.
- **Archivos trackeados e ignorados a la vez:** `git ls-files -ci --exclude-standard` devuelve
  solo `.claude/settings.local.json` (ver H1). Los archivos del inventario ya no están en ese caso.
- **Patrones nuevos:**
  - Cubren `git add .` para `seed*.sql`, `truncate.sql`, `generate_seed*.py`, `*.xlsx`, `*.xls`,
    `*.csv`, `*.dump`, `*.backup`, `seed-data/`, `seeds/` y `.claude/worktrees/`.
  - `backend/.env` está ignorado.
  - `frontend/.gitignore` ignora `.env*` y `*.pem`.
  - No hay `*.sql` ni `*.json` global, así que las migraciones y `seed.ts` siguen versionados.
- **Dumps y fixtures:** no hay `.sql` de datos, `.csv`, `.xlsx`, dumps, fixtures ni hashes bcrypt
  trackeados. El único match de `$2b$` es el uso de `bcrypt.compare` en el código de login.
- **Historial:** los seeds siguen en los commits anteriores. Está fuera de alcance y el usuario
  confirmó que son datos de prueba.

## Hallazgos

### Que bloquean este feature
Ninguno.

### MAYOR (hallazgo aparte, NO bloquea este feature)

**H1. JWT y credenciales en la configuración de `.claude/` versionada.**
- `.claude/settings.json`:
  - Las líneas 4 a 17 son permisos `Bash(curl ...)` con un JWT `Bearer` completo.
  - Esas líneas incluyen también `x-org-id` y `x-user-id`.
  - El `sub` del JWT es un id de usuario.
  - Las líneas 4 a 17 están en el baseline y en HEAD. Parte de ese contenido es nuevo en el
    working tree.
- `.claude/settings.local.json` (trackeado e ignorado a la vez, porque `frontend/.gitignore` lo
  lista pero ya estaba en el índice):
  - La línea 21 contiene otro JWT.
  - Las líneas 18, 22, 23, 25, 32, 33, 38, 39, 50 y 52 son curl de login con cuerpo con contraseña.
  - La línea 64 tiene `PGPASSWORD=...` en un `psql` local.
- **Riesgo:** viola la regla 3 de CLAUDE.md. Un push expone tokens e ids de organización y
  usuario, y credenciales de login de usuarios de prueba. El token es de desarrollo y
  probablemente ya expiró, así que el impacto práctico es bajo. Sigue siendo mala práctica y
  puede filtrar ids reales o contraseñas reutilizadas.
- **Por qué no bloquea:**
  - La spec no incluye `.claude/` salvo `worktrees/`.
  - La regla 2 de CLAUDE.md prohíbe tocar `.claude/` sin pedido explícito.
  - El feature no empeora esta exposición. Los archivos ya estaban en el baseline y en HEAD.
- **Recomendación para el usuario, a decidir por él:**
  1. Quitar de `.claude/settings.json` las entradas `curl` con el token. Usar permisos genéricos
     como `Bash(curl -s http://localhost:8080/*)`.
  2. Ejecutar `git rm --cached .claude/settings.local.json`. El `.gitignore` ya lo cubre, y así
     se corrige el caso "trackeado e ignorado".
  3. Considerar comprometidos esos JWT y esas contraseñas. Verificar que sean solo de prueba y
     rotarlos si alguna vez se usaron fuera del entorno local.
  4. No incluir `.claude/settings.json` en el commit de este feature. Está modificado en el
     working tree por otro proceso.

### MENOR

**H2. Credenciales y correos de prueba en archivos versionados (docs y compose).** Son datos
ficticios o de desarrollo local, y quedan fuera del feature.
- `docker-compose.yml:8-10` y `:24`, y `backend/docker-compose.yml:7-9`: usuario y contraseña de
  Postgres de desarrollo. Aceptable solo si el compose nunca se expone fuera de localhost, y la
  red LAN ya fue expuesta según el historial (`ee66549`). Mover a variables de entorno en un
  backlog.
- `docs/auditoria/COMANDOS.md:22,47`: repite esa cadena de conexión.
- `docs/auditoria/COMANDOS.md:107`: lista usuarios de prueba. No muestra contraseña.
- `docs/superpowers/plans/2026-04-22-multi-org-professional.md:139`: un curl con un correo con
  aspecto de persona real y una contraseña en texto plano. Verificar si es un dato real y, si lo
  es, reemplazarlo por uno ficticio.

**H3. Patrones globales amplios.** `*.csv`, `*.xlsx` y `*.xls` aplican a todo el repo y podrían
ocultar plantillas o fixtures legítimos en el futuro. Hoy no hay ninguno trackeado. Usar
`!ruta` explícito si se necesita.

**H4. Cobertura preventiva incompleta (opcional).** No se ignoran `*.sql.gz`, `*.sqlite`,
`*.pgdump` ni `*.tar` de volcados, ni `*.sql` de fixtures con otros nombres, por ejemplo
`dump.sql` o `export_*.sql`. Es una decisión de diseño, porque la spec prohíbe un `*.sql` global.
Si se quiere más cobertura, agregar patrones específicos como `dump*.sql` y `export*.sql`.

**H5. Mensaje al commitear.** Al hacer commit, los seeds desaparecen del remoto pero siguen en
el historial. Es un riesgo aceptado y ya documentado en la spec.

## Resumen
| Área | Estado |
|---|---|
| Seeds, generadores y worktrees sacados del índice e ignorados | Cumple |
| Archivos trackeados e ignorados a la vez | `.claude/settings.local.json` (H1, hallazgo aparte) |
| Patrones suficientes contra `git add .` | Suficientes para el alcance de la spec (H3 y H4 opcionales) |
| Migraciones, `seed.ts` y `schema.prisma` siguen versionados | Cumple |
| Secretos en la configuración de `.claude/` | H1, MAYOR, fuera de alcance; el usuario decide |
| Otras superficies (entradas, authz, XSS, CSRF, cripto, uploads) | No aplican a este cambio |

VEREDICTO: APROBADO
