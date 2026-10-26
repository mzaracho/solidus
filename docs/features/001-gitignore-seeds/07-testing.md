# 07 - Testing: 001-gitignore-seeds

Solo se usaron comandos git de lectura y lectura de archivos. No se modificó código ni archivos del proyecto, no se hizo `git add`/commit/push, no se tocó `.claude/` y no se ejecutó ningún seed ni TRUNCATE.
Script reutilizable (fuera del repo): `C:\Users\ADMINI~1\AppData\Local\Temp\claude\c--Repositorios-healthops-gem\e225f84e-2c11-432a-b275-0f52209b8022\scratchpad\verify.sh` (ejecutar con `bash`).

## Base
No hay suite de tests aplicable (cambio de configuración de git; Jest sin tests). La verificación son pruebas de `git check-ignore`, `git ls-files`, `git status` y existencia en disco.
Contexto confirmado: un único repo git (raíz). No existen `backend/.git` ni `frontend/.git`. HEAD sigue en `b689c80` (sin commits nuevos).

## Criterios

| # | Criterio | Prueba | Resultado | Estado |
|---|---|---|---|---|
| 1 | Raíz ignora los 7 archivos y `.claude/worktrees/` con patrones genéricos | `git check-ignore -v` sobre cada archivo: `seed.sql`, `seed_test_users.sql`, `seed_activities.sql`, `seed_psicolsa.sql` -> `.gitignore:5:seed*.sql`; `truncate.sql` -> `:6`; `generate_seed.py` y `generate_seed_from_xlsx.py` -> `:7:generate_seed*.py`; `.claude/worktrees/` -> `:21`. Con `--no-index` igual. Futuros: `seed_nuevo.sql` y `generate_seed_new.py` ignorados | Todos devuelven regla | PASA |
| 2 | Raíz, backend y frontend ignoran `*.xlsx *.xls *.csv *.dump *.backup`, `seed*.sql`, `seed-data/`, `seeds/` | `check-ignore --no-index -v` sobre 25 rutas hipotéticas: raíz (`export.xlsx`, `old.xls`, `a.dump`, `b.backup`, `seeds/x.sql`, `seed-data/a.txt`); `backend/` (`seed.sql`, `x.xlsx`, `a.xls`, `a.csv`, `a.dump`, `a.backup`, `seeds/z`, `seed-data/q`, `prisma/seed_extra.sql` -> `backend/.gitignore:62`); `frontend/` (`data.csv`, `seed.sql`, `x.xlsx`, `x.xls`, `a.dump`, `a.backup`, `seeds/x`, `seed-data/x`) | Todas ignoradas por la regla del `.gitignore` de su carpeta (backend y frontend tienen sus propias reglas) | PASA |
| 3 | No se ignora lo que debe versionarse; sin `*.sql` ni `*.json` global | `check-ignore --no-index -v` sobre `backend/prisma/migrations/20260121023310_init_uuid/migration.sql`, `migration_lock.toml`, `backend/prisma/seed.ts`, `schema.prisma`, `dedup-patients.ts`, `package.json` (raíz, backend, frontend), `frontend/tsconfig.json`, `backend/tsconfig.json`, `backend/tsconfig.build.json`, `backend/src/domain/seed-work/a.ts` | Ninguna ignorada (sin salida). Los `.gitignore` no tienen `*.sql` ni `*.json` global | PASA |
| 4 | Se conserva `docs/auditoria/RIESGOS.md` y el contenido previo de backend/frontend | `git diff --stat` -> 46 inserciones, 0 eliminaciones; `git diff \| grep '^-[^-]'` sin resultados; `grep -n` muestra `RIESGOS.md` en la línea 1 de `.gitignore` | Solo hay líneas agregadas | PASA |
| 5 | Archivos ya versionados salen del índice con `git rm --cached`, sin borrar del disco, sin commit | `git diff --cached --name-status` muestra `D` para los 7 archivos y para el gitlink `.claude/worktrees/bold-meninsky-a75726`; los 7 existen en disco; `git log -1` sigue en `b689c80` | Quitados del índice, presentes en disco, sin commit | PASA |
| 6 | `git check-ignore -v` devuelve regla para cada archivo del criterio 1 | Ver criterio 1. Hay un solo repo real (raíz), y las reglas de backend/frontend se aplican desde esa raíz | Cumple | PASA |
| 7 | `git ls-files` no lista los archivos; las migraciones siguen listadas | `git ls-files <los 7> .claude/worktrees` -> 0 líneas. `git ls-files \| grep -Ei 'seed\|truncate\|xlsx\|xls\|csv\|dump\|backup'` -> solo `backend/prisma/seed.ts` y `backend/src/domain/seed-work/{error-response,paginated-array}.ts` (legítimos). `git ls-files backend/prisma/migrations` -> 9 entradas (8 `migration.sql` + `migration_lock.toml`), igual a las 8 carpetas + lock de disco (`ls` = 9). `schema.prisma`, `seed.ts` y `dedup-patients.ts` siguen listados | Cumple | PASA |
| 8 | Archivos del inventario siguen en disco y los comandos de seed siguen funcionando | `-r` y `wc -c`: `seed.sql` 11587 B, `seed_test_users.sql` 6670 B, `seed_activities.sql` 286349 B, `seed_psicolsa.sql` 186002 B, `truncate.sql` 234 B, `generate_seed.py` 16761 B, `generate_seed_from_xlsx.py` 27290 B, todos legibles y con contenido. `.claude/worktrees/` conserva `bold-meninsky-a75726` y `gallant-nobel-2c467e`. `git status --ignored` los muestra como `!!`. Los seeds no se ejecutaron (por indicación), así que solo se verificó que existen y son legibles | Existen y son legibles | PASA (ver "No verificado") |
| 9 | `COMANDOS.md` aclara que los seeds son locales y no se versionan | Fuera del alcance de este tester | Pendiente (documentador) | PENDIENTE |

