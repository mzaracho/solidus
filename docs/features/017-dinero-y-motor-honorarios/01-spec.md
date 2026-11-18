# 017 — Dinero exacto, motor de honorarios y bajas con historial

Ítems del BACKLOG: #17, #40, #45, #75 y #76.

## Contexto
- **#17:** los cálculos de dinero (splits, honorarios de participantes, KPIs del dashboard y liquidaciones) se hacen
  en parte con `number` de JavaScript. Las columnas son `Decimal(10,2)` y `CLAUDE.md` pide `Prisma.Decimal` en los
  cálculos.
- **#40:** la UI arma los `splits` como `{role, percentage, beneficiaryType}` y `FeeResolutionService`
  (`backend/src/infrastructure/features/fee-engine/fee-resolution.service.ts`) los espera como
  `{beneficiary, type, value}`. Además, `computeAmounts` no acota los montos `FIXED`, así que pueden superar el bruto
  de la atención.
- **#45:** `PUT /activity/:id` (`update-activity-command.ts`) ignora el monto (`grossAmount`) y el pagador, pero
  `workload/RetroactiveModal` y otros formularios permiten cambiarlos y la UI informa éxito. Además, cuando falta el
  pagador se muestra "—" y ese texto se reenvía como valor (M2 del 008).
- **#75:** borrar un pagador que tiene fee rules deja las reglas como globales. El 015 dejó un 409 provisional.
- **#76:** borrar físicamente un staff sin usuario y sin atenciones propias falla con 500 si es participante de
  atenciones (FK `RESTRICT`) o beneficiario de splits (`staff-commands.ts`, `DeleteStaffCommandHandler`, regla 1).

## Decisiones del usuario
- **#75 (2026-11-18):** borrar un pagador con fee rules responde **409** con un mensaje que lo explica. No se borran
  las reglas.
- **#45 (2026-11-18), opción A:**
  - el monto y el pagador **se pueden editar mientras la atención no esté cobrada**;
  - al guardar, el backend recalcula los honorarios de los participantes y la distribución con las reglas vigentes,
    y reemplaza cualquier ajuste manual previo;
  - si la atención está cobrada, la UI muestra esos campos deshabilitados con un texto que lo explica, y el backend
    rechaza el cambio.
- **"Cobrada" (2026-11-18), opción A:** cobrada es `paymentStatus = PAID` **con** `paymentDate`, la misma condición
  que la salvaguarda del borrado.
- **Fecha de pago obligatoria (2026-11-18).** Al marcar una atención como pagada siempre hay que indicar la fecha real
  de pago, para no perder cuándo se pagó. Ver el criterio 16.

## Decisiones del PO
- **#76:** se extiende la regla 2 que ya existe. Un staff sin usuario que es participante de alguna atención o
  beneficiario de algún split se da de **baja lógica** (`deletedAt`), igual que el que tiene atenciones propias. No se
  pierde historial y no cambia la experiencia.
- **#17:** los registros existentes no se recalculan. Los cálculos nuevos pueden diferir en centavos de los que se
  hacían con `number`; se acepta, porque los nuevos son los exactos.
- El resto de las decisiones, sobre UX y sobre el diseño, están en `00-estado.md`.

## Historia de usuario
Como administrador de una organización de salud, quiero que los montos se calculen al centavo, que una atención mal
cargada se pueda corregir (monto y pagador) antes de cobrarla, y que cada pago registre cuándo se hizo. También quiero
que borrar un pagador o un profesional nunca rompa el historial ni dé un error inesperado.

## Criterios de aceptación
### Dinero exacto (#17)
1. **Aritmética sin `number`:**
   - los cálculos de dinero de splits, honorarios de participantes, KPIs del dashboard, liquidaciones y deuda de
     pacientes usan `Prisma.Decimal` (o un helper común basado en él);
   - no queda aritmética de dinero con `number`, `parseFloat` ni `Number()` en esos caminos;
   - el arquitecto lista los caminos y deja una guardia, un test o un invariante, que lo vigile.
2. **Contrato de la API:** el formato JSON de los montos en las respuestas no cambia respecto de hoy. Si algún endpoint
   devolvía `number` y conviene cambiarlo, el arquitecto lo consulta antes.
3. **Distribución al centavo:**
   - la suma de los montos distribuidos por porcentaje es exactamente igual al monto a distribuir, al centavo;
   - el resto del redondeo se asigna de forma determinista, con la regla que defina el arquitecto;
   - hay tests con casos como 100 en 3 partes, 0.1 + 0.2 y montos de 2 decimales.
