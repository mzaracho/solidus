# 007 — Aislamiento entre organizaciones: pertenencia por recurso, permisos de carga y ConfigController

## Contexto
Desde el 005 cada request valida que el usuario pertenezca a la organización que pide (`OrgAccessGuard`),
pero las operaciones por `:id` no comprueban que **el recurso** sea de esa organización. Este feature toma
tres ítems del BACKLOG (P0) y el residual M-2 del 005 (06-seguridad):
- **#3, IDOR por `:id`.** Un usuario de la organización A que conoce un id de la organización B puede leer o
  modificar ese recurso. Endpoints por `:id` relevados por el PO (el arquitecto confirma y completa):
  - `activity`: `GET`, `PUT` y `DELETE :id`;
  - `v1/patients`: `GET :id/debt`, `GET :id/summary`, `POST :id/merge` (incluido el paciente destino del
    body) y `PUT :id`;
  - `org`: `categories/:id`, `presets/:id`, `staff/:id`, `staff/:id/category` y `activity-types/:id`;
  - `config`: `categories/:id` y `activity-types/:id`;
  - `pro`: `payers/:id`;
  - `settlements/:id/details` y `fee-engine/professional-categories/:id`.
  - Además: ids que vienen en el body o en la query y apuntan a otras entidades (`patientId`, `payerId`,
    `professionalId`, `activityTypeId`, `categoryId`, etc. al crear o editar), y los `lookup` por CUIT
    (`GET /system/professionals`, `org/staff/lookup` y `pro/payers/lookup`), que hoy consultan todas las
    organizaciones.
- **#4, `canLoadActivities` y ownership en el backend.**
  - El frontend oculta "Nueva atención" si el profesional no tiene permiso, pero el backend no lo garantiza en
    todos los caminos.
  - La regla de ownership de `update` y `delete` depende de `x-mode`, que manda el cliente.
  - No hay una política clara para `createdByUserId = null`.
- **#5, `ConfigController`.** Duplica escrituras de `OrgController`: categorías y tipos de actividad. No exige
  `ADMIN`. El frontend lo usa (`/config/categories` y `/config/activity-types` en `services/data.ts`), así que
  no se puede borrar sin migrar esas llamadas.

## Historia de usuario
Como responsable de la plataforma, quiero que ningún usuario pueda leer ni modificar datos de una
organización a la que no pertenece, aunque conozca los ids. También quiero que solo los administradores
cambien la configuración, y que los profesionales carguen o editen atenciones solo dentro de sus permisos.

## Política (decisión del PO)
- **Pertenencia del recurso:** todo recurso operado por id, en la ruta, el body o la query, debe pertenecer a
  la organización validada del request (`request.orgAccess`). Si no pertenece, o no existe, la respuesta es
  **404** con un cuerpo genérico e idéntico en los dos casos. Así no se revela que el id existe en otra
  organización.
  - Si el arquitecto justifica 403 para algún caso, se acepta, siempre que sea indistinguible entre
    "no existe" y "es de otra organización".
- **Escrituras de configuración** (categorías, presets, staff, tipos de actividad, reglas y settings de la
  organización): exigen rol `ADMIN` de la organización, tomado de la base como en el 005. Lo mismo vale para
  `ConfigController` y `OrgController`.
- **Lecturas de configuración** (por ejemplo, la lista de tipos de actividad o de categorías que usa el
  formulario de atención): cualquier miembro o profesional activo de la organización.
- **Carga de atenciones (`POST /activity`):**
  - permitida a miembros `ADMIN` o `MEMBER` de la organización;
  - un usuario cuyo único vínculo es un `Professional` necesita `canLoadActivities = true` en esa
    organización; si no lo tiene, 403;
  - un profesional sin membresía solo puede cargar atenciones a su propio `Professional`;
  - el arquitecto releva cómo funciona hoy y confirma o ajusta esta regla sin ampliar permisos.
- **Editar o borrar una atención (ownership), sin depender de `x-mode`:**
  - un `ADMIN` de la organización puede editar o borrar cualquier atención de su organización;
  - el resto, `MEMBER` o profesional, solo las suyas: `createdByUserId = sub`;
  - **`createdByUserId = null` (registros viejos):** solo `ADMIN`, o el usuario dueño del `Professional` de la
    atención (`Professional.userId = sub`);
  - se mantiene la regla actual de no borrar una atención cobrada con fecha de pago.
- **Lookup por CUIT:** se limita a la organización del request. Si el flujo de alta de staff necesita buscar
  usuarios fuera de la organización (vincular un profesional existente por CUIT), el arquitecto define la
  respuesta mínima, sin datos personales más allá de lo imprescindible, y exige `ADMIN`.

## Criterios de aceptación
1. **Relevamiento completo:** el diseño técnico lista todos los endpoints que reciben ids de recursos, en
   ruta, body o query, con la entidad, la forma de verificar la organización y la respuesta. Ninguno queda
   sin cubrir.
2. **IDOR en lectura:** cualquier `GET` por id de un recurso de otra organización responde 404 genérico, y lo
   mismo con un id inexistente.
3. **IDOR en escritura:** cualquier `PUT`, `POST` o `DELETE` sobre un recurso de otra organización responde
   404 genérico **sin modificar nada**. Las verificaciones van antes de cualquier escritura y, si hay varias
   escrituras, dentro de `prisma.$transaction` (regla 5).
