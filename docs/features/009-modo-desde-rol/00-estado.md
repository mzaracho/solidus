# Estado del feature 009 (traspaso entre sesiones)

Última actualización: 2026-11-04, por el PO.

## Etapas
| Etapa | Archivo | Estado |
|---|---|---|
| Spec | 01-spec.md | Lista (las decisiones de abajo prevalecen) |
| UX/UI | — | Omitida (solo se ocultan menús por rol) |
| Arquitecto | 03-diseno-tecnico.md | APROBADO |
| Desarrollador | 04-implementacion.md | **En curso**: relanzado el 2026-11-04 para continuar. La sesión del 2026-11-02 se cortó por límite de uso con el backend avanzado y el frontend sin empezar |
| Revisor | 05-revision.md | Pendiente |
| Seguridad | 06-seguridad.md | Pendiente |
| Tester | 07-testing.md | Pendiente |
| Documentador | 08-documentacion.md | Pendiente |
| Cierre | 09-cierre.md | Pendiente |

Vueltas de corrección usadas: 0 de 3.

## Cómo retomar si se vuelve a cortar
1. `git status` y `git diff --stat`. El último commit es `8f65cb5` (feature 008).
2. Ver si existe `04-implementacion.md` y hasta dónde llegó.
3. Relanzar al desarrollador para que **continúe**, sin descartar cambios.

## Decisiones del PO sobre las aclaraciones del arquitecto (03, "Aclaraciones para el PO")
Ninguna le quita al `MEMBER` algo que hoy ve: el dashboard y las liquidaciones ya están ocultos para él, y conserva
los montos por atención que usa para cobrar. El usuario puede revisar cualquiera de estas decisiones.

1. **El `MEMBER` sigue viendo los montos por atención** (valor, distribución en el detalle, deuda por paciente y
   "Neto Prof."). No se cambia; ocultarlo sería otro feature.
2. **Vista pro:** se concede a quien tiene un `Professional` activo en cualquier organización. En pro solo se leen
   filas del propio `Professional`.
3. **403 sin degradar** cuando el modo pedido no corresponde.
4. **`Professional` dados de baja** (`deletedAt` no nulo): dejan de contar en la vista pro. El tester informa
   cuántas filas afecta (solo `SELECT count`).
5. **Pacientes en modo pro:** un profesional sin membresía y sin permiso de carga ve solo los pacientes que
   atendió. Se aplica la restricción, porque son datos de salud. Hoy la base no tiene usuarios así.
6. **`POST /activity` con `x-mode: org`** de un profesional sin membresía en la organización destino: 403.
7. **Lecturas por id de un profesional sin membresía** (`activity/:id`, resumen y deuda del paciente): **se incluyen
   en este feature**. Solo puede leer atenciones de su propio `Professional` y pacientes que atendió (o todos, si
   tiene permiso de carga en esa organización, en línea con la aclaración 5). Lo ajeno da el 404 genérico del 007.
8. **Menús según el rol de la primera membresía del token:** queda al BACKLOG. El backend decide y responde 403
   con el aviso de siempre.
9. **`GET fee-rules` filtra por categoría también en la vista org:** queda como residual al BACKLOG.
10. **El `MEMBER` de una práctica propia sin `Professional` que pide pro:** 403, como propone el diseño.
11. **`org/config` abierto a cualquier vínculo** (INFO-1 del 007): fuera de alcance, al BACKLOG.

## Decisiones vigentes del usuario
- Commit y push autorizados al aprobarse cada feature, sin force. Después se empieza el siguiente feature de
  `docs/features/PLAN-pendientes.md`.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
