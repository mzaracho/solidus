# Estado del feature 018 (traspaso entre sesiones)

Última actualización: 2026-11-18, por el PO. **Feature cerrado** (ver `09-cierre.md`).

## Etapas
| Etapa | Archivo | Estado |
|---|---|---|
| Spec | 01-spec.md | Lista |
| UX/UI | — | Omitida: no cambian pantallas ni textos |
| Arquitecto | 03-diseno-tecnico.md | APROBADO. Opción B |
| Desarrollador | 04-implementacion.md | Completo |
| Revisor | 05-revision.md | APROBADO |
| Seguridad | 06-seguridad.md | APROBADO |
| Tester | 07-testing.md | APROBADO, con reservas: Docker y navegador no verificables |
| Documentador | 08-documentacion.md | Completo |
| Cierre | 09-cierre.md | Hecho |

Vueltas de corrección: 0 de 3.

## Decisiones del PO sobre las preguntas del arquitecto (03)
1. **P1:** el compose local usa `AUTH_COOKIE_SECURE=false`. En producción la cookie sale con `Secure` por defecto.
2. **P2:** la revocación del JWT queda fuera (#106).
3. **P3:** la cookie se llama `solidus_session`, y el usuario tiene que volver a iniciar sesión una vez.
4. **P4:** el front y la API se abren en el mismo host. Separar los hosts queda en el #107.
5. **P5:** se autoriza probar Docker en un proyecto aislado. No se pudo verificar por buildx (#104).
6. **P6:** se quita el rewrite `/api`.
7. **P7:** Swagger con la cookie da 403 al escribir. Para escribir hay que usar "Authorize".

## Decisiones del PO sobre las preguntas del desarrollador (04)
1. **`NODE_ENV = local`:** no se toca el `.env` del usuario y se resuelve en el 024. Con ese valor la cookie sale con
   `Secure`, y el borrado sin `Secure` queda en el #109.
2. **`SecurityFatalError`:** viene del aviso de actualización de Next 16.4.3 y es anterior al 018. No se ejecuta
   `next upgrade` desde el aviso. **Se adelanta el feature 021** (audit fix y Next 16.4.6) para que sea el siguiente.
3. **Docker:** no se pudo verificar (#104, feature 020).

## Decisiones vigentes del usuario
- Commit y push autorizados al aprobarse cada feature, sin force. Después se empieza el siguiente de
  `docs/features/PLAN-pendientes.md`.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario). El frontend de desarrollo del
  usuario corre en el 3002.
- Las escrituras de prueba van en una copia descartable de la base, nunca en la base del usuario.