4. **Ids referenciados:** al crear o editar, los ids del body o de la query que apuntan a otras entidades
   tienen que pertenecer a la misma organización (paciente, pagador, profesional, tipo de actividad, categoría,
   paciente destino del merge). Si alguno no pertenece, la respuesta es 404 genérico o 400, según el diseño,
   y no hay escritura.
5. **Escrituras de configuración solo para `ADMIN`:** un `MEMBER` o un profesional sin membresía recibe 403 en
   todas las escrituras de `org/*` y de `config/*`. Las lecturas que usan los formularios siguen funcionando
   para los roles que hoy las usan.
6. **`ConfigController`:** sus escrituras exigen `ADMIN` y validan la pertenencia por id. Alternativa: el
   arquitecto propone migrar el frontend a `org/*` y borrar las rutas duplicadas. En los dos casos, la UI de
   configuración sigue funcionando.
7. **`canLoadActivities`:** `POST /activity` de un usuario cuyo único vínculo es un `Professional` con
   `canLoadActivities = false` responde 403. Con `true` funciona. Un `ADMIN` o `MEMBER` puede cargar como hoy.
8. **Ownership sin `x-mode`:** las reglas de la política se aplican sin importar el valor de `x-mode`. Cambiar
   ese header no da más permisos.
9. **Lookup por CUIT:** no devuelve datos de otras organizaciones salvo lo que el diseño justifique para el
   alta de staff, y en ese caso con `ADMIN` y datos mínimos.
10. **Frontend:** los flujos que hoy funcionan siguen funcionando para un usuario legítimo:
    - dashboard, atenciones, pacientes (incluido el merge), profesionales, configuración, pagadores y
      liquidaciones;
    - si el frontend llamaba a alguna ruta que cambia, se actualiza;
    - un 403 o un 404 nuevo muestra el mensaje de error que ya existe, sin pantallas rotas.
11. **Tests (Jest):** por cada endpoint relevado, al menos un caso con un recurso de otra organización (404,
    sin escritura) y uno legítimo. Además:
    - `ADMIN`, `MEMBER` y profesional en escrituras de configuración;
    - `canLoadActivities` en `true` y en `false`;
    - ownership: propio, ajeno, `null` con el dueño del `Professional` y `null` con otro usuario, cada uno con
      `x-mode` en org y en pro;
    - un test estructural, tipo `security-invariants`, que falle si aparece un handler nuevo por `:id` sin
      verificar la organización, si el diseño lo permite.
12. **Calidad:**
    - `npx tsc --noEmit` sin errores en backend y frontend;
    - ESLint sin errores nuevos en los archivos tocados;
    - `npm test` del backend y del frontend en verde;
    - `npm run build` del frontend OK.
13. **Verificación en vivo (tester), sin escribir datos reales:**
    - lecturas por id cruzadas entre organizaciones con tokens firmados en memoria: deben dar 404;
    - escrituras cruzadas: solo en Jest, o en vivo únicamente si el tester puede garantizar que no se escribe
      nada (por ejemplo, un id inexistente);
    - `-Smoke` en desarrollo OK;
    - conteos (9 / 3 / 72 / 324 / 1483) iguales antes y después.
14. **Sin schema nuevo**, salvo que el arquitecto lo justifique; en ese caso, con migración (regla 6).

## Fuera de alcance
- Deducir el modo (org o pro) del rol en lugar de `x-mode` para elegir **qué datos se muestran**. Va en el
  feature 009. Acá solo se garantiza que `x-mode` no da permisos.
- Rate limiting, cookie `HttpOnly`, filtros de error (013) y `ValidationPipe` con `whitelist` (014).
- `ProductionController` y `ReportingController`, que no están registrados (011).
- Cambios de UX más allá de mantener los mensajes de error existentes.

## Riesgos
- **Superficie grande:** son muchos handlers. Un helper común, por ejemplo
  `assertBelongsToOrg(entity, id, orgId)` o `findFirst({ where: { id, organizationId } })`, reduce errores.
- **Entidades sin `organizationId` directo:** algunas cuelgan de otra (un split cuelga de un `WorkItem`). El
  arquitecto define cómo se resuelve cada una.
- **Romper la UI de configuración** si se migra `ConfigController`.
- **Usuarios legítimos que hoy hacen cosas que la política prohíbe** (por ejemplo, un `MEMBER` que edita
  configuración). El arquitecto releva el uso real. Si encuentra un conflicto, lo informa al PO antes de
  implementar.
- **Testing en vivo de escrituras:** riesgo de modificar datos si la protección falla. Por eso las escrituras
  cruzadas se prueban en Jest.

## Pasos del flujo
- Requiere UX/UI: **no**. No hay pantallas nuevas y los errores usan los mensajes existentes del 005. Si el
  arquitecto propone un cambio visible, se reevalúa.
- Requiere seguridad: **sí**.
- Arquitecto: **sí** (relevamiento y diseño).
- Documentador: **sí**.
- Cambios de schema: no previstos.
- Commit y push: autorizados por el usuario al aprobarse (sin force).

## Salvaguardas vigentes
- Sin seeds ni SQL de escritura; nunca escribir `BORRAR` en `-Seed`.
- Sin `down -v`, `prune` ni borrar volúmenes; sin stash, reset ni checkout.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
- No imprimir valores del `.env`. Regla 12 con `.claude/settings.json`.
