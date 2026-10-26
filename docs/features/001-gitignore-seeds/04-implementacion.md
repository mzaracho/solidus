# 04 - Implementación: 001-gitignore-seeds

Criterios 1 a 8 de la spec. El criterio 9 (docs/auditoria/COMANDOS.md) queda para el documentador.
No se hizo commit ni push. No se modificó contenido de seeds, scripts, `.env` ni la configuración de `.claude/`.

## Hallazgo clave (desvío respecto de la spec)
La spec habla de "tres repos git independientes". En la práctica **`backend/` y `frontend/` no tienen `.git` propio**:
el commit `b689c80 "Incluir backend y frontend como archivos del repo"` los incorporó como archivos normales al repo raíz
(158 archivos de backend y 111 de frontend trackeados desde la raíz). Hay **un único repo git** (la raíz).
Por eso los `.gitignore` de `backend/` y `frontend/` se aplican igual (git lee `.gitignore` anidados), pero todo
`git ls-files` / `git rm --cached` se hizo en la raíz. No hizo falta sacar nada del índice por backend/frontend:
no había seeds ni datos trackeados en ellos (`backend/prisma/seed.ts` no contiene datos y se conserva).

## Archivos modificados
- `c:\Repositorios\healthops-gem\.gitignore` (se conserva `docs/auditoria/RIESGOS.md`)
- `c:\Repositorios\healthops-gem\backend\.gitignore` (contenido previo intacto)
- `c:\Repositorios\healthops-gem\frontend\.gitignore` (contenido previo intacto)

### Bloque agregado al `.gitignore` raíz
```
# --- Seeds y datos de prueba (locales, no se versionan) ---
# Seeds SQL, scripts generadores y script de borrado de datos de prueba
seed*.sql
truncate.sql
generate_seed*.py

# Archivos de datos de origen y exportaciones (planillas, volcados)
*.xlsx
*.xls
*.csv
*.dump
*.backup

# Carpetas de seeds/datos (por si se crean)
seed-data/
seeds/

# Worktrees temporales de Claude (contienen copias de los seeds)
.claude/worktrees/
```

### Bloque agregado a `backend/.gitignore` y `frontend/.gitignore` (idéntico)
```
# --- Seeds y datos de prueba (locales, no se versionan) ---
# Seeds SQL y archivos de datos de origen/exportaciones (no afecta migrations/*.sql ni prisma/seed.ts)
seed*.sql
*.xlsx
*.xls
*.csv
*.dump
*.backup

# Carpetas de seeds/datos (por si se crean)
seed-data/
seeds/
```
No se usó `*.sql` ni `*.json` global. `truncate.sql` y `generate_seed*.py` solo van en la raíz (no existen en backend/frontend).

## Archivos sacados del índice (`git rm --cached`, repo raíz; siguen en disco)
- `seed.sql`, `seed_test_users.sql`, `seed_activities.sql`, `seed_psicolsa.sql`
- `truncate.sql`
- `generate_seed.py`, `generate_seed_from_xlsx.py`
- `.claude/worktrees/bold-meninsky-a75726` (estaba trackeado como gitlink, modo 160000; es un worktree con copias de seeds)

## Verificaciones
`git check-ignore -v` (cada archivo del criterio 1):
```
.gitignore:5:seed*.sql	seed.sql
.gitignore:5:seed*.sql	seed_test_users.sql
.gitignore:5:seed*.sql	seed_activities.sql
.gitignore:5:seed*.sql	seed_psicolsa.sql
.gitignore:6:truncate.sql	truncate.sql
.gitignore:7:generate_seed*.py	generate_seed.py
.gitignore:7:generate_seed*.py	generate_seed_from_xlsx.py
.gitignore:21:.claude/worktrees/	.claude/worktrees/bold-meninsky-a75726/seed.sql
.gitignore:21:.claude/worktrees/	.claude/worktrees/
```
Reglas de backend/frontend (rutas hipotéticas): `backend/.gitignore:62:seed*.sql` (backend/seed.sql),
`backend/.gitignore:63:*.xlsx`, `frontend/.gitignore:54:seeds/`, `frontend/.gitignore:48:*.csv`.

No ignorados (correcto): `backend/prisma/seed.ts`, `backend/prisma/migrations/*/migration.sql`,
`backend/package.json`, `backend/src/domain/seed-work/*` (`check-ignore` sin salida).

Migraciones: `git ls-files backend/prisma/migrations` lista 9 entradas (8 `migration.sql` + `migration_lock.toml`);
`backend/prisma/seed.ts` sigue trackeado.

En disco siguen existiendo los 7 archivos del inventario y `.claude/worktrees/bold-meninsky-a75726/seed.sql`.

`git status --short` (único repo):
```
 M .claude/settings.json
D  .claude/worktrees/bold-meninsky-a75726
 M .gitignore
 M backend/.gitignore
 M frontend/.gitignore
D  generate_seed.py
D  generate_seed_from_xlsx.py
D  seed.sql
D  seed_activities.sql
D  seed_psicolsa.sql
D  seed_test_users.sql
D  truncate.sql
?? docs/features/
```

## Cómo probarlo
`git check-ignore -v seed.sql truncate.sql generate_seed.py`, `git ls-files | grep -Ei "seed|truncate"` (solo debe
quedar `backend/prisma/seed.ts` y `backend/src/domain/seed-work/*`), y `git ls-files backend/prisma/migrations`.

## Dudas pendientes / avisos
- `.claude/settings.json` aparece modificado, pero **no lo toqué yo**: no figuraba en el estado inicial, así que lo cambió
  otro proceso durante la sesión. Conviene revisarlo antes de commitear.
- Al commitear, los archivos sacados del índice desaparecen del remoto (siguen en el historial, fuera de alcance).
- Los patrones `*.csv`/`*.xlsx` aplican a todo el repo; hoy no hay archivos trackeados con esas extensiones.
- Criterios 6 y 7 "en cada repo": se cumplen desde el único repo real (raíz); backend y frontend no son repos separados.
