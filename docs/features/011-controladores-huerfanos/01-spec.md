# 011 — Eliminar los controladores huérfanos `ProductionController` y `ReportingController`

## Contexto
BACKLOG #39 (B-1 del 005, INFO-3 del 007 y fuera de alcance en el 009):
- `backend/src/api/controllers/v1/activity/production-controller.ts` (`GET my-production`) y
  `reporting-controller.ts` (`GET work-items/reporting/{daily,debtors,monthly}`) **no están registrados en ningún
  módulo**, así que hoy responden 404.
- Sus queries (`GetMyProductionQuery` y `GetDaily/Debtors/MonthlyReportQuery`) toman `userId` y otros filtros
  directamente de la query string. Si alguien registrara esos controladores, cualquier usuario autenticado podría leer
  la producción y los honorarios de otros, y se saltearía el aislamiento del 007 y el modo del 009.
- El frontend no los usa: no hay llamadas a `my-production` ni a `work-items/reporting`.
- `security-invariants.spec.ts` los tiene marcados como "no registrado (011)".

## Decisión del PO
**Se eliminan**: los controladores y sus queries y handlers, si no tienen otro uso. No se migran, porque no hay
consumidores. Si en el futuro hacen falta reportes, se diseñan como un feature nuevo con el patrón del 007 y el 009.

## Historia de usuario
Como responsable de la plataforma, quiero que no quede código de endpoints que eluda los controles de identidad y
organización, para que nadie pueda reactivarlo por error.

## Criterios de aceptación
1. **Archivos eliminados:**
   - se borran `production-controller.ts` y `reporting-controller.ts`;
   - se borran `get-my-production-query.ts` y `reporting-queries.ts`, junto con sus handlers, DTOs y specs, si
     ningún otro código los usa; el desarrollador lo verifica con grep e informa lo que conserva y por qué;
   - se quitan sus entradas de `security-invariants.spec.ts` (clasificación de campos `*Id` y lista de "no
     registrados").
2. **Guardia estructural:** un test (en `security-invariants.spec.ts` o en `test/`) falla si existe una clase
   `@Controller` en `src/api/controllers/**` que no esté registrada en ningún módulo cargado por `AppModule`. Así no
   pueden volver a aparecer controladores huérfanos. Si alguno se mantiene huérfano a propósito, va en una lista
   blanca con justificación; hoy no debería haber ninguno.
3. **Sin cambios de comportamiento:** las rutas eliminadas ya respondían 404 y siguen igual. El resto de las rutas no
   cambia; lo cubre el test estructural de `test/org-isolation.spec.ts`.
4. **Calidad:**
   - `npx tsc --noEmit` del backend sin errores;
   - ESLint sin errores nuevos en los archivos tocados;
   - `npm test` del backend en verde.
5. **Verificación (tester):**
   - `GET /api/my-production` y `GET /api/work-items/reporting/daily` dan 404 con un token válido;
   - `-Smoke` OK;
   - los conteos de la base sin cambios.

## Fuera de alcance
- Diseñar reportes nuevos.
- Cambios en el frontend.

## Riesgos
- **Que algún handler borrado esté registrado en un módulo:** tsc o el arranque lo detectan. El desarrollador lo
  quita del módulo.

## Pasos del flujo
- Requiere UX/UI: **no**.
- Requiere seguridad: **sí, acotado**: confirmar que no queda ninguna vía y que la guardia estructural es efectiva.
- Arquitecto: **omitido**. Es un borrado de código muerto, con el enfoque fijado en la spec.
- Documentador: **sí, acotado**: BACKLOG #39 y ARQUITECTURA.md, que todavía menciona esos controladores.
- Cambios de schema: no.
- Commit y push: autorizados por el usuario al aprobarse (sin force).

## Salvaguardas vigentes
- Sin seeds ni SQL de escritura; sin `down -v`, `prune` ni borrar volúmenes; sin stash, reset ni checkout.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
- No imprimir valores del `.env`.
