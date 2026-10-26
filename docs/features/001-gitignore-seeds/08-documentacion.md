# 08 - Documentación: 001-gitignore-seeds

Alcance: solo el criterio 9 de la spec. No se tocó código fuente, `.gitignore`, `.claude/` ni el índice de git
(sin `git add`, commit ni push). No se copiaron credenciales ni tokens.

## Archivos modificados
- `c:\Repositorios\healthops-gem\docs\auditoria\COMANDOS.md`

## Cambios realizados en COMANDOS.md
1. Sección "Seeds (SQL en la raíz, aplicados a mano)": nota nueva, después de la línea sobre `prisma/seed.ts`, que dice:
   - los seeds (`seed*.sql`, `truncate.sql`) y los scripts generadores (`generate_seed*.py`) son locales y no se
     versionan (están en `.gitignore`);
   - en un clon nuevo no van a estar y hay que obtenerlos por otro canal o regenerarlos;
   - las planillas de origen (`*.xlsx`, `*.xls`) y las exportaciones (`*.csv`, `*.dump`, `*.backup`) también están ignoradas;
   - `backend/prisma/seed.ts` y las migraciones sí se versionan.
2. Sección 6 "Usuarios de prueba": se aclaró que `seed_test_users.sql` es un archivo local no versionado (ignorado por
   `seed*.sql`) y que en un clon nuevo hay que obtenerlo por otro canal. Se mantuvo el resto del texto.

Fuente de lo documentado: bloques de `.gitignore` y verificaciones de `04-implementacion.md`, `05-revision.md` y `07-testing.md`.

## Pendientes de documentación (no corregidos por restricción de alcance)
1. **CLAUDE.md desactualizado** (`.claude/CLAUDE.md`, no modificable sin pedido explícito): afirma que `backend/` y `frontend/`
   son repos git independientes. Según 04 y 05, no tienen `.git` propio y desde el commit `b689c80` están incluidos en el repo
   raíz (un único repo). Conviene corregir las secciones "Estructura" y "Flujo de trabajo". También podría agregar, brevemente,
   que los seeds son locales y están en `.gitignore`.
2. **COMANDOS.md, sección 1 "Obtener el código"**: sigue diciendo que `backend` y `frontend` son repos independientes y que
   hay que clonarlos por separado. Es la misma inconsistencia, fuera del criterio 9. Hay que revisarla junto con CLAUDE.md.
3. **Hallazgo de seguridad H1 (06-seguridad.md)**: `.claude/settings.json` y `.claude/settings.local.json` contienen JWT,
   ids de organización y usuario, y credenciales de prueba en permisos `Bash(...)`. Va contra la regla 3 de CLAUDE.md.
   Recomendado: quitar esas entradas, ejecutar `git rm --cached .claude/settings.local.json` y considerar rotar las credenciales.
   No se corrigió.
4. **`.claude/settings.json` modificado en el working tree** por otro proceso (ver 04 y 05): excluirlo del commit del feature.
5. **Cadena de conexión de desarrollo en COMANDOS.md** (líneas 22 y 47): se repite el usuario/contraseña de Postgres local
   (06 H2, menor). No se tocó.
6. **Patrones globales `*.csv`/`*.xlsx`/`*.xls`**: podrían ocultar plantillas o fixtures legítimos en el futuro; se resuelve
   con `!ruta` explícito (05 y 06 H3). La nota de COMANDOS.md no lo menciona.
7. **Al commitear**: los seeds salen del remoto pero quedan en el historial (fuera de alcance según la spec).
8. **Verificación pendiente**: los comandos de seed de COMANDOS.md no se ejecutaron contra la base (07, "No verificado").

## Estado de la spec
Criterio 9: cumplido con este cambio.
