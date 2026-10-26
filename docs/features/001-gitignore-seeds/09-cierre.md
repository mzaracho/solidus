# 09 — Cierre: 001-gitignore-seeds

## Resultado
Feature **entregado**. Todas las etapas se aprobaron en la primera vuelta, sin rechazos ni
correcciones. No se hizo commit ni push: los cambios quedan en el working tree y en el índice
para que el usuario los revise y commitee.

## Qué se entregó
- **`.gitignore` raíz:** se agregó una sección para seeds y datos de prueba con `seed*.sql`,
  `truncate.sql`, `generate_seed*.py`, `*.xlsx`, `*.xls`, `*.csv`, `*.dump`, `*.backup`,
  `seed-data/`, `seeds/` y `.claude/worktrees/`. Se conservó `docs/auditoria/RIESGOS.md`.
- **`backend/.gitignore` y `frontend/.gitignore`:** se agregaron los mismos patrones preventivos.
  El contenido previo quedó intacto.
- **Bajas del índice (`git rm --cached`):** `seed.sql`, `seed_test_users.sql`, `seed_activities.sql`,
  `seed_psicolsa.sql`, `truncate.sql`, `generate_seed.py`, `generate_seed_from_xlsx.py` y el gitlink
  `.claude/worktrees/bold-meninsky-a75726`. Todos siguen en disco.
- **`docs/auditoria/COMANDOS.md`:** se agregó una nota que explica que los seeds son locales y no se
  versionan, y se ajustó la sección de usuarios de prueba.

## Verificación de criterios de aceptación
| # | Criterio | Evidencia | Estado |
|---|---|---|---|
| 1 | Raíz ignora los 7 archivos y `.claude/worktrees/` con patrones genéricos | `.gitignore` raíz (verificado por el PO); 07-testing (check-ignore) | Cumple |
| 2 | Patrones preventivos en raíz, backend y frontend | 04, 07-testing (25 rutas hipotéticas ignoradas) | Cumple |
| 3 | No se ignoran migraciones, `seed.ts`, `schema.prisma`, `dedup-patients.ts`, package/tsconfig; sin `*.sql`/`*.json` globales | 05, 06, 07 (casos negativos) | Cumple |
| 4 | Se conservó el contenido previo de los `.gitignore` | 05 y 07 (46 líneas agregadas, 0 eliminadas) | Cumple |
| 5 | Los archivos trackeados salieron del índice sin borrarse del disco y sin commit | 04, 07 (estado `D` en stage, HEAD en `b689c80`) | Cumple |
| 6 | `git check-ignore -v` devuelve una regla para cada archivo | 07-testing | Cumple |
| 7 | `git ls-files` no los lista y las migraciones siguen listadas | 07-testing (9 entradas en migrations) | Cumple |
| 8 | Los archivos siguen en disco y los comandos de seed siguen disponibles | 07-testing (existencia y lectura) | Cumple (*) |
| 9 | `COMANDOS.md` aclara que los seeds no se versionan | `COMANDOS.md` líneas 41-45 y 115 (verificado por el PO); 08 | Cumple |

(*) No se ejecutaron los seeds contra la base, a propósito, para no escribir datos. Como los
archivos y los comandos no cambiaron, se dan por funcionales.

## Desvío respecto de la spec
`backend/` y `frontend/` **no son repos independientes**, como dice `CLAUDE.md`. Son carpetas del
repo raíz desde el commit `b689c80`. Todas las operaciones git se hicieron en la raíz y el resultado
es equivalente.

## Pasos omitidos y por qué
- **UX/UI:** no hay interfaz de usuario.
- **Arquitecto:** es un cambio trivial de configuración de git, sin diseño técnico.
- El desarrollador, el revisor, seguridad, el tester y el documentador se ejecutaron todos.
- **06-seguridad.md:** el agente de seguridad no podía crear archivos. El PO transcribió su informe.

## Pendientes (fuera de alcance, a decisión del usuario)
1. **Secretos en `.claude/` (seguridad H1, MAYOR):**
   - `.claude/settings.json` (versionado) tiene permisos `curl` con un JWT completo y los ids de
     organización y de usuario.
   - `.claude/settings.local.json` está versionado aunque el `.gitignore` lo cubre, y tiene otro JWT,
     curl de login con contraseña y `PGPASSWORD`.
   - Recomendaciones: limpiar esas entradas, ejecutar `git rm --cached .claude/settings.local.json`
     y considerar rotar las credenciales. No se tocó por la regla 2 de CLAUDE.md.
2. **`.claude/settings.json` modificado en el working tree** por algo ajeno a este feature: excluirlo
   del commit.
3. **CLAUDE.md desactualizado:** dice que backend y frontend son repos independientes. La sección 1
   de `COMANDOS.md` repite el mismo error.
4. **Seguridad H2:**
   - Credenciales de Postgres de desarrollo en los `docker-compose.yml` y en `COMANDOS.md`.
   - Un curl con un correo de aspecto real y una contraseña en
     `docs/superpowers/plans/2026-04-22-multi-org-professional.md:139`. Confirmar si son datos reales.
5. **Opcional (H3/H4):** agregar excepciones `!ruta` si alguna vez se necesitan CSV o planillas
   versionadas, y patrones como `dump*.sql` y `export*.sql` para mayor cobertura.
6. **Historial:** los seeds siguen en los commits anteriores. El usuario lo aceptó y no se reescribió.

## Para commitear (cuando el usuario lo decida)
Incluir los tres `.gitignore`, las bajas del índice, `docs/auditoria/COMANDOS.md` y
`docs/features/001-gitignore-seeds/`. Excluir `.claude/settings.json`.
