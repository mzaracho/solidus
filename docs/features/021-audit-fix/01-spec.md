# 021 — Dependencias: vulnerabilidades sin cambios incompatibles, Next 16.4.6 y limpieza

Ítems del BACKLOG: #36, #25 (solo la parte de `npm audit fix` sin cambios incompatibles), #61 y #103.

## Contexto
- **#103:**
  - el frontend usa `next` 16.4.3, con dos avisos moderados (GHSA-mfr8-8qww-v76h y GHSA-vc7v-qv4w-wrv8) que hoy no
    son explotables;
  - Next 16.4.3 trae un aviso de actualización (`SecurityFatalError`, `node_modules/next/dist/lib/upgrade/nudge.js`)
    que **corta el primer `next build` o `next dev`**: `.\dev.ps1` puede no levantar el frontend la primera vez;
  - la corrección está en 16.4.6, sin cambio de versión mayor.
- **#36:** `source-map-js` tiene un aviso alto en el frontend (dependencia transitiva, de herramientas de build).
- **`npm audit` del backend** (seguridad del 018) marca:
  - `proxy-addr` como **crítico**;
  - además `body-parser`, `multer`, `path-to-regexp`, `express`, `qs` y `@nestjs/*`.
  - Algunos de esos arreglos pueden requerir Nest 11, que es un cambio incompatible y va al feature 022.
- **#61:** `axios` y `@nestjs/axios` figuran en `package.json` del backend sin uso.

## Historia de usuario
Como responsable de la plataforma, quiero que las dependencias no tengan vulnerabilidades corregibles sin romper nada,
y que el frontend arranque siempre a la primera.

## Criterios de aceptación
1. **Next 16.4.6 o superior**, dentro de 16.x y sin cambio de versión mayor. Con `eslint-config-next` y paquetes
   relacionados alineados:
   - el primer `next build` y el primer `.\dev.ps1` levantan el frontend sin `SecurityFatalError`;
   - lo verifica el tester con un arranque en frío, con `-Stop` antes.
2. **Frontend:**
   - se aplica `npm audit fix` **sin `--force`**;
   - `npm audit --omit=dev` termina sin hallazgos altos ni críticos;
   - los moderados que queden se listan con su motivo.
3. **Backend:**
   - se corrigen las vulnerabilidades que se puedan arreglar sin cambiar de versión mayor: con `npm audit fix` sin
     `--force` o, si hace falta, con `overrides` de dependencias transitivas a versiones parche o menores compatibles,
     justificadas una por una;
   - **`proxy-addr` crítico:** resuelto. Si es imposible sin Nest 11, se informa al PO **antes** de cerrar el diseño,
     con el riesgo real (si es explotable en este uso: `trust proxy`, etc.);
   - lo que quede se lista con severidad, si es explotable y el feature al que va (022).
4. **Sin cambios de versión mayor** de Nest, Prisma, React, Next ni TypeScript. Eso es el feature 022.
5. **#61:** se quitan `axios` y `@nestjs/axios` si no hay imports, verificado con búsqueda y build.
6. **Lockfiles:**
   - `package-lock.json` de los dos proyectos regenerados de forma coherente;
   - `npm ci` funciona desde cero en ambos;
   - no se agregan dependencias nuevas, salvo las que traiga una actualización y estén justificadas.
7. **Calidad:**
   - backend:
     - `npx tsc --noEmit`, `npx nest build` y `npm test` en verde;
     - `npx prisma validate` y `npx prisma generate`;
     - `.\dev.ps1 -CheckMigrations` en 0;
   - frontend: `npx tsc --noEmit`, `npm test`, `npm run build` y lint sin errores nuevos;
   - `.\dev.ps1` + `-Smoke` OK, con login por cookie, **a la primera**;
   - build Docker: se intenta, y si buildx sigue bloqueando (#104) se informa como no verificable.
8. **Seguridad:**
   - se revisan los cambios de dependencias: scripts de instalación nuevos, paquetes nuevos y orígenes (registro
     oficial);
   - ninguna versión se fija en un rango que reabra los avisos.

## Fuera de alcance
- Nest 10 → 11/12 y Prisma 5 → 6/7 (feature 022).
- Actualizar Node.
- Cambios funcionales.

## Riesgos
- **Una dependencia transitiva actualizada rompe algo en tiempo de ejecución:** se mitiga con tests, build y smoke.
- **`overrides` que fuerzan versiones incompatibles con Nest 10:** cada uno se justifica y se prueba.
- **Red o TLS del antivirus al instalar:** se usa la CA del sistema y nunca se desactiva TLS.

## Pasos del flujo
- Requiere UX/UI: **no**.
- Requiere seguridad: **sí** (dependencias).
- Arquitecto: **sí**, como relevamiento: qué se corrige, cómo, y qué queda para el 022.
- Documentador: **sí**: BACKLOG, COMANDOS si cambia algo del arranque, y `CLAUDE.md` si cambian versiones.
- Cambios de schema: no.
- Commit y push: autorizados por el usuario al aprobarse, sin force.
