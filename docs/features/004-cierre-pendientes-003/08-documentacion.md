# 08 - Documentación: 004-cierre-pendientes-003

> Autor: documentador. Entrada: `.claude/CLAUDE.md`, `01-spec.md` (criterio 21), `03-diseno-tecnico.md`,
> `04-implementacion.md` (incluidas las correcciones), `06-seguridad.md` (M-8 y riesgos residuales), `07-testing.md`,
> `docs/auditoria/COMANDOS.md`, `docs/auditoria/RIESGOS.md` y `docs/features/003-arranque-local-rapido/08-documentacion.md`
> (estilo). Solo se tocó documentación: ni código, ni `.env`, ni `backend/.env`, ni `.claude/settings*.json`. No se
> ejecutó `dev.ps1` ni git de escritura. No se leyó ningún valor de `.env`.

## Qué cambió en el feature (resumen verificable)
- `dev.ps1` suma `-ExportCa`, `-CreateSmokeUser`, `-RotateDbPassword`, `-RotateJwtSecret` y `-Yes`; códigos de salida 9 y 10.
- Builds Docker con CA extra opcional (secreto de BuildKit, `docker-compose.extra-ca.yml`, `docker/with-extra-ca.sh`).
- Hook `pre-commit` versionado (`.githooks/`, `scripts/pre-commit.ps1`, `scripts/secret-scan.ps1`) activado por `-Init`.
- Modo desarrollo en loopback (`LISTEN_HOST` en el backend, `next dev -H`), IPv6 rechazada en modo Docker.
- ACL restringidas, `-Stop` verifica la línea de comandos, Postgres fijado en `postgres:16.11-alpine`.
- `scripts/dev-lib.ps1` ahora es un cargador de 8 módulos `scripts/dev-lib.<módulo>.ps1`.

## Archivos tocados
| Archivo | Cambio |
|---|---|
| `.claude/CLAUDE.md` | Sección Comandos: `-Init` ahora también restringe permisos y activa el hook; entradas breves para `-CreateSmokeUser`, `-ExportCa`, `-RotateDbPassword`/`-RotateJwtSecret`, códigos de salida 0 a 10 y el hook (activación, qué rechaza, `--no-verify`, push protection pendiente). `BIND_ADDRESS` ahora cubre el modo desarrollo, con `LISTEN_HOST` y el rechazo de IPv6 en Docker. La nota vieja de "el build Docker (`apk add`) puede fallar por TLS: es del entorno" se reemplazó por la solución (`-ExportCa`, código 9, nunca se desactiva TLS). Credenciales: una línea sobre las ACL. Stack: Postgres fijado. El resto sin cambios; las reglas del proyecto no se tocaron |
| `docs/auditoria/COMANDOS.md` | Sección 0: tabla de flags ampliada (4 flags nuevos, `-Yes`, `-Docker`, `-Stop`, `-Smoke` e `-Init` actualizados); tabla de códigos de salida completa (0 a 10, con el 3 acotado a base de datos y el 9 y el 10 nuevos); "Qué archivo editar" (la rotación manual con `\password` se reemplazó por `-RotateDbPassword`); variables (`FRONTEND_PORT` con dígitos ASCII, `BIND_ADDRESS` ampliada, `EXTRA_CA_THUMBPRINT`, `SMOKE_*`); subsecciones nuevas: "Bind en loopback", "CA extra para builds Docker", "Usuario de humo" (con el aviso M-8), "Rotaciones" (orden de pasos, código 10 y recuperación), "Permisos de los archivos con secretos (S-1)" y "Hook `pre-commit`"; errores comunes (TLS pasa a código 9 y a la solución, código 9 sin TLS, código 10, `core.hooksPath` ajeno, 401 en `-Smoke`, `P1000` ahora se resuelve con la rotación); archivos locales (`extra-ca.pem`, `-Stop` verifica); §2 (`postgres:16.11-alpine`), §5 (override de CA para el build manual) y §6 (usuario de humo) |
| `docs/auditoria/RIESGOS.md` (local, ignorado por git) | Nueva subsección "Arranque local y controles de secretos (features 003 y 004)": S-1, S-5 y S-6 resueltos, contraseña de Postgres, hook y TLS de builds; riesgos residuales (push protection de GitHub pendiente, hook salteable con `--no-verify`, CA exportada, hash de humo en el log de `db`, usuario de humo sin membresía, `BIND_ADDRESS=0.0.0.0`, 500 del login sin `user`). Notas de estado en S17 y S14 |
| `docs/auditoria/ARQUITECTURA.md` | §5: `db` pasa de `postgres:16-alpine` a `postgres:16.11-alpine` fijada |
| `docs/features/004-cierre-pendientes-003/08-documentacion.md` | Este informe |

