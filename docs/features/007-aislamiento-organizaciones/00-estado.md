# Estado del feature 007 (traspaso entre sesiones)

Última actualización: 2026-11-02, por el PO.

## Etapas
| Etapa | Archivo | Estado |
|---|---|---|
| Spec | 01-spec.md | Lista (las decisiones de abajo prevalecen) |
| UX/UI | — | Omitida (sin pantallas nuevas) |
| Arquitecto | 03-diseno-tecnico.md | APROBADO |
| Desarrollador | 04-implementacion.md | En **vuelta de corrección 2** |
| Revisor | 05-revision.md | Vuelta 0: RECHAZADO (F-1). Vuelta 1: APROBADO. Se repite tras la vuelta 2 |
| Seguridad | 06-seguridad.md | RECHAZADO (ALTA-1: sin `x-org-id`, tres GET filtran por una organización undefined; MEDIA-1: `splits` sin validar; BAJA-2: merge) |
| Tester | 07-testing.md | Pendiente |
| Documentador | 08-documentacion.md | Pendiente |
| Cierre | 09-cierre.md | Pendiente |

Vueltas de corrección usadas: 2 de 3. Si la próxima revisión o la de seguridad vuelve a rechazar, el PO frena y
consulta al usuario.

## Decisiones del usuario (2026-11-02) sobre las aclaraciones 1, 2 y 4 del arquitecto
1. **MEMBER y atenciones ajenas (opción b).** Un `MEMBER` de la organización puede **editar y cobrar** (incluida la
   asistencia) cualquier atención de su organización, pero **solo borrar las propias** (`createdByUserId = sub`).
   El `ADMIN` puede todo. Un usuario cuyo único vínculo es un `Professional` solo edita y borra lo suyo: lo que
   cargó él o, si `createdByUserId` es null, las atenciones de su `Professional`. Ninguna regla depende de
   `x-mode`. Borrar una atención con `createdByUserId` null: solo el `ADMIN` o el dueño del `Professional`.
2. **`canLoadActivities` (opción a).** Se exige. Un usuario cuyo único vínculo es un `Professional` con
   `canLoadActivities = false` recibe 403 en `POST /activity`. El `ADMIN` lo habilita por profesional.
3. **"Reglas de Honorarios" en modo pro (opción a).** Las escrituras de reglas las puede hacer el `ADMIN` de la
   organización, o el profesional cuando la regla es de un pagador suyo (propuesta del arquitecto).

## Decisiones del PO sobre el resto de las aclaraciones del arquitecto
Aclaraciones 3 y 5 a 11, aceptadas tal como las propone el diseño:
- **Aclaración 3, modo pro:** un pagador de otra organización da 404 con el mensaje existente, sin ocultarlo en la UI.
- **Aclaración 5:** crear un pagador de la organización sin `Professional` exige `ADMIN`.
- **Aclaración 6:** se permiten co-participantes de la misma organización.
- **Aclaración 7:** se registra el handler que faltaba en `PUT v1/patients/:id`.
- **Aclaración 8:** la baja de staff da de baja al `User` solo si no tiene otros vínculos.
- **Aclaración 9:** se eliminan las rutas sin uso que lista el diseño.
- **Aclaración 10:** en `pro/deudores`, las acciones sobre atenciones de otras organizaciones dan 404.
- **Aclaración 11:** los tipos de actividad por defecto (sin organización) no los edita ni borra nadie.

Además, el PO acepta sobre la implementación (04, §7 y §8):
- **Desvíos de §7:** aceptados.
- **§8.2:** un co-participante sin membresía pierde la edición de atenciones ajenas. Es consecuencia de la
  decisión 1 y no se cambia.
- **§8.1:** se oculta "Eliminar" en `AdmisionesTable` para lo que el `MEMBER` no puede borrar. Se hizo en la vuelta 1.

Sobre la seguridad (06):
- **ALTA-1, MEDIA-1 y BAJA-2:** se corrigen en la vuelta 2.
- **MEDIA-1:** la política de la decisión 3 no cambia; solo se valida el esquema de `splits`.
- **BAJA-1:** se acepta, porque es la decisión 8.

## Decisiones vigentes del usuario
- Commit y push autorizados al aprobarse cada feature, sin force. Después se empieza el siguiente feature de
  `docs/features/PLAN-pendientes.md`.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
