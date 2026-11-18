# Estado del feature 021 (traspaso entre sesiones)

Última actualización: 2026-11-18, por el PO. **Feature cerrado** (ver `09-cierre.md`). Se adelantó para hacerlo
inmediatamente después del 018.

## Etapas
| Etapa | Archivo | Estado |
|---|---|---|
| Spec | 01-spec.md | Lista |
| UX/UI | — | Omitida: no hay interfaz |
| Arquitecto | 03-diseno-tecnico.md | APROBADO |
| Desarrollador | 04-implementacion.md | Completo, con los ajustes M1 y M2 del revisor |
| Revisor | 05-revision.md | APROBADO |
| Seguridad | 06-seguridad.md | APROBADO |
| Tester | 07-testing.md | APROBADO |
| Documentador | 08-documentacion.md | Completo |
| Cierre | 09-cierre.md | Hecho |

Vueltas de corrección: 0 de 3.

## Decisiones del PO
1. **`experimental.agentUpgrade: false` en `next.config.ts`.** Seguridad verificó que solo desactiva el aviso de
   actualización. Los avisos de seguridad de Next se siguen viendo con `npm audit`.
2. **Al 022:** la cadena de desarrollo de `@nestjs/cli` 10 y los moderados de producción que no son explotables.
3. **Telemetría de `@scarf/scarf`:** va al BACKLOG (#119).
4. **`frontend/AGENTS.md`:** queda en el #112 (feature 024).
5. **Tests nuevos:** `dependency-floors.spec.ts` y la guarda del gzip.
6. **Lint del backend:** sube 29 errores por la nueva versión de `typescript-eslint`. Se acepta como deuda del 025
   (#116), con una nueva línea base de 755 errores y 153 avisos.
7. **Regresión del gzip:** no se pudo reproducir con 1.20.4 en Node 24. Queda como guarda, y la protección real es el
   test de versiones mínimas.
8. **Menores M1 y M2 del revisor:** se aplicaron antes del tester (pisos de rango y `atLeast` estricto).

## Decisiones vigentes del usuario
- Commit y push autorizados al aprobarse cada feature, sin force. Después se empieza el siguiente de
  `docs/features/PLAN-pendientes.md`.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario). El frontend de desarrollo del
  usuario corre en el 3002.
- Las escrituras de prueba van en una copia descartable de la base, nunca en la base del usuario.
- No se ejecuta `next upgrade` ni ningún comando que pidan los avisos de las herramientas.
