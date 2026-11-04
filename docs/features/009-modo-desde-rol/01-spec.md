# 009 — Modo org/pro decidido en el servidor según el rol, y acceso por rol a los datos financieros

## Contexto
- **BACKLOG #2 (resto).** Desde el 007, `x-mode` no da permisos de escritura. Pero sigue decidiendo **qué datos se
  leen y cómo se calculan los montos**. El cliente lo manda en el header o en `?mode=`, y lo usan:
  - `find-all-activities-query.ts`: filtra por profesional y elige si `netAmount` es el neto del profesional o el
    de la organización;
  - `dashboard.service.ts`: KPIs, chart y payers;
  - `patients.service.ts`;
  - `activity.service.ts`: carga en modo pro, `SOLO_PRACTICE` y atenciones privadas.

  Un `Professional` o un `MEMBER` puede pedir `mode=org` y ver los listados y los totales financieros de toda la
  organización. También al revés: pedir `mode=pro` sin tener un `Professional`.
- **BACKLOG #41.**
  - `GET settlements/calculate` lee `organizationId` del `@Query()` sin pasar por `@CurrentOrgId()` (MENOR-1 de
    seguridad del 007), y el invariante estático no lo detecta.
  - `settlements/calculate` y el dashboard en modo org están abiertos a cualquier vínculo con la organización
    (INFO de seguridad del 007). La UI solo oculta el menú.

## Historia de usuario
Como responsable de la plataforma, quiero que el servidor decida qué vista corresponde a cada usuario según sus
vínculos reales con la organización. Así, nadie ve datos financieros de la organización ni listados ajenos solo
por cambiar un header.

## Política propuesta (PO; el arquitecto la contrasta con el uso real)
- **Modo efectivo:** lo resuelve el servidor a partir del modo pedido y de los vínculos de la base.
  - Se pide `org`: se concede si el usuario tiene `OrganizationMember` (`ADMIN` o `MEMBER`) en la organización
    validada.
  - Se pide `pro`: se concede si el usuario tiene un `Professional` activo en la organización. En la vista pro
    multi-organización, en alguna de las organizaciones de su contexto.
  - **Si el modo pedido no corresponde:** la respuesta es 403 genérico. No hay degradación silenciosa al otro
    modo, salvo que el arquitecto justifique que la UI la necesita.
  - **Si no se pide modo:** el servidor elige uno determinístico. Por ejemplo, `org` si es miembro y si no `pro`.
    El arquitecto lo define.
- **Datos financieros agregados de la organización:**
  - dashboard en modo org (KPIs, chart, payers) y `settlements/calculate`;
  - solo `ADMIN`, con el rol tomado de la base;
  - el `MEMBER` (recepción) conserva lo que hoy usa para operar: listado de atenciones de la organización,
    pacientes y carga;
  - el arquitecto releva qué pantallas usa el `MEMBER` hoy. Si alguna muestra montos de la organización, lo
    informa como aclaración para el PO.
- **Modo pro:** el profesional ve solo sus atenciones y sus montos, como hoy, con el `professionalId` tomado de la
  base y no del cliente.

## Criterios de aceptación
1. **Relevamiento:** el diseño lista todos los lugares que leen `mode` o `x-mode` (backend y frontend), qué deciden
   y cómo quedan.
2. **Modo resuelto en el servidor:** existe una única función o servicio que calcula el modo efectivo y lo expone
   en el `RequestContext` (o equivalente). Ningún handler ni servicio vuelve a leer `x-mode` ni `?mode=`
   directamente. Un invariante estático lo vigila, como en el 007.
3. **`mode=org` sin membresía:** un `Professional` sin `OrganizationMember` que pide `org` recibe 403 en todas las
   rutas que dependen del modo y no ve datos de la organización.
4. **`mode=pro` sin `Professional`:** un miembro sin `Professional` que pide `pro` recibe 403, o lo que defina el
   diseño, sin datos de otros.
5. **Financieros de la organización solo para `ADMIN`:** dashboard en modo org (KPIs, chart y payers) y
   `settlements/calculate` responden 403 a un `MEMBER` y a un profesional. El `ADMIN` los usa como hoy.
6. **`settlements/calculate`:**
   - usa `@CurrentOrgId()`;
   - el campo queda bien clasificado en `ID_FIELDS`;
   - el invariante de organización lo cubre.
7. **Montos coherentes:** con el mismo usuario y los mismos datos, los montos de la vista que le corresponde no
   cambian respecto de hoy (`netAmount` del profesional en pro y de la organización en org). Hay tests con
   valores conocidos.
8. **Frontend:**
   - se adapta a la política. Si ya no tiene sentido, deja de mandar `x-mode`, o lo sigue mandando como
     preferencia, según el diseño;
   - oculta lo que el rol no puede ver (por ejemplo, el dashboard financiero para un `MEMBER`), con el mensaje
     existente si el backend responde 403;
   - los flujos legítimos siguen funcionando: ADMIN en org, MEMBER operando y profesional en pro.
9. **Tests (Jest y `node --test`):**
   - modo efectivo para cada combinación de vínculos (miembro ADMIN, miembro MEMBER, solo Professional, ambos,
     ninguno) por modo pedido (org, pro, ninguno);
   - 403 de financieros por rol;
   - invariante estático;
   - integración en `test/org-isolation.spec.ts`, o una suite nueva, con el `AppModule` real.
10. **Calidad:**
    - `npx tsc --noEmit` sin errores en backend y frontend;
    - ESLint sin errores nuevos en los archivos tocados;
    - `npm test` del backend y del frontend en verde;
    - `npm run build` del frontend OK.
11. **Verificación en vivo (tester), sin escribir datos:**
    - con tokens firmados en memoria: ADMIN y MEMBER en `mode=org`, y un usuario con `mode=pro` (si existe un
      usuario con `Professional`);
    - 403 y 200 según la política;
    - montos del ADMIN iguales antes y después en dashboard y KPIs;
    - `-Smoke` OK;
    - conteos sin cambios (9 / 3 / 72 / 324 / 1483).
12. **Sin schema nuevo**, salvo justificación con migración.

## Fuera de alcance
- Cambiar el cálculo de los montos (eso es el 016).
- Pantallas nuevas o rediseño del menú, más allá de ocultar lo que el rol no puede ver.
- Rate limiting, cookie `HttpOnly` y filtros de error (013).

## Riesgos
- **Romper la vista de recepción** si alguna pantalla del `MEMBER` usa los KPIs o los montos de la organización.
- **Profesionales que también son miembros:** el modo efectivo tiene que permitir las dos vistas.
- **Vista pro multi-organización:** hoy el profesional puede ver sus atenciones de varias organizaciones. El diseño
  tiene que mantenerlo sin reabrir el aislamiento del 007.
- **Testing en vivo:** la base no tiene profesionales sin membresía (007). Los casos se cubren con Jest.

## Pasos del flujo
- Requiere UX/UI: **no**, salvo que el arquitecto proponga un cambio visible más allá de ocultar menús. En ese caso
  se reevalúa.
- Requiere seguridad: **sí**.
- Arquitecto: **sí**.
- Documentador: **sí**.
- Cambios de schema: no previstos.
- Commit y push: autorizados por el usuario al aprobarse (sin force).

## Salvaguardas vigentes
- Sin seeds ni SQL de escritura; sin `down -v`, `prune` ni borrar volúmenes; sin stash, reset ni checkout.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
- No imprimir valores del `.env` ni datos personales. Regla 12 con `.claude/settings.json`.