README y CHANGELOG: no existen en la raíz (solo `backend/README*.md` y `frontend/README*.md`, genéricos), así que no se
agregó entrada de changelog. El historial queda en `docs/features/004-cierre-pendientes-003/`.

## Verificación contra el código
| Dato documentado | Fuente verificada |
|---|---|
| Flags, parameter sets, `-Yes` solo con `-ExportCa`/`-RotateDbPassword`/`-RotateJwtSecret`, ayuda y códigos | `dev.ps1` (bloque `param`, ayuda y `switch`) |
| Códigos 9 y 10 (valores y uso); códigos 2 y 3 de cada flujo; 1 por IPv6/clave duplicada/CA | `dev-lib.core.ps1` (`ExitCodeComposeUp`, `ExitCodeRotateIncomplete`), `dev-lib.db.ps1`, `dev-lib.ca.ps1`, `dev-lib.env.ps1` |
| Pista de `-ExportCa` ante error TLS (con y sin PEM) | `Get-TlsHint` en `dev-lib.ca.ps1`; patrón en `dev-lib.core.ps1:26` |
| `-ExportCa`: hosts de sondeo, imagen base, confirmación, huella completa, cancelación sin consola, `EXTRA_CA_THUMBPRINT`, destino del PEM | `Invoke-ExportCa` y constantes de `dev-lib.core.ps1` |
| `-Docker` usa el override si existe el PEM; secreto `extra_ca` | `dev.ps1` (`Invoke-DockerMode`), `docker-compose.extra-ca.yml` |
| La CA no queda en capas; sin PEM el comando se ejecuta tal cual; nunca se desactiva TLS | `backend/docker/with-extra-ca.sh`, `backend/Dockerfile`, `frontend/Dockerfile` (cada `RUN` con red usa `--mount=type=secret` y `bind`); sin `ENV` de CA. Confirmado en `07-testing.md` (Config.Env, `/run/secrets`, hash del bundle) |
| `openssl` y `prisma -v` en el builder, `test -f` de motores | `backend/Dockerfile` líneas 9 a 33; resultado en `07-testing.md` (re-test vuelta 2, H-2) |
| Ignorados por git y por `.dockerignore` | `.gitignore` (`.dev/`, `*.pem`, `*.crt`, `*.key`, `*.pfx`, `*.p12`); `04-implementacion.md` R-3 para los `.dockerignore` (`**/*.pem`, etc.) |
| Usuario de humo: formato, una fila, sin organización, idempotente, bcrypt cost 10 por stdin, solo actualiza una fila con ese nombre, `ON_ERROR_STOP`, `-Smoke` | `dev-lib.db.ps1` (`New-SmokeUserSql`, `Get-BcryptHash`, `Invoke-CreateSmokeUser`), `dev-lib.core.ps1:29-31`, `dev-lib.process.ps1` (`Invoke-SmokeTest`). Datos reales: `07-testing.md` (+1 `User`, 0 filas en `OrganizationMember`/`UserRole`/`Professional`) |
| M-8 (hash en `docker compose logs db` si falla el SQL) | `06-seguridad.md` M-8 y `04-implementacion.md` ("Para el documentador (M-8)"), coherente con `ON_ERROR_STOP` en el código |
| Rotación de Postgres: orden de pasos, valida identificadores y clave duplicada, rechazo con modo desarrollo vivo, `ALTER ROLE` por socket, `.env`, `backend/.env`, verificación por TCP, recreación del backend, códigos 2, 3 y 10 | `Invoke-RotateDbPassword` en `dev-lib.db.ps1` |
| Rotación de JWT: confirmación `ROTAR`, solo la línea `JWT_SECRET`, `backend/.env`, recrear solo el backend, aviso del modo desarrollo, códigos 1 y 10 | `Invoke-RotateJwtSecret` en `dev-lib.db.ps1` |
| Hook: activación, no pisa otro `core.hooksPath`, falla cerrado sin PowerShell, lista de archivos prohibidos y de patrones, regla de valores y avisos sin `.env`, `settings.json`, formato de salida sin valores, texto de `--no-verify` | `.githooks/pre-commit`, `scripts/pre-commit.ps1`, `scripts/secret-scan.ps1`, `Enable-RepoHooks` en `dev-lib.hooks.ps1` |
| ACL: SIDs (usuario, SYSTEM, Administradores), herencia cortada, lista de archivos y carpetas, aviso si no hay ACL | `dev-lib.env.ps1` (`Get-OwnerOnlySids`, `Set-OwnerOnlyAclCore`, `Protect-LocalSecretFiles`) |
| Loopback: `next dev -H`, `LISTEN_HOST` generado siempre, default `127.0.0.1`, compose con `0.0.0.0`, IPv6 rechazada en Docker, aviso de exposición, sonda `127.0.0.1` | `dev-lib.env.ps1` (`ConvertTo-BindAddress`, `Get-FrontendDevArgs`, `Sync-BackendEnv`, `Assert-DockerBindAddress`, `Get-BindExposureWarning`, `Get-ProbeHost`), `listen-config.ts`, `docker-compose.yml`, `.env.example`, `backend/.env.example` |
| `postgres:16.11-alpine`, puertos con `BIND_ADDRESS` y Postgres en loopback | `docker-compose.yml` |
| `-Stop` verifica la línea de comandos y avisa si el registro está dañado | `dev-lib.process.ps1` (`Test-DevWindowCommandLine`, `Get-ProcessCommandLine`), `dev.ps1` (`Invoke-StopMode`) |
| Resultados de pruebas en vivo citados en RIESGOS (ACL con `icacls`, S-5 con proceso ajeno, rotaciones ejecutadas) | `07-testing.md` (criterios 10, 11, 17 y 17b) |

