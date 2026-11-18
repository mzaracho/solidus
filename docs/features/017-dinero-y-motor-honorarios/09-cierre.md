# 09 — Cierre: 017-dinero-y-motor-honorarios

Fecha: 2026-11-18. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, con **2 vueltas de corrección de 3**:
- **Vuelta 1:** el revisor encontró dos fallas.
  - Editar una atención antigua `PAID` sin fecha daba 400.
  - En deudores, la selección del cobro múltiple apuntaba a filas por índice.
- **Vuelta 2:** el tester encontró que `nest build` fallaba por re-exports con el alias `@src`.

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI | 02-ux.md | APROBADO |
| Arquitecto | 03-diseno-tecnico.md | APROBADO (el PO y el usuario resolvieron 7 preguntas) |
| Desarrollador | 04-implementacion.md | Completo, más los ajustes del PO y las vueltas 1 y 2 |
| Revisor | 05-revision.md | RECHAZADO, APROBADO (vuelta 1) y APROBADO (vuelta 2) |
| Seguridad | 06-seguridad.md | APROBADO en las tres pasadas, sin hallazgos críticos, altos ni medios |
| Tester | 07-testing.md | RECHAZADO (`nest build`) y APROBADO (vuelta 2) |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **Dinero exacto (#17):**
  - helper `money.ts` sobre `Prisma.Decimal`, con reparto por mayor resto;
  - lo usan el motor, el alta, la edición, el dashboard, las liquidaciones, los listados y la deuda de pacientes;
  - guardia `money-invariants`;
  - el formato JSON de las respuestas no cambia. Se agrega `isCollected` y desaparecen artefactos de coma flotante en
    el chart.
- **Motor (#40):**
  - la forma de `splits` es única;
  - un normalizador lee la forma vieja;
  - los `FIXED` se acotan a lo que queda del bruto;
  - un test de regresión fija los resultados previos.
- **Edición de monto y pagador (#45, opción A del usuario):**
  - se puede editar si la atención no está cobrada;
  - el recálculo va dentro de una transacción, con una condición en la escritura que cierra la carrera con el cobro
    (se probó con Postgres real);
  - si está cobrada, responde 409 `activity-already-collected`;
  - en el front:
    - el `RetroactiveModal` se reescribió: usa pagadores reales, ya no tiene la regla de 30 días ni el 70% inventado,
      y no informa éxito antes de que el backend confirme;
    - el `WorkItemForm` en edición manda solo los campos que cambiaron.
- **Fecha de pago obligatoria (pedido del usuario):**
  - el backend exige la fecha al pasar a `PAID` y responde 400 `payment-date-required` si falta;
  - todas las acciones que marcan como pagada la piden, en fecha local y precargada con el día;
  - en edición, una atención antigua sin fecha arranca con el campo vacío y la fecha no se manda si no se completa;
  - la tabla muestra "Sin fecha de pago";
  - en deudores se agregó el cobro múltiple, con selección por id.
- **Pagadores (#75 y criterio 17):**
  - borrar uno con reglas responde 409 `payer-has-fee-rules`; con atenciones, 409 `payer-has-activities`;
  - la FK `FeeRule.payer` pasa a `RESTRICT` (migración `20261118120000_fee_rule_payer_restrict`, ya aplicada en la
    base del usuario con los conteos sin cambios);
  - hay un botón "Eliminar pagador" para el ADMIN y el dueño.
- **Staff (#76):** si tiene participaciones o splits, se hace la baja lógica, también ante un P2003. Nunca da 500.
- **Guardia `nest-build-compat`:** prohíbe los re-exports con el alias `@src`.
- **`PacientesTable`:** se ocultó la acción de cobro, que era un `console.log`, y se quitó la selección sin uso.
- **Tests:** backend con 52 suites y 936 tests; frontend con 129 (antes 815 y 87).
- **Documentación:**
  - `CLAUDE.md`;
  - COMANDOS (`nest build`);
  - BACKLOG: #17, #40, #45, #75 y #76 resueltos, y nuevos #88 a #105;
  - la spec funcional;
  - RIESGOS (local);
  - `PLAN-pendientes.md`.

## Verificación de los criterios (PO)
| Criterios | Estado |
|---|---|
| 1, 2, 3, 4 | Cumplen: el helper y la guardia están en verde. Diez endpoints mantienen el formato frente a HEAD (07). Hay tests al centavo y no se migraron datos |
| 5, 6, 7 | Cumplen: la forma de `splits` es única, el normalizador funciona, la regresión pasa y los tests del tope de `FIXED` también |
| 8, 9 | Cumplen: probado por HTTP sobre una copia. Los splits suman el bruto (777,77 y 1000,01). Cobrada responde 409 sin cambios y el pagador ajeno da el mismo 404. Hubo 14 carreras sin estados mezclados |
| 10 | Cumple por código y tests. La prueba manual en el navegador queda sugerida al usuario |
| 11, 17 | Cumplen: 409 con reglas (la regla queda intacta), 409 con atenciones y borrado sin vínculos |
| 12 | Cumple: baja lógica con un P2003 real y borrado físico cuando no hay vínculos |
| 13 | Cumple: seguridad aprobó y los invariantes están en verde |
| 14 | Cumple tras la vuelta 2: `tsc`, `nest build`, tests y lint sin errores nuevos |
| 15 | Cumple: las escrituras se probaron en la copia. En la base del usuario solo se corrieron `.\dev.ps1` y `-Smoke`, y los conteos no cambiaron |
| 16 | Cumple: casos de 400 y 200 por HTTP, más tests de front que verifican el body completo y la fecha local. La UI queda para la prueba manual |

## Pendiente
- **Pruebas manuales en el navegador** (sección 8 de 07):
  - edición de una atención no cobrada;
  - campos bloqueados en una cobrada;
  - diálogo de fecha de pago;
  - borrado de pagador;
  - cobro múltiple en deudores.
- **Build Docker del backend:** no se verificó, porque buildx pide un permiso `fs.read` (#104, feature 020).
- **BACKLOG #88 a #105.** Los principales:
  - reglas `'all'` que el motor no aplica y pagadores que no se pueden borrar desde la UI (#88, #89);
  - `PacientesTable` rota (#93);
  - descobrar y editar (#95);
  - fecha reutilizada al volver a `PAID` (#96);
  - Next 16.4.6 (#103, feature 021).
- **42 atenciones antiguas `PAID` sin fecha:** se completan a mano desde la edición (#91).

## Pasos omitidos
Ninguno. El criterio 16 no pasó por UX ni por el arquitecto: lo especificó el PO directamente en la spec, porque era
un campo de fecha dentro de diálogos que ya existían.