4. **Sin cambios en datos existentes:** no hay migración de datos ni recálculo de los registros guardados.

### Motor de honorarios (#40)
5. **Forma única de `splits`:**
   - la UI, los DTOs y `FeeResolutionService` usan la misma forma;
   - si hay reglas guardadas en la forma vieja (en un JSON, por ejemplo), se siguen leyendo bien, ya sea por
     compatibilidad de lectura o por una migración de datos sin pérdida;
   - el arquitecto releva cuántas hay en la base local, solo con lectura.
6. **Mismo resultado con las reglas existentes:** dan el mismo resultado que antes, salvo el tope del criterio 7 y los
   centavos del criterio 3. Hay un test de regresión con los casos actuales.
7. **Tope de `FIXED`:**
   - cada monto `FIXED` se limita a lo que queda disponible del bruto: `min(valor, bruto − ya asignado)`, con mínimo 0;
   - nunca se asigna más que el bruto;
   - hay tests con un `FIXED` mayor que el bruto y con varios `FIXED` que juntos lo superan.

### Edición de monto y pagador (#45)
8. **Atención no cobrada:**
   - `PUT /activity/:id` persiste `grossAmount` y el pagador;
   - recalcula los participantes y los splits con las reglas vigentes;
   - todo va en una transacción (regla 5);
   - el pagador se verifica contra la organización: si es ajeno o inexistente, 404 genérico idéntico;
   - los permisos son los del 007: ADMIN, MEMBER, y el profesional sobre lo suyo.
9. **Atención cobrada:**
   - "cobrada" es `PAID` con `paymentDate`, la misma definición que la salvaguarda del borrado;
   - cambiar el monto o el pagador responde **409** con un `code` propio y un mensaje en español, sin aplicar ningún
     cambio;
   - mandar los mismos valores guardados no cuenta como cambio;
   - editar los demás campos sigue funcionando;
   - el estado se evalúa contra lo guardado, con la condición en la escritura, para que no haya carrera con un cobro
     simultáneo;
   - el arquitecto define qué pasa si el mismo pedido marca la atención como cobrada y cambia el monto.
10. **Frontend:**
    - `RetroactiveModal` y los demás formularios que editan una atención habilitan el monto y el pagador solo si la
      atención no está cobrada; si está cobrada, se ven deshabilitados con un texto que lo explica (lo diseña UX);
    - la falta de pagador no se muestra como "—" ni se reenvía como valor (M2);
    - los errores pasan por `api-errors.ts`;
    - se actualizan los builders de `request-bodies.ts` y el fixture de contrato.

### Pagador con reglas (#75)
11. **Borrado con fee rules:**
    - `DELETE` de un pagador con fee rules responde **409** con un `code` propio y un mensaje en español que dice que
      tiene reglas de honorarios asociadas;
    - no se borran ni se modifican las reglas;
    - la verificación no tiene carrera: va en la transacción o se apoya en la restricción;
    - un pagador sin reglas se borra como hoy;
    - la UI muestra el mensaje.
    - El arquitecto releva qué pasa hoy con un pagador que tiene atenciones y lo informa. Si eso cambia el
      comportamiento, se consulta.

### Staff participante o beneficiario (#76)
12. **Baja lógica en lugar de error:**
    - borrar un staff sin usuario que es participante de alguna atención o beneficiario de algún split hace la baja
      lógica, no un 500;
    - se conservan las participaciones y los splits;
    - un staff sin ningún vínculo se sigue borrando físicamente;
    - los casos con usuario no cambian;
    - si aparece un vínculo entre la verificación y el borrado, el resultado es la baja lógica o un 409, nunca un 500.

### Generales
13. **Seguridad:**
    - siguen en verde `security-invariants`, `org-isolation` (con los casos de rutas nuevas o cambiadas),
      `request-dto-invariants` y `transactions-invariants`;
    - los campos nuevos de los DTOs se validan (`IsMoney`, UUID);
    - los errores nuevos siguen el contrato del 013.
14. **Calidad:**
    - `npx tsc --noEmit` sin errores en backend y frontend;
    - tests de backend y frontend en verde, con tests nuevos para cada criterio;
    - lint sin errores nuevos en los archivos tocados;
    - si hay cambio de schema, aplica la regla 6: migración sin `migrate dev` contra la base del usuario y
      `-CheckMigrations` en 0.