## Qué no se documentó y por qué
- **Huella y nombre del certificado de la CA del antivirus de esta máquina:** no van en archivos versionados (pedido
  expreso). En los documentos se habla de "antivirus o proxy" y la huella se muestra en pantalla al ejecutar `-ExportCa`.
  `04-implementacion.md` y `07-testing.md` (ya existentes, no los modifiqué) sí la mencionan; el PO debe decidir
  antes del commit si esos informes se versionan tal cual.
- **Valores de contraseñas, `JWT_SECRET`, usuario de humo y rutas de respaldos con secretos:** nunca se escriben.
- **Borrado de `.bak`, volúmenes huérfanos y `C:\Repositorios\_backup_git\`:** es housekeeping operativo del 004, no
  una función del producto. Queda en `07-testing.md`. La sección "Volumen huérfano" de `COMANDOS.md` se dejó como está
  porque `dev.ps1` sigue avisando de ese volumen si existe.
- **Criterios 16 a 19 en vivo (lock del frontend, rotación real, limpieza, conteos de datos):** son del PO y del tester.
- **README y CHANGELOG:** no existen en la raíz; los README de `backend/` y `frontend/` (genéricos, el del backend dice
  "db push") siguen fuera de alcance, como en el 003.
- **Tests de PowerShell (cantidad de aserciones):** el número cambió varias veces (692, 944, 974, 980); no se escribió
  en `CLAUDE.md` ni en `COMANDOS.md` porque envejece. El comando de los tests ya estaba documentado.
- **Detalle interno de los módulos `dev-lib.<módulo>.ps1`:** es de implementación (ver `04-implementacion.md` §3).
- **Reglas de `CLAUDE.md`:** sin cambios; el feature no introduce reglas nuevas, solo comandos y convenciones de uso.

## Pendientes
1. **Push protection y secret scanning en GitHub:** acción del usuario, recomendada como segunda barrera del hook.
2. **`.claude/settings.json`:** el harness lo ensucia; revisar `git diff .claude/settings.json` antes de commitear (regla 12;
   el hook también lo rechaza si se stagea con `allow`).
3. **Informes del feature con la CA del antivirus nombrada** (ver arriba): revisar antes del commit.
4. Para la 005: verificar que el usuario de humo (sin membresía) reciba 401 o 403 cuando los JWT se verifiquen, y el 500
   de `POST /v1/auth/login` sin `user` (hallazgo N-4 del testing).
5. Verificaciones que quedaron sin hacer en vivo según `07-testing.md`: error real de Turbopack sin CA (solo cubierto por
   tests de patrón), `migrate deploy` sobre una base vacía en Docker, PowerShell 7.

VEREDICTO: APROBADO
