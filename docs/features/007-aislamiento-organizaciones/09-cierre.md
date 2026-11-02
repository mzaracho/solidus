# 09 — Cierre: 007-aislamiento-organizaciones

Fecha: 2026-11-02. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, con **2 vueltas de corrección de 3**.

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI | — | Omitida: no hay pantallas nuevas |
| Arquitecto | 03-diseno-tecnico.md | APROBADO (11 aclaraciones: 3 las decidió el usuario y 8 el PO) |
| Desarrollador | 04-implementacion.md | Completo, con las vueltas 1 y 2 |
| Revisor | 05-revision.md | Vuelta 0: RECHAZADO (F-1, el front mostraba éxito ante 403/404). Vueltas 1 y 2: APROBADO |
| Seguridad | 06-seguridad.md | Vuelta 1: RECHAZADO (ALTA-1, organización undefined sin `x-org-id`; MEDIA-1, `splits` sin validar). Vuelta 2: APROBADO |
| Tester | 07-testing.md | APROBADO (206 comprobaciones en vivo, 0 fallos) |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **Contexto de request:**
  - el `Dispatcher` pasa a los handlers un `RequestContext` inmutable, armado por los guards;
  - `@CurrentOrgId()` y `@CurrentUserId()` en los controladores;
  - ningún controlador ni handler lee la organización de headers, query o body (invariante estático).
- **Pertenencia por recurso:**
  - helper `org-resource.ts`;
  - las 18 rutas por `:id` verifican la pertenencia antes de leer o escribir y responden un 404 idéntico para
    inexistente, ajeno, id no UUID y default del sistema;
  - un test estructural falla si aparece una ruta nueva sin su caso;
  - los ids referenciados se verifican al crear y editar, y un campo `*Id` nuevo sin clasificar hace fallar un test.
- **Política de roles** (decisiones del usuario 1b, 2a y 3a):
  - escrituras de `org/*` solo para `ADMIN`;
  - atenciones:
    - el `ADMIN` puede todo;
    - el `MEMBER` edita y cobra cualquiera de su organización y borra solo las propias;
    - un profesional sin membresía solo toca lo suyo;
  - `canLoadActivities` exigido;
  - las reglas las escriben el `ADMIN` o el dueño del pagador;
  - nada depende de `x-mode`.
- **`POST /activity`:** verifica todo antes de escribir y hace una sola `$transaction`.
- **Otros cambios del backend:**
  - merge de pacientes de la misma organización, en una transacción, con 400 si el body es inválido;
  - `PUT v1/patients/:id` funciona (antes daba 500);
  - `fee-rules` arma los datos con lista blanca y valida `splits` en el servidor;
  - la baja de staff no afecta a otras organizaciones.
- **Rutas eliminadas:** `ConfigController` (el front migró a `org/*`), `system/professionals`,
  `pro/payers/lookup` y las rutas muertas de settlements y professional-categories.
- **Lookup de staff por CUIT:** `ADMIN`, acotado a la organización y con respuesta mínima.
- **Frontend:**
  - las escrituras ya no muestran éxito ante un 403 o 404;
  - "Eliminar" está deshabilitado para el `MEMBER` en Admisiones y Atenciones según la política.
- **Tests:**
  - backend: 24 suites y 374 tests (antes 13 suites y 148 tests), incluida la integración
    `test/org-isolation.spec.ts`;
  - frontend: 11 tests.
- **Documentación:**
  - `CLAUDE.md`: regla 4, patrón para endpoints nuevos y política de atenciones;
  - BACKLOG: #3, #4 y #5 resueltos; nuevos #40 a #44;
  - RIESGOS (local) y ARQUITECTURA actualizados.

## Verificación de los criterios (PO, contra los informes)
| Criterio | Estado |
|---|---|
| 1 | Cumple. El relevamiento del diseño (§2), contrastado por seguridad con su propio grep, coincide con el test estructural |
| 2, 3, 4 | Cumplen: en vivo (lecturas cruzadas reales, escrituras con UUID inexistentes) y en Jest (escrituras cruzadas reales) |
| 5, 6 | Cumplen: en vivo con `MEMBER` real y en Jest |
| 7, 8 | Cumplen en Jest. En vivo solo la parte de `x-mode`, porque la base no tiene profesionales sin membresía |
| 9 | Cumple en vivo |
| 10 | Cumple en código y por HTTP. **Falta la prueba en navegador del usuario** (07-testing, §8) |
| 11, 12 | Cumplen |
| 13 | Cumple: `-Smoke` OK y los conteos no cambiaron (9 / 3 / 72 / 324 / 1483) |
| 14 | Cumple: sin schema nuevo |

## Pendiente
- **Prueba en navegador** del usuario: 07-testing, §8.
- **Efecto de la decisión 1b sobre los datos actuales:** las 324 atenciones tienen `createdByUserId` null, así que un
  `MEMBER` no puede borrar ninguna (sí editarlas y cobrarlas). Solo las borran el `ADMIN` o el dueño del
  `Professional`. Si el usuario quiere que el `MEMBER` borre las que no tienen autor, es un ajuste chico.
- **Residuales anotados en el BACKLOG:**
  - #40: motor de honorarios, forma de `splits` y `FIXED` acotado al bruto (MEDIA-2);
  - #41: `settlements/calculate` y accesos por rol;
  - #42: mensajes 404 en español;
  - #43: DTOs de update;
  - #44: Eliminar en `workload/columns.tsx`.
- **Menores del revisor:** directivas `eslint-disable` sobrantes en tests nuevos, etiqueta de
  `CalculateSettlementsQuery` en `ID_FIELDS` y dos `no-unsafe-assignment` en `fee-rule-commands.ts`.
- **`/test-suite`:** recibe errores en algunos pasos y 400 al crear reglas. Se elimina del build en el 018.
- **Observaciones del tester:**
  - O-1: algunos `PUT` con body incompleto dan 400 antes que 404;
  - O-3: `settlements/calculate` sin parámetros da 400.

## Pasos omitidos
UX/UI, porque no hay pantallas nuevas.
