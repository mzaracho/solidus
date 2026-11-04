# Estado del feature 013 (traspaso entre sesiones)

Última actualización: 2026-11-04, por el PO.

## Etapas
| Etapa | Archivo | Estado |
|---|---|---|
| Spec | 01-spec.md | Lista (las decisiones de abajo prevalecen) |
| UX/UI | — | Omitida (mensajes existentes o genéricos en español) |
| Arquitecto | 03-diseno-tecnico.md | APROBADO |
| Desarrollador | 04-implementacion.md | Pendiente: arranca **después del commit del 012**, porque los dos tocan `data.ts` y el login |
| Revisor | 05-revision.md | Pendiente |
| Seguridad | 06-seguridad.md | Pendiente |
| Tester | 07-testing.md | Pendiente |
| Documentador | 08-documentacion.md | Pendiente |
| Cierre | 09-cierre.md | Pendiente |

Vueltas de corrección usadas: 0 de 3.

## Decisiones del PO sobre las aclaraciones del arquitecto (03, §10)
Se aceptan las 9 opciones por defecto del diseño. Ninguna cambia lo que hoy ve el usuario:
1. **Regla de primera carga:** 400 `first-load-required`, no 403. Así el usuario ve la regla en lugar del aviso
   genérico de permisos.
2. **401, 403 y 404:** siempre con mensaje genérico, conservando el código. El 403 de "atención ya cobrada" pierde su
   texto en la respuesta, pero la pantalla ya mostraba el aviso genérico. Pasarlo a 409 va al BACKLOG.
3. **Identificador de error:** solo en el header `X-Error-Id` y en el log, no en el body ni en la pantalla.
4. **Mensajes de validación:** salen de la API en inglés (class-validator); el frontend muestra un genérico en
   español.
5. **Errores de unicidad o clave foránea de Prisma:** siguen como 500 genérico. Pasarlos a 409 va al BACKLOG, porque
   requiere analizar la enumeración por campos únicos.
6. **Falla de base:** 500, no 503.
7. **`axios` y `@nestjs/axios` sin uso:** quitarlos va al BACKLOG (o al 020, audit-fix).
8. **I-4 del 010:** los errores de `next(err)` los toman los filtros de Nest y no el handler de Express. Igual se agrega
   el manejador final como defensa en profundidad. El documentador corrige la nota del BACKLOG.
9. **Organización inexistente en `fee-resolution`:** 500 controlado, sin el id.

## Decisiones vigentes del usuario
- Commit y push autorizados al aprobarse cada feature, sin force. Después se empieza el siguiente feature de
  `docs/features/PLAN-pendientes.md`.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
