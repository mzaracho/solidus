# 001 — Excluir seeds y datos de prueba del control de versiones

## Contexto
El repo raíz tiene seeds SQL y scripts generadores con datos de prueba que hoy no están
ignorados (el `.gitignore` raíz solo contiene `docs/auditoria/RIESGOS.md`). Los datos se
generan desde planillas Excel que están fuera del repo (`C:\Users\Administrador\Downloads\Psico_LSA*.xlsx`).
El usuario pide que los seeds y los datos de prueba no se suban nunca a ningún repositorio.

Inventario relevado (repo raíz):

| Archivo | Tipo |
|---|---|
| `seed.sql` | seed SQL |
| `seed_test_users.sql` | seed SQL (usuarios y contraseñas de prueba) |
| `seed_activities.sql` | seed SQL generado desde Excel |
| `seed_psicolsa.sql` | seed SQL generado desde Excel (hace TRUNCATE) |
| `truncate.sql` | script de borrado de datos de prueba |
| `generate_seed.py` | generador de seeds (lee un Excel con datos) |
| `generate_seed_from_xlsx.py` | generador de seeds (lee un Excel con datos) |
| `.claude/worktrees/**` | worktrees temporales con copias de los seeds |

Backend: `backend/prisma/seed.ts` está deprecado, **no contiene datos** (solo imprime un aviso)
y lo usa el script `seed` de `backend/package.json`. Frontend: no tiene seeds ni datos de prueba.

## Historia de usuario
Como responsable del proyecto, quiero que los seeds y los datos de prueba queden fuera del
control de versiones de los tres repos (raíz, backend y frontend), para que nunca se suban
a un remoto aunque alguien haga `git add .`.

## Criterios de aceptación
1. El `.gitignore` de la raíz ignora `seed.sql`, `seed_test_users.sql`, `seed_activities.sql`,
   `seed_psicolsa.sql`, `truncate.sql`, `generate_seed.py`, `generate_seed_from_xlsx.py` y `.claude/worktrees/`.
   Usar patrones genéricos que cubran también seeds futuros (por ejemplo `seed*.sql`, `generate_seed*.py`).
2. Los `.gitignore` de raíz, backend y frontend ignoran también, de forma preventiva, los archivos
   de datos de origen y exportaciones: `*.xlsx`, `*.xls`, `*.csv`, `*.dump`, `*.backup`, y
   archivos `seed*.sql` o carpetas `seed-data/` / `seeds/` si llegaran a crearse.
3. Ningún patrón nuevo ignora archivos que deben versionarse. En particular, siguen versionados:
   `backend/prisma/migrations/**/migration.sql`, `backend/prisma/schema.prisma`,
   `backend/prisma/seed.ts`, `backend/prisma/dedup-patients.ts` y cualquier `package.json` o `tsconfig*.json`.
   No se usa `*.sql` ni `*.json` como patrón global.
4. Se mantiene la línea existente `docs/auditoria/RIESGOS.md` del `.gitignore` raíz y todo el contenido actual
   de los `.gitignore` de backend y frontend.
5. Si alguno de los archivos del criterio 1 ya está versionado, se lo saca del índice con
   `git rm --cached` (en el repo correspondiente) **sin borrarlo del disco**. No se hace commit ni push.
6. En cada repo, `git check-ignore -v <archivo>` devuelve una regla para cada archivo del criterio 1.
7. En cada repo, `git ls-files` no lista ninguno de los archivos del criterio 1, y
   `git ls-files backend/prisma/migrations` (o el equivalente dentro de `backend/`) sigue
   listando todas las migraciones.
8. Todos los archivos del inventario siguen existiendo en disco y funcionan los comandos de seed
   de `docs/auditoria/COMANDOS.md`.
9. `docs/auditoria/COMANDOS.md` aclara que los seeds y los scripts generadores son locales y
   no se versionan, y que en un clon nuevo no van a estar.

## Fuera de alcance
- Reescribir el historial de git (filter-repo/BFG) para borrar seeds de commits anteriores.
  Según el usuario son datos de prueba, así que no es un incidente.
- Ignorar `backend/prisma/seed.ts`: no contiene datos y lo usa `backend/package.json`.
  Ignorarlo rompería `npm run seed` en clones nuevos.
- Modificar el contenido de los seeds o de los scripts (por ejemplo, las rutas absolutas a `Downloads`).
- Crear una forma alternativa de distribuir los seeds al equipo.
- Hacer commit o push (el usuario hace el commit si lo desea).

## Riesgos
- **Clones nuevos sin seeds**: quien clone los repos no va a tener los datos de prueba. Se mitiga
  documentándolo (criterio 9).
- **Borrado en el remoto al commitear**: `git rm --cached` deja borrados en stage. Cuando el usuario
  haga commit y push, los archivos desaparecen del remoto (siguen en el historial).
- **Patrones demasiado amplios**: podrían ocultar migraciones u otros archivos necesarios. Se mitiga
  con el criterio 3 y su verificación (criterio 7).
- **Archivos ya versionados**: el `.gitignore` no tiene efecto sobre archivos ya trackeados. Se mitiga
  con el criterio 5.

## Pasos del flujo
- Requiere UX/UI: **no** (no hay interfaz).
- Requiere seguridad: **sí** (el objetivo es evitar la fuga de datos y credenciales de prueba).
- Arquitecto: **se omite**, por ser un cambio trivial de configuración de git sin diseño técnico.
- Documentador: **aplica**, solo para la nota del criterio 9 en `docs/auditoria/COMANDOS.md`.
- Cambios de schema: ninguno.
