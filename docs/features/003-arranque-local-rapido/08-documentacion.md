# 08 - Documentación: 003-arranque-local-rapido

> Autor: documentador. Entrada: `00-estado.md`, `01-spec.md` (criterios 17 y 18), `03-diseno-tecnico.md`,
> `04-implementacion.md` (incl. secciones 10 y 11), `05-revision.md`, `06-seguridad.md`, `07-testing.md`,
> la ayuda de `dev.ps1` y `.env.example`. Solo se tocó documentación: ni código, ni `.env`, ni
> `.claude/settings*.json`. No se ejecutó `dev.ps1`. No se leyeron valores de `.env`.

## Qué cambió en el feature (resumen verificable)
- `dev.ps1` + `scripts/dev-lib.ps1` (+ tests): arranque con un comando; flags `-Docker`, `-Stop`, `-Seed`,
  `-Smoke`, `-Init`; códigos de salida 0 a 8.
- Única fuente de credenciales: `.env` raíz; `backend/.env` generado. Se eliminó `backend/docker-compose.yml`.
- `FRONTEND_PORT` (desarrollo, default 3000) y `BIND_ADDRESS` (Docker, default 127.0.0.1; Postgres siempre
  en 127.0.0.1). Sin IP de LAN en `docker-compose.yml`. SSR de `data.ts` con default `localhost`.

## Archivos tocados
| Archivo | Cambio |
|---|---|
| `.claude/CLAUDE.md` | Solo Estructura, Credenciales, Stack (línea Infra) y Comandos. Raíz con `dev.ps1`/`scripts/` y aclaración de que ya no existe `backend/docker-compose.yml`. Credenciales: `.env` raíz como única fuente, `backend/.env` generado (no editar; `.\dev.ps1 -Init` tras cambiar `.env`), tres plantillas. Comandos: bloque de arranque rápido con los 5 flags y `-Init`, ExecutionPolicy (`-ExecutionPolicy Bypass` / `Unblock-File`), `FRONTEND_PORT`, `BIND_ADDRESS`, tests de `dev.ps1`; "Primera vez" ya no copia `backend/.env.example`; `docker compose up -d db` desde la raíz; seeds por `.\dev.ps1 -Seed`; se mantiene la nota de Google Fonts y se agrega la del TLS en `apk add` del build Docker. Reglas del proyecto sin cambios |
| `docs/auditoria/COMANDOS.md` | Nueva sección 0 "Arranque rápido": requisitos, tabla de flags, ExecutionPolicy, tabla de códigos 0-8, qué archivo editar, `FRONTEND_PORT`, `BIND_ADDRESS` (con el aviso de exposición en la LAN con JWT sin verificar y CORS abierto), tabla de errores comunes (Docker apagado, puerto ocupado y `FRONTEND_PORT`, contenedor viejo de `backend/` en 5433, P1000, EPERM, `FRONTEND_PORT` inválido también aborta `-Docker`, TLS en build Docker, código 8, código 7), archivos locales que deja el script (`.bak` con credenciales viejas: borrarlo cuando todo funcione), volumen huérfano `backend_postgres_data` y cómo borrarlo solo por decisión del usuario. Secciones existentes: §1 (ya no se copia a mano con `dev.ps1`; referencia sin él), §2 (`docker compose up -d db` desde la raíz), seeds (`.\dev.ps1 -Seed` y `docker compose exec -T db` sin usuario ni contenedor fijos), §3 (sin `POSTGRES_*` en `backend/.env`), §4 (`INTERNAL_API_URL` con default `localhost`, `frontend/.env.local`, `FRONTEND_PORT`), §5 (sin IP fija, `BIND_ADDRESS`). Se eliminó la IP de LAN |
| `docs/auditoria/ARQUITECTURA.md` | §4 default SSR de `INTERNAL_API_URL`. §5: sin IP de LAN, desarrollo con `dev.ps1` y la base del compose raíz, `backend/.env` generado, plantillas, puertos en 127.0.0.1 y `BIND_ADDRESS`, seeds |
| `docs/auditoria/RIESGOS.md` | S17: se quitó la IP; nota de estado tras el 003 (puertos en 127.0.0.1, credenciales generadas, `BIND_ADDRESS=0.0.0.0` reabre la exposición) |
| `docs/auditoria/CLAUDE.borrador.md` | Aviso en el encabezado (ya marcado obsoleto): `backend/docker-compose.yml` ya no existe |
| `docs/features/003-arranque-local-rapido/06-seguridad.md` | Una mención de rango "192.168.x.x" reemplazada por "la IP de la red local" |
| `docs/features/003-arranque-local-rapido/08-documentacion.md` | Este informe |

README / CHANGELOG: no existen en la raíz (solo `backend/README*.md` y `frontend/README*.md`), así que no se agregó
entrada de changelog. El historial del feature queda en `docs/features/003-arranque-local-rapido/`.

## Verificación final
- `git grep -n "192\.168\."` (archivos versionados): **sin resultados**. En archivos no versionados de
  `docs/features/003-...` tampoco quedan coincidencias tras el cambio en `06-seguridad.md`.
- `git grep -n "backend/docker-compose"` fuera de `docs/features/`: solo 4 referencias, todas para decir que
  el archivo ya no existe (`.claude/CLAUDE.md:19`, `ARQUITECTURA.md`, `COMANDOS.md` x2 y `CLAUDE.borrador.md`).
  Dentro de `docs/features/` quedan referencias históricas de los features 001, 002 y 003 (specs, diseños,
  informes), que describen el estado de su momento y no se reescriben.
- Las afirmaciones se contrastaron con la ayuda de `dev.ps1`, `.env.example`, `04-implementacion.md` y
  `07-testing.md`. El mensaje de puerto 5433 ocupado por otro contenedor se verificó en `dev-lib.ps1`.

## Pendientes
1. `backend/README*.md` y `frontend/README*.md` (genéricos, el del backend dice "db push") no se tocaron: fuera
   del alcance del 003.
2. Criterio 11 (modo Docker) sin verificar en vivo por el fallo de TLS de `apk` en el entorno del tester
   (07-testing hallazgo 1): repetir `.\dev.ps1 -Docker` y `-Smoke` (frontend en 3001) en otra red. La doc de
   errores comunes ya lo describe.
3. Sigue documentado como pendiente fuera del 003: `LoggingInterceptor` loguea contraseña y token del login,
   CORS `origin: true` y JWT sin verificar.
4. Código de salida 3 para el fallo de `compose up --build` (07-testing hallazgo 3): documentado tal como es
   hoy; si se cambia el código, actualizar la tabla de `COMANDOS.md`.
5. Regla 12: `.claude/settings.json` figuraba modificado antes de esta etapa (permisos agregados por el
   harness). No se tocó; el PO debe revisarlo con `git diff .claude/settings.json` antes del commit.
6. Acciones del usuario: borrar `backend/.env.pre-003*.bak` cuando todo funcione; decidir sobre el volumen
   huérfano `backend_postgres_data`.

VEREDICTO: APROBADO
