# 09 — Cierre: 010-logs-y-limites

Fecha: 2026-11-04. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, con **1 vuelta de corrección de 3**. Esa vuelta la decidió el PO para B-1 y B-2 de
seguridad, que eran chicos y de este alcance.

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI, arquitecto | — | Omitidos: tres cambios chicos y localizados |
| Desarrollador | 04-implementacion.md | Completo, con la vuelta 1 |
| Revisor | 05-revision.md | APROBADO; vuelta 1 APROBADO |
| Seguridad | 06-seguridad.md | APROBADO (B-1 y B-2 corregidos); vuelta 1 APROBADO |
| Tester | 07-testing.md | APROBADO |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **Línea de acceso (`config/app/access-log.ts`):**
  - un middleware de Express registrado antes del body parser, que escribe una línea por request:
    `METHOD ruta STATUS Nms`;
  - nivel `warn` para 4xx y 5xx;
  - no incluye query, headers, body, tokens ni ids;
  - neutraliza los caracteres no imprimibles en la ruta y en el método;
  - registra también los 401 y 403 de los guards, el 404 y los 400, 413, 415 y 500;
  - `LoggingInterceptor` conserva solo el debug redactado.
- **`BODY_SIZE_LIMIT`:**
  - default `1mb` (antes 50 MB) y máximo `10mb`;
  - un valor inválido impide arrancar;
  - se aplica a `json` y a `urlencoded`;
  - los errores 400, 413 y 415 del parser responden con el `ErrorResponse` genérico.
- **`NODE_TLS_REJECT_UNAUTHORIZED=0` prohibido:**
  - el backend no arranca y el mensaje remite a `-ExportCa`;
  - `dev.ps1 -Init` quita la clave de `backend/.env` y avisa una vez.

  Ya se aplicó en el equipo del usuario.
- **Tests:** backend con 32 suites y 567 tests; `dev-lib` con 1026.
- **Documentación:**
  - COMANDOS: límite del body, TLS, log de acceso y error común;
  - `CLAUDE.md`;
  - BACKLOG: #14, #37 y #38 resueltos;
  - RIESGOS (local).

## Verificación de los criterios (PO)
| Criterios | Estado |
|---|---|
| 1, 2 | Cumplen: en vivo, una línea por cada uno de los 7 casos, sin datos sensibles |
| 3 | Cumple: en vivo, 2 MB dan 413 genérico. Un `BODY_SIZE_LIMIT` inválido se probó solo en Jest |
| 4 | Cumple: `-Init` quitó la clave con aviso, y el arranque con `0` falla (proceso auxiliar) |
| 5 | Cumple: `.env.example` y COMANDOS |
| 6, 7 | Cumplen |
| 8 | Cumple: `-Smoke` OK y los conteos sin cambios (9 / 3 / 72 / 324 / 1483) |

## Pendiente
- **I-4:** falta un manejador final genérico para errores del parser con otros status. Va al 013.
- **I-2:** el log de acceso registra los UUID de recursos; conviene contemplarlo en una política de retención.
- **`BODY_SIZE_LIMIT` en el compose:** el modo Docker queda en 1mb; se puede hacer configurable si hiciera falta.
- **m-2:** el límite de `urlencoded` pasó de 100kb a 1mb. Lo acepta el PO, porque el front no usa ese formato.
- **Detalle en los errores:** los 401, 403 y 404 de los filtros siguen trayendo `details`. Va al 013.

## Pasos omitidos
UX/UI y arquitecto, por lo que indica la spec.
