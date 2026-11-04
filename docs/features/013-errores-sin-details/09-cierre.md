# 09 — Cierre: 013-errores-sin-details

Fecha: 2026-11-04. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, con **1 vuelta de corrección de 3**. Esa vuelta la decidió el PO para M-2/B-1, M-8 y
M-1. La revisión inicial se cortó por el límite de uso y se rehízo.

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI | — | Omitida |
| Arquitecto | 03-diseno-tecnico.md | APROBADO; las 9 aclaraciones las aceptó el PO (00-estado) |
| Desarrollador | 04-implementacion.md | Completo, con la vuelta 1 |
| Revisor | 05-revision.md | APROBADO; vuelta 1 APROBADO |
| Seguridad | 06-seguridad.md | APROBADO (B-1 se corrigió en la vuelta 1) |
| Tester | 07-testing.md | APROBADO |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **Contrato de error único** (`filters/error-contract.ts`), usado por los filtros, el body parser y un manejador final
  de Express nuevo:
  - el formato es `{ code, errors: [{ message }] }`, sin `details` ni stack en ningún entorno;
  - los 401, 403 y 404 son siempre genéricos, y el 404 sigue siendo idéntico;
  - un error de validación responde 400 `validation-failed` con hasta 20 mensajes;
  - los 5xx son genéricos y llevan `X-Error-Id`.
- **Log de errores:** de Prisma se registran solo la clase y el código. Se quitó el `catch` que guardaba datos de la
  organización y el log duplicado del dispatcher.
- **Errores de negocio con el código correcto:**
  - 409 por CUIT duplicado;
  - 400 `first-load-required`;
  - 400 si falta el profesional;
  - 409 al borrar una prestación con registros;
  - 500 genérico en `fee-resolution`;
  - los textos quedan en español.
- **Código muerto eliminado:** `axios-filter.ts`.
- **Invariantes nuevos:**
  - lista blanca de `new Error(`;
  - ninguna excepción con un string suelto;
  - nada que serialice la excepción;
  - no queda `axios-filter`.
- **Frontend:**
  - `src/lib/api-errors.ts` y `API_ERROR_MESSAGES`;
  - las 35 ramas de error de `data.ts` y los 9 componentes migrados;
  - desaparecen los toasts con "Failed to ...: {json}";
  - un solo toast cuando falla guardar una atención;
  - se quitó la heurística de "Foreign key".
- **Tests:** backend con 39 suites y 682 tests; frontend con 53.
- **Documentación:**
  - `CLAUDE.md`;
  - BACKLOG: #13, #42 y #53 resueltos, nuevos #59 a #66, y la nota de I-4 corregida;
  - COMANDOS (`X-Error-Id`);
  - RIESGOS (local).

## Verificación de los criterios (PO)
| Criterios | Estado |
|---|---|
| 1 a 3 | Cumplen en vivo: todas las respuestas tienen solo `code` y `errors`; el 500 real tiene `X-Error-Id` y el log no muestra valores |
| 4 | Cumple en Jest; los 409 y el 400 de negocio requieren escribir datos y no se probaron en vivo |
| 5, 6, 7 | Cumplen; la falla de base en el guard y el manejador final están cubiertos en Jest |
| 8 | Cumple en código y tests. **Falta la prueba en navegador** (07-testing, §5) |
| 9, 10 | Cumplen |
| 11 | Cumple: `-Smoke` OK y los conteos sin cambios (9 / 3 / 72 / 324 / 1483) |

## Pendiente
- **Prueba en navegador:** que los toasts salgan en español y sin JSON, el 409 al borrar una prestación con registros y
  un solo toast al fallar el guardado.
- **Comentario desactualizado** en el catch de `WorkItemForm.tsx` (~453), que dice que `AtencionesTable` ya muestra el
  error. Lo borra el desarrollador del 014.
- **BACKLOG #59 a #66:**
  - #59: errores de Prisma por unicidad como 409;
  - #60: 403 de una atención ya cobrada como 409;
  - #61: quitar `axios` (va al 020);
  - #62: enumeración por CUIT de organización;
  - #63: log de `error.message` en producción;
  - #64: test del orden del bootstrap;
  - #65: acoplamiento entre capas;
  - #66: mensajes de validación en inglés.
- **Menores del revisor** sin cambios: M-4 a M-7.

## Pasos omitidos
UX/UI.
