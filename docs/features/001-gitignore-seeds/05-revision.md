# 05 - Revisión: 001-gitignore-seeds

Revisados: `.gitignore`, `backend/.gitignore`, `frontend/.gitignore`, el índice (`git status --short`,
`git diff --cached --stat`), la spec (01) y el informe del desarrollador (04). No hay 02 ni 03 (omitidos por trivial).
Solo se usaron comandos git de lectura. No se modificó nada del proyecto.

## Verificaciones realizadas
- **Un único repo git**: confirmado. No existen `backend/.git` ni `frontend/.git`, no hay `.gitmodules` y
  `git ls-files -s` ya no muestra gitlinks (160000). El desvío informado respecto de la spec ("tres repos") es correcto y razonable.
  Git lee los `.gitignore` anidados, así que los de backend/frontend aplican igual.
- **Contenido previo conservado**: el diff de los tres `.gitignore` solo agrega líneas (sin líneas `-`).
  Se mantiene `docs/auditoria/RIESGOS.md` en la raíz y el contenido previo de backend y frontend.
- **`git check-ignore -v`** devuelve regla para `seed.sql`, `seed_psicolsa.sql`, `truncate.sql`, `generate_seed.py`,
  `generate_seed_from_xlsx.py` y `.claude/worktrees/...`.
- **No se ignoran archivos necesarios**: `check-ignore` sin salida para `backend/prisma/seed.ts`,
  `backend/prisma/migrations/x/migration.sql`, `backend/src/domain/seed-work/a.ts` y `backend/package.json`.
  `git ls-files | grep -Ei "seed|truncate|xlsx|xls|csv|dump|backup"` solo lista `backend/prisma/seed.ts` y los dos archivos de
  `backend/src/domain/seed-work/`. `git ls-files backend/prisma/migrations` sigue listando 9 entradas.
- **Índice**: los 7 archivos del inventario y el gitlink `.claude/worktrees/bold-meninsky-a75726` figuran como `D ` (staged).
  El resto de `git status` coincide con lo informado.
- **Disco**: los 7 archivos siguen existiendo en la raíz (`ls`), y `.claude/worktrees/` tiene `bold-meninsky-a75726` y `gallant-nobel-2c467e`.
- **Sin commit**: `git log` sigue en `b689c80` como HEAD (sin commits nuevos). Cambios solo en working tree/índice.
- **Patrones**:
  - `seeds/` y `seed-data/` (sin `/` inicial) matchean directorios con ese nombre exacto a cualquier profundidad;
    `seed-work/` no coincide, y `seed*.sql` exige extensión `.sql`, por lo que `seed.ts` no se ve afectado.
  - No se usó `*.sql` ni `*.json` global (criterio 3 cumplido).

## Hallazgos

### Bloqueantes
Ninguno.

### Menores
1. **`frontend/.gitignore` (comentario del bloque agregado)**: dice "no afecta migrations/*.sql ni prisma/seed.ts", que no existen en
   el frontend (copia literal del bloque de backend). Sugerencia: acortar el comentario a "Seeds SQL y archivos de datos de
   origen/exportaciones" en frontend.
2. **`.claude/settings.json` modificado (sin relación con la feature)**: el diff mueve `"agent": "po"` al final y agrega 5 permisos
   `Bash(...)` (grep, `git check-ignore`, `git ls-tree`), probablemente por aprobaciones de esta sesión. El desarrollador ya lo avisó.
   Sugerencia: no incluir este archivo en el commit de la feature; revertir o commitear aparte si se desea (el archivo está bajo
   `.claude/` y no se debe tocar sin pedido explícito).
3. **Avisos CRLF**: git advierte que los tres `.gitignore` pasarán de LF a CRLF al tocarlos. Es inofensivo y común en Windows, pero
   conviene confirmar que `core.autocrlf`/`.gitattributes` es lo deseado para no generar ruido en diffs.

### Sugerencias
1. **Seguridad evidente (fuera de alcance, para el rol de seguridad)**: el `.claude/settings.json` versionado contiene un JWT
   (`Bearer eyJ...`) completo, el `x-org-id` y el `x-user-id` en los permisos `curl` ya trackeados desde el commit baseline. Va contra la
   regla 3 del CLAUDE.md. Sugerencia: eliminar esas entradas y considerar el token como comprometido (aunque el JWT ya expiró, `exp` 1776228648).
   Además `.claude/settings.local.json` figura como trackeado e ignorado a la vez (`git ls-files -ci`): conviene sacarlo del índice en otra tarea.
2. **Patrones globales `*.csv`/`*.xls*`**: aplican a todo el repo, incluidos futuros fixtures de tests o assets legítimos del frontend
   (por ejemplo `public/plantilla.csv`). Hoy no hay ninguno trackeado, y para un caso así se puede usar `!ruta` explícito. Documentarlo en
   el comentario del `.gitignore` raíz ayudaría.
3. **Redundancia backend/frontend vs. raíz**: los patrones del `.gitignore` raíz ya cubren los subdirectorios. Se mantienen porque la spec
   (criterio 2) lo pide y es inofensivo; si backend/frontend vuelven a ser repos independientes, serán necesarios.
4. **`.claude/worktrees/` sigue presente en HEAD**: el commit lo contiene como gitlink y se eliminará con el commit del usuario. Después
   del commit, `gallant-nobel-2c467e` queda ignorado correctamente. Recordar que el historial conserva los seeds (fuera de alcance según la spec).
5. **Criterio 9 pendiente**: `docs/auditoria/COMANDOS.md` aún debe aclarar que los seeds/generadores son locales (le corresponde al documentador).
   Los criterios 6 y 7 "en cada repo" se cumplen desde el único repo real.

## Cumplimiento de la spec
| Criterio | Estado |
|---|---|
| 1 Raíz ignora seeds, truncate, generadores y worktrees | Cumple |
| 2 Patrones preventivos en los tres `.gitignore` | Cumple |
| 3 No ignora migraciones, schema, seed.ts, package.json, tsconfig | Cumple |
| 4 Se conserva contenido previo | Cumple |
| 5 `git rm --cached`, sin borrar de disco, sin commit | Cumple |
| 6 `check-ignore` por archivo | Cumple |
| 7 `ls-files` sin seeds y con migraciones | Cumple |
| 8 Archivos siguen en disco | Cumple |
| 9 Nota en COMANDOS.md | Pendiente (documentador) |

Tests: no aplican a un cambio de configuración de git; las verificaciones con `check-ignore`/`ls-files` descritas en 04 son suficientes.

VEREDICTO: APROBADO
