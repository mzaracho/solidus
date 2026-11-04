# 09 — Cierre: 009-modo-desde-rol

Fecha: 2026-11-04. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, con **1 vuelta de corrección de 3**. Esa vuelta la decidió el PO por MEDIA-1 de
seguridad, aunque el veredicto inicial era APROBADO.

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI | — | Omitida: solo se ocultan menús por rol |
| Arquitecto | 03-diseno-tecnico.md | APROBADO (11 aclaraciones, decididas por el PO en 00-estado) |
| Desarrollador | 04-implementacion.md | Completo. La primera sesión se cortó por límite de uso y se retomó; luego vino la vuelta 1 |
| Revisor | 05-revision.md | APROBADO; vuelta 1 APROBADO |
| Seguridad | 06-seguridad.md | APROBADO con MEDIA-1, corregido en la vuelta 1; re-revisión APROBADO |
| Tester | 07-testing.md | APROBADO (540 comprobaciones de la matriz en vivo, 0 fallos) |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **`ViewModeGuard`, tercer guard global:**
  - es el único que lee `x-mode` y `?mode=`, vigilado por un invariante;
  - resuelve el modo efectivo con los vínculos de la base y lo deja en `RequestContext.view`;
  - las rutas que dependen del modo llevan `@UsesViewMode()`; sin el decorador, la respuesta es 403;
  - un modo que no corresponde da 403 sin degradar, y un valor inválido o repetido da 400 `invalid-mode`.
- **Financieros solo para `ADMIN`:** dashboard en modo org (KPIs, chart y payers) y `settlements/calculate`, este
  último con `@CurrentOrgId()` (#41).
- **Vista pro multi-organización:** solo lee filas de los `Professional` propios, con ids tomados de la base.
- **Profesional sin membresía:**
  - lecturas por id (`activity/:id`, resumen y deuda del paciente) limitadas a lo propio, con el 404 genérico;
  - resumen, deuda, "última visita" y listado de pacientes en modo pro sin datos de otros profesionales (MEDIA-1).
- **`SOLO_PRACTICE`:** la excepción vale solo para el `ADMIN` (BAJA-3).
- **Frontend:**
  - `view-mode.ts` (`allowedViewModes`, `pickViewMode` y `canSeeRestrictedLinks`);
  - el Sidebar solo ofrece las vistas permitidas;
  - los enlaces financieros quedan ocultos si el rol no es `ADMIN`;
  - el modo ya no viaja en el body ni en las queries que el backend ignora.
- **Montos sin cambios:** tests con valores conocidos, más la verificación en vivo contra consultas `SELECT`
  independientes: 324 atenciones y 10.750.900 de bruto.
- **Tests:** backend con 30 suites y 525 tests (antes 24 y 374); frontend con 35 (antes 24).
- **Documentación:**
  - `CLAUDE.md`: regla 4 y convenciones;
  - BACKLOG: #2 y #41 resueltos, nuevos #47 a #54;
  - RIESGOS (local) y ARQUITECTURA (cadena de tres guards).

## Verificación de los criterios (PO)
| Criterios | Estado |
|---|---|
| 1 a 6 | Cumplen; en vivo, la matriz con 5 perfiles reales |
| 7 | Cumple: los montos del `ADMIN` y de la vista pro coinciden con `SELECT` independientes. No hubo captura previa al cambio; se usó el plan alternativo del diseño |
| 8 | Cumple en código y por HTTP. **Falta la prueba en navegador del usuario** (07-testing) |
| 9, 10 | Cumplen |
| 11 | Cumple: `-Smoke` OK y los conteos no cambiaron (9 / 3 / 72 / 324 / 1483) |
| 12 | Cumple: sin schema nuevo |

## Pendiente
- **Prueba en navegador:** lista de 8 puntos en 07-testing.
- **Casos que la base no tiene,** cubiertos solo por Jest: profesional sin membresía, `ADMIN` de `SOLO_PRACTICE` sin
  `Professional` y atenciones ajenas reales.
- **BACKLOG #47 a #54:**
  - #47: menús según la primera membresía;
  - #48: `fee-rules` filtra por categoría;
  - #49: `org/config` abierto;
  - #50: orden de deudores (MENOR-7);
  - #51: `MEMBER` ve comisión por atención;
  - #52: `POST /activity` con organización en el body;
  - #53: `new Error` que responde 500;
  - #54: mover `ownProfessionalsFilter` a `domain/`.
- **Formato:** el feature suma errores de Prettier en líneas tocadas, sin efecto en la lógica. Se resuelve en el 025
  (lint en verde).
- **`scripts/dev-lib.tests.ps1`:** apareció borrado otra vez (como en el 005). Se restauró desde `HEAD`, sin
  diferencias de contenido. No se encontró la causa en el repo; la hipótesis es una cuarentena del antivirus. El
  usuario puede verificarlo.

## Pasos omitidos
UX/UI, porque solo se ocultan menús.
