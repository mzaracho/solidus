# 09 - Cierre: 004-cierre-pendientes-003

Fecha: 2026-10-28. Escribió: el PO.

## Qué se entregó
- **Docker con antivirus que intercepta TLS (AVG):**
  - CA extra opcional en los builds del backend y del frontend, con un BuildKit secret y
    `with-extra-ca.sh`. La CA no queda en ninguna capa;
  - `.\dev.ps1 -ExportCa` exporta solo la parte pública, con confirmación;
  - `docker-compose.extra-ca.yml` se aplica solo si existe `.dev/certs/extra-ca.pem`;
  - el modo Docker quedó verificado en vivo en esta máquina, que era el pendiente del criterio 11 del 003.
- **Engines de Prisma en la imagen:** el builder del backend instala `openssl` y baja los engines
  `linux-musl-openssl-3.0.x` durante el build, así que el arranque del contenedor no descarga nada
  (H-2 del tester).
- **Ajustes de `dev.ps1`:**
  - código 9 para un fallo de `compose up --build`, con la pista de `-ExportCa` ante errores TLS;
  - código 10 para una rotación incompleta;
  - sin `RemoteException` en PowerShell 5.1;
  - URL con el puerto lanzado y aviso si cambió;
  - validación `[0-9]`;
  - loopback por defecto en el modo desarrollo (`LISTEN_HOST` en el backend);
  - daemon por TCP en loopback;
  - `-Stop` verifica la línea de comandos (S-5) y avisa si el registro está dañado;
  - ACL restringidas en los archivos con secretos (S-1);
  - `postgres:16.11-alpine` (S-6).
- **Biblioteca:** dividida en 8 módulos `scripts/dev-lib.*.ps1`, con 980 tests de PowerShell.
- **Usuario de humo:** `-CreateSmokeUser` crea uno con credenciales aleatorias, sin organización ni
  membresía. `-Smoke` da Login OK en los dos modos.
- **Rotaciones:**
  - `-RotateDbPassword` y `-RotateJwtSecret`, ya ejecutadas;
  - la contraseña de Postgres tiene 48 hex y el `JWT_SECRET` 64 hex;
  - los valores expuestos anteriores ya no sirven.
- **Hook `pre-commit` versionado:** `.githooks/`, más `scripts/pre-commit.ps1` y `secret-scan.ps1`.
  Lo activa `-Init`.
- **Housekeeping:**
  - se borraron `backend/.env.pre-003.bak` y los volúmenes huérfanos `backend_postgres_data` y
    `healthops-gem_healthops_postgres_data`;
  - `frontend/package-lock.json` entra en este commit.
- **Documentación:**
  - `.claude/CLAUDE.md`, `docs/auditoria/COMANDOS.md` y `docs/auditoria/ARQUITECTURA.md`;
  - `docs/auditoria/RIESGOS.md`, solo en local.

## Verificación de criterios (contra 05, 06, 07 y 08)
| # | Resultado | Evidencia |
|---|---|---|
| 1 | Cumple | 07: build con y sin CA. La CA no aparece en `Config.Env`, en el bundle ni en el historial de las imágenes |
| 2 | Cumple | 07: `-ExportCa` con y sin `-Yes`, PEM ignorado y con ACL, idempotente |
| 3 | Cumple | 07: `-Docker` con código 0, `-Smoke` con Login OK en 3001, puertos en 127.0.0.1 y `-Stop` sin pérdida de datos |
| 4 | Cumple | 07, re-test: código 9 con la pista de `-ExportCa`, disparada por un error de apk. El caso de Turbopack está cubierto solo por tests |
| 5 | Cumple | 07: 0 líneas `RemoteException` |
| 6 | Cumple | 07: URL 3002 y aviso con `FRONTEND_PORT` cambiado |
| 7 | Cumple (tests) | 07 y 05 |
| 8 | Cumple | 07: 8080 y 3002 solo en 127.0.0.1, con el rewrite funcionando |
| 9 | Cumple (tests) | 07 y 05 |
| 10 | Cumple | 07: el proceso inyectado sobrevive a `-Stop` |
| 11 | Cumple | 07: `icacls` después de `-Init` (V-1). El caso sin ACL está cubierto por tests |
| 12 | Cumple | 07: `postgres:16.11-alpine` sobre el volumen existente |
| 13 | Cumple | 07: +1 User, 0 membresías, idempotente |
| 14 | Cumple | 07: Login OK en desarrollo y en Docker, también después de las rotaciones |
| 15 | Cumple | 07: repo temporal con casos positivos y negativos, sin valores en la salida. `core.hooksPath` activo |
| 16 | Cumple al commitear | 07: el diff es solo `name`. Va en el commit de cierre |
| 17 | Cumple | 07: rotación con código 0, la contraseña vieja rechazada y los dos modos OK. Se suma `-RotateJwtSecret` |
| 18 | Cumple parcial hasta el push | 07: `.bak` y volúmenes borrados. `_backup_git` se borra inmediatamente después del push (ver Desvíos) |
| 19 | Cumple | 07: 8/3/72/324/1482 → 9/3/72/324/1483, solo el usuario de humo |
| 20 | Cumple | 07: 980 tests OK, `tsc` 0/0, `npm test` 21 OK, lint sin errores nuevos, compose OK |
| 21 | Cumple | 08 |

Revisor: APROBADO (05). Seguridad: APROBADO (06). Tester: APROBADO (07). Documentador: APROBADO (08).
Se usaron 2 de las 3 vueltas de corrección:
- **Vuelta 1:** bloque duplicado y claves repetidas en `.env`.
- **Vuelta 2:** B-1, H-2 y N-3 del tester. H-2 se completó con una revisión corta del revisor y de
  seguridad antes del re-test.

## Desvíos respecto del plan
- **`_backup_git`:** `C:\Repositorios\_backup_git\` se borra después del push y no durante el testing.
  Así, el barrido de secretos del commit todavía puede usar `valores.txt`. Los valores que contenía ya
  no están vigentes, porque se rotaron.
- **`-RotateJwtSecret`:** el PO lo agregó al alcance (M-9 de seguridad), porque el `JWT_SECRET` anterior
  figuraba entre los valores expuestos.
- **H-2:** estaba fuera de los 21 criterios. Se resolvió igual, para que el modo Docker funcione con
  una base nueva.
- **Huella de la CA local:** se reemplazó por un placeholder en 03 y 07 antes de commitear. No es un
  secreto, pero identifica el entorno de esta máquina.

## Qué quedó pendiente
- **Verificaciones que no se hicieron en vivo:**
  - la pista con el error real de Turbopack (el build cortó antes, en apk);
  - las migraciones en Docker con una base vacía: no se creó una, para no escribir en Postgres.
    Sí se comprobó que los engines están en la imagen y que `prisma -v` funciona sin red;
  - un build sin CA en una red sin inspección TLS;
  - PowerShell 7.
- **Para la 005 (seguridad del backend):**
  - BACKLOG 7: logs sin contraseñas ni tokens;
  - BACKLOG 9: CORS con lista blanca;
  - BACKLOG 1: verificación real de JWT;
  - BACKLOG 8: `next` y `axios`;
  - un usuario sin membresía, como el de humo, debe recibir 401 o 403;
  - N-4: el login sin `user` debe responder 400 y no 500;
  - los 2 errores de lint preexistentes de `bootstrap.ts`.
- **Acción del usuario:** activar push protection o secret scanning en GitHub, como segunda barrera
  del hook.
- **Posible feature futura:** `User.cuit` está en el schema, pero no tiene migración.

## Pasos omitidos
- **UX/UI:** no aplica, porque el feature es solo de consola.
