# 09 — Cierre: 015-transacciones

Fecha: 2026-11-04. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, sin vueltas de corrección (0 de 3).

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI | — | Omitida |
| Arquitecto | 03-diseno-tecnico.md | APROBADO. No quedaba ninguna operación con varias escrituras fuera de transacción |
| Desarrollador | 04-implementacion.md | Completo (incluye el #70 del 014) |
| Revisor | 05-revision.md | APROBADO (6 menores) |
| Seguridad | 06-seguridad.md | APROBADO (3 menores) |
| Tester | 07-testing.md | APROBADO; las escrituras se probaron sobre una copia descartable de la base |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **Guardia estática** (`src/transactions-invariants.spec.ts`, con el analizador `test/helpers/prisma-writes.ts` sobre
  el compilador de TypeScript):
  - prohíbe dos o más escrituras fuera de `$transaction`;
  - prohíbe `this.prisma` dentro de una transacción;
  - prohíbe la forma de arreglo;
  - la lista blanca está vacía, y hay pruebas del propio detector.
- **`fake-prisma`:**
  - rollback real;
  - marca de las escrituras hechas dentro de una transacción;
  - `failOn` para provocar fallos;
  - P2025 real.
- **Tests de atomicidad:** alta de atención, baja de staff y merge, con fallos a mitad de camino.
- **Carreras cerradas:**
  - el merge bloquea los dos pacientes y vuelve a verificarlos, con 404 si falta alguno;
  - el borrado de una atención lleva la salvaguarda de "cobrada" en el `where`, así que con P2025 responde el 403 o el
    404 de siempre.
- **#70 (del 014):**
  - `canLoadActivities` en `null` da 400;
  - tests de roles inválidos;
  - comentarios de `ActivityTypeRoleDto`;
  - imports.
- **Tests:** backend con 45 suites y 815 tests.
- **Documentación:**
  - `CLAUDE.md`: regla 5 y conteos;
  - BACKLOG: #16 y #70 resueltos, nuevos #71 a #77;
  - COMANDOS;
  - RIESGOS (local).

## Verificación de los criterios (PO)
| Criterios | Estado |
|---|---|
| 1, 2 | Cumplen: relevamiento completo, y las operaciones con varias escrituras ya estaban en transacción |
| 3, 4, 5 | Cumplen: cliente `tx` en los servicios auxiliares, sin cambios de respuesta y con la guardia activa |
| 6 | Cumple en Jest; en Postgres real, sobre la copia: cobrada da 403, no cobrada da 200, merge OK y ajeno da 404 |
| 7 | Cumple |
| 8 | Cumple: `-Smoke` OK y los conteos sin cambios en la base del usuario |

## Pendiente
- **#71:** limitaciones del detector (025).
- **#72:** deadlock en fusiones cruzadas.
- **#73:** restricciones únicas y `onDelete: Restrict`.
- **#74:** ventana residual al fusionar.
- **#75:** borrar un pagador que tiene reglas (017).
- **#76:** borrado de staff participante o beneficiario (017).
- **#77:** el Dockerfile corre `migrate deploy` con `;` en lugar de `&&` (020).
- **No se probó en vivo:** la colisión real de dos sesiones; está cubierta con mocks.
- **Volúmenes anónimos de Docker** ajenos al feature: los revisa el usuario.

## Pasos omitidos
UX/UI.
