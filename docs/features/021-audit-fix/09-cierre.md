# 09 — Cierre: 021-audit-fix

Fecha: 2026-11-18. Autor: PO. Este feature se adelantó para hacerlo inmediatamente después del 018.

## Resultado
Todas las etapas quedaron aprobadas, sin vueltas de corrección (0 de 3). Después de la revisión se aplicaron dos
menores del revisor, M1 y M2, que verificó el tester.

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI | — | Omitida: no hay interfaz |
| Arquitecto | 03-diseno-tecnico.md | APROBADO: `proxy-addr` se corrige sin Nest 11 |
| Desarrollador | 04-implementacion.md | Completo, más los ajustes M1 y M2 |
| Revisor | 05-revision.md | APROBADO (8 menores) |
| Seguridad | 06-seguridad.md | APROBADO (2 menores y 3 INFO) |
| Tester | 07-testing.md | APROBADO |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **Backend:**
  - se quitaron `axios` y `@nestjs/axios` (#61);
  - se corrió `npm audit fix --legacy-peer-deps`, sin `--force`;
  - `overrides` con piso: `express` ^4.22.3, `body-parser` ^1.20.9 (el alto explotable, DoS por gzip) y `multer` ^2.5.0;
  - `proxy-addr` 2.0.8, que era crítico;
  - pisos de rango: `@nestjs/config` ^4.0.4 y `@nestjs/swagger` ^11.4.8;
  - test `dependency-floors.spec.ts`, que falla si una versión queda por debajo de su piso o no se puede leer;
  - guarda del gzip.
- **Frontend:**
  - `next` y `eslint-config-next` quedaron en 16.4.6 exacto (#103);
  - `source-map-js` 1.2.2 (#36);
  - `experimental.agentUpgrade: false` en `next.config.ts`.
- **`npm audit`:**
  - backend en producción: de 1 crítico, 8 altos y 6 moderados a 0 críticos, 0 altos y 4 moderados, ninguno explotable
    en este uso;
  - frontend: de 15 a 0.
- **Tests:** backend con 58 suites y 1036 tests (antes 56 y 1020); frontend con 148, sin cambios.
- **Documentación:**
  - `CLAUDE.md` (Next 16.4.6, sección Dependencias y conteos);
  - COMANDOS;
  - BACKLOG: #36, #61, #103 y parte de #25 resueltos; nuevos #115 a #122;
  - RIESGOS;
  - PLAN.

## Verificación de los criterios (PO)
| Criterio | Estado |
|---|---|
| 1 | Cumple: Next 16.4.6. `next build` en frío y dos arranques en frío con `.\dev.ps1` y `-Smoke` dieron OK a la primera, sin `SecurityFatalError` |
| 2 | Cumple: `npm audit` del frontend en 0 |
| 3 | Cumple: producción sin críticos ni altos. Los 4 moderados que quedan no son explotables (no se usan SSE ni subida de archivos) y van al 022 |
| 4 | Cumple: no se cambió ninguna versión mayor |
| 5 | Cumple: `axios` ya no aparece en `npm ls` |
| 6 | Cumple: `npm ci` funciona desde cero en los dos proyectos y los lockfiles no cambian |
| 7 | Cumple: `tsc`, `nest build`, tests, Prisma, `-CheckMigrations`, `next build` y el smoke en verde. El lint del frontend no empeoró; el del backend sube 29 errores por la nueva versión de `typescript-eslint`, una deuda aceptada para el 025 (#116). **El build Docker no se pudo verificar** (#104) |
| 8 | Cumple: no hay scripts de instalación nuevos y todo viene del registro oficial. Los paquetes nuevos son legítimos |

## Pendiente
- **Build Docker** (#104, feature 020).
- **#115 a #122:**
  - retirar los `overrides` al pasar a Nest 11 (022);
  - lint (025);
  - `npm audit` en el CI (026);
  - imagen de runtime con dependencias de desarrollo (020);
  - telemetría de `@scarf/scarf`;
  - informativos.
- **Moderados de producción y cadena de `@nestjs/cli`:** se cierran con Nest 11 (#35, feature 022).

## Pasos omitidos
UX/UI, porque no hay interfaz.