15. **Pruebas en Postgres real:** todo lo que escriba se prueba en una copia descartable de la base, nunca en la base
    del usuario. En la base del usuario solo se permite leer, más `.\dev.ps1` y `-Smoke`.

### Agregados del 2026-11-18
16. **Fecha de pago obligatoria al marcar como pagada:**
    - **Backend:** todo pedido de alta o de edición que deje la atención en `PAID` exige `paymentDate`. Vale tanto si
      la fecha viene en el pedido como si ya estaba guardada.
    - Si falta, responde 400 con un `code` propio (sugerido `payment-date-required`) y un mensaje en español, sin
      aplicar ningún cambio.
    - Se valida que sea una fecha válida.
    - Las ediciones que no tocan `paymentStatus` en las atenciones antiguas que están `PAID` sin fecha no se bloquean.
      Esas atenciones se pueden completar agregándoles la fecha.
    - **Frontend:** todas las acciones que marcan como pagada piden la fecha de pago: "Marcar pagado", la pantalla de
      deudores (también el cobro de varias atenciones a la vez, con una sola fecha para todas), el alta y el formulario
      de edición.
    - El campo "Fecha de pago" es visible y obligatorio. Viene precargado con la fecha del día y se puede cambiar.
    - No se puede confirmar sin una fecha válida.
    - La fecha se manda y se muestra en la zona horaria local, sin correrse un día.
    - En las atenciones `PAID` sin fecha, la tabla muestra "Sin fecha de pago" en lugar de dejar el campo vacío.
    - Los textos nuevos van en `constants.ts`, y los errores pasan por `api-errors.ts`.
    - Se actualizan los builders y el fixture de contrato.
17. **Pagador con atenciones:**
    - `DELETE` de un pagador que tiene atenciones responde **409** con un `code` propio (sugerido
      `payer-has-activities`) y un mensaje en español, no 500;
    - no se borra nada;
    - el botón "Eliminar pagador" lo ven ADMIN y el dueño del pagador, como autoriza el backend.

## Fuera de alcance
- Recalcular atenciones ya guardadas o liquidaciones pasadas.
- Completar automáticamente la fecha de las atenciones antiguas `PAID` sin fecha (hay 42 en la base local); se
  completan a mano desde la edición.
- Persistir o cerrar liquidaciones.
- Rediseñar la pantalla de reglas de honorarios, salvo lo que exija la forma única de `splits`. Las reglas con `'all'`
  que el motor no aplica van al BACKLOG.
- Restricciones únicas y `onDelete` generales (#73), carreras de merge (#72, #74) y permisos finos (029).

## Riesgos
- **Diferencias de centavos** en los cálculos nuevos respecto de los anteriores. Están aceptadas y documentadas.
- **Datos guardados en la forma vieja de `splits`:** romperlos alteraría los honorarios. Se mitiga con compatibilidad o
  migración, y con el test de regresión.
- **El recálculo pisa ajustes manuales** de la distribución. Es lo que decidió el usuario; la UI debería avisarlo.
- **Carrera entre la edición y el cobro:** se cierra con la condición en la escritura.
- **Staff dado de baja** que sigue apareciendo en el historial: se tiene que seguir mostrando su nombre.
- **Precargar la fecha del día** puede llevar a aceptar una fecha que no es la real. Se mitiga con el campo visible y
  la etiqueta "Fecha de pago".
- **Zona horaria:** una fecha de pago que se corre un día. Se cubre con tests.

## Pasos del flujo
- Requiere UX/UI: **sí**:
  - los estados de los campos monto y pagador en la edición (habilitado, deshabilitado por cobrada);
  - el aviso de recálculo;
  - el mensaje del 409 al borrar un pagador;
  - el pagador vacío.
  - El criterio 16 lo detalla el PO en esta spec, porque es un campo de fecha dentro de los diálogos existentes.
- Requiere seguridad: **sí**: escrituras nuevas, verificación de ids contra la organización y carreras.
- Arquitecto: **sí**. El criterio 16 lo resuelve el desarrollador siguiendo esta spec y lo documenta en 04.
- Documentador: **sí**.
- Cambios de schema: `FeeRule.payer` pasa a `onDelete: Restrict` (regla 6).
- Commit y push: autorizados por el usuario al aprobarse (sin force).
