# 09 — Cierre: 008-fix-tabla-work-items

Fecha: 2026-11-02. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, sin vueltas de corrección (0 de 3).

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI, arquitecto, seguridad | — | Omitidos: arreglo de presentación en el frontend, sin endpoints nuevos (justificado en la spec) |
| Desarrollador | 04-implementacion.md | Completo |
| Revisor | 05-revision.md | APROBADO (4 menores) |
| Tester | 07-testing.md | APROBADO |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **`/[orgSlug]/work-items`:**
  - muestra las atenciones reales: 20 filas y "Mostrando 20 de 324", verificado en vivo con un `ADMIN` y un
    `MEMBER`;
  - las columnas se mapean desde la respuesta real de `GET /activity` (`mapActivityToWorkItem`);
  - estado y colores con `PAYMENT_STATUS`; se quitó el estado inexistente `Rejected`;
  - "Nuevo Item" quedó oculto.
- **Permisos de "Eliminar" en la UI:**
  - la regla quedó en `src/lib/activity-permissions.ts` (`canDeleteActivity`), compartida con `AdmisionesTable`;
  - `readSessionIdentity()` en `src/lib/session.ts` se usa solo para presentación;
  - "Eliminar" queda deshabilitado para el `MEMBER` en las atenciones ajenas.
- **`RetroactiveModal`:** adaptado a la nueva forma de los datos.
- **Tests del frontend:** 24 (antes 11).
- **Documentación:** BACKLOG #44 resuelto, más los nuevos #45 y #46, y una línea en `CLAUDE.md`.

## Verificación de los criterios (PO)
| Criterios | Estado |
|---|---|
| 1 a 5 | Cumplen; en vivo, el HTML del servidor tiene filas, total y no tiene "Nuevo Item" |
| 6 | Cumple en tests (`canDeleteActivity`, `readSessionIdentity`). El render deshabilitado depende de la hidratación y queda para la prueba manual |
| 7 | Cumple: sin cookie o vencida, va a `/login`; con una organización ajena, a `/sin-acceso` |
| 8 | Cumple: `tsc`, tests, build y lint sin errores nuevos |
| 9 | Cumple: `-Smoke` OK y conteos sin cambios |

## Pendiente
- **Prueba en el navegador** (07-testing, sección 7).
- **#45:** `PUT /activity/:id` ignora el monto y el pagador, pero la UI informa éxito. Se trata en el 016
  (dinero y motor de honorarios).
- **#46:** el tooltip de un ítem deshabilitado no se ve, y "Eliminar" aparece habilitado hasta que la página
  hidrata. Es un menor de UX.

## Pasos omitidos
UX/UI, arquitecto y seguridad, por lo que indica la spec.