## Casos borde y negativos adicionales
- `seed-work/` no es capturado por `seeds/`, `seed-data/` ni `seed*.sql`: `backend/src/domain/seed-work/a.ts` no se ignora.
- `seed.ts` no es capturado por `seed*.sql`, porque exige la extensión `.sql`.
- Los patrones aplican a cualquier profundidad (por ejemplo `backend/prisma/seed_extra.sql`).
- `git ls-files -ci --exclude-standard` lista solo `.claude/settings.local.json` (trackeado e ignorado a la vez). Ya está señalado en 05 y 06 (H1) y no lo introduce este feature.
- `git status --short --ignored` ignora correctamente `backend/.env`, `node_modules`, `dist` y `.next`.

## Bugs
Ninguno en el feature.

Observaciones, no son fallos del feature:
1. `.claude/settings.local.json` está trackeado e ignorado a la vez (preexistente, ver 06 H1).
2. `.claude/settings.json` aparece modificado en el working tree (ver 04 y 05). Excluirlo del commit del feature.
3. Los patrones globales `*.csv`, `*.xlsx` y `*.xls` ocultarían fixtures o plantillas legítimos en el futuro. Habría que usar `!ruta` explícito.
4. Avisos de CRLF de git en los tres `.gitignore`. Son inofensivos.

## No verificado
- Los comandos de seed de `docs/auditoria/COMANDOS.md` no se ejecutaron contra la base (prohibido). Solo se comprobó que los archivos existen y se pueden leer.
- No se probó un clon nuevo ni un `git add .` real, que modifica el índice. Se lo reemplazó por `check-ignore --no-index`.
- No se probó el comportamiento tras el commit, que todavía no existe. Al hacerlo, los archivos salen del remoto pero quedan en el historial.
- El criterio 9 queda para el documentador.

VEREDICTO: APROBADO
