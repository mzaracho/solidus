# 09 — Cierre: 003-arranque-local-rapido

Autor: PO. Fecha: 2026-10-27.

## Qué se entregó
- `dev.ps1` en la raíz, con la biblioteca `scripts/dev-lib.ps1` y 240 tests propios en
  `scripts/dev-lib.tests.ps1`. Funciona en Windows PowerShell 5.1. Modos: desarrollo (por defecto),
  `-Docker`, `-Stop`, `-Seed`, `-Smoke` e `-Init`, con códigos de salida del 0 al 8.
- **Fuente única de credenciales:** el `.env` de la raíz. `backend/.env` lo genera el script, con
  `DATABASE_URL` derivada y escapada. La migración del archivo heredado deja un respaldo `.bak`.
- **`docker-compose.yml`:**
  - sin IP de la red local, sin `CORS_ORIGIN` y sin `version`;
  - `NEXT_PUBLIC_API_BASE_URL` parametrizada;
  - puertos publicados en `127.0.0.1` (`BIND_ADDRESS` opcional para la API y el frontend; Postgres
    siempre en loopback);
  - `restart: unless-stopped`.
- Se eliminó `backend/docker-compose.yml`. Desarrollo y Docker comparten la base del compose de la raíz.
- **SSR del frontend fuera de Docker:** el default de `data.ts` pasa a `localhost`. Se agregó
  `frontend/.env.example`.
- **`FRONTEND_PORT` (criterio 18, ajuste de alcance):** el frontend de desarrollo corre en un puerto
  configurable. En esta máquina se usó 3002, porque el 3000 es de otro proyecto.
- **Seeds seguros:** son opt-in, detectan los seeds destructivos por contenido, piden `BORRAR` y
  cancelan si no hay consola interactiva. Solo operan contra un daemon de Docker local.
- **Documentación:** `.claude/CLAUDE.md`, `docs/auditoria/COMANDOS.md` (nueva sección 0),
  `ARQUITECTURA.md`, `RIESGOS.md` y `CLAUDE.borrador.md`. Ningún archivo versionado conserva la IP de la
  red local.

## Verificación de criterios (PO, contra los informes 04 a 08)
| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Fuente única de credenciales | Cumple | 07 B.1 y D; 04 §2 |
| 2 | Sin IP fija | Cumple | 07 C.4; 08 (`git grep` vacío) |
| 3 | SSR en desarrollo | Cumple (con límite) | 07 B.2: sin `ENOTFOUND` y rewrite hacia el backend. No se probó el SSR autenticado |
| 4 | Plantillas sin secretos | Cumple | 06 (barrido en 0); 07 E (barrido en 0) |
| 5 | `dev.ps1` en 5.1 y 7 | Cumple en 5.1; en 7 solo estático | 07 E. `pwsh` no está instalado |
| 6 | Primera vez | Cumple | 07 D (48/64, idempotente, sin mostrar secretos) |
| 7 | Prerrequisitos y puertos | Cumple | 07 B.1 y C.1; tests |
| 8 | Base: migrate y generate, sin `db push` | Cumple | 07 B.1 |
| 9 | `npm install` condicional | Cumple | 07 B.1; lockfiles sin cambios |
| 10 | Backend, frontend y URLs | Cumple | 07 B.1 y B.2 |
| 11 | Modo Docker | **Pendiente de verificar en vivo** | 07 C.1: el build falla en `apk add` por la inspección TLS de la red, reproducido fuera del proyecto. La configuración se validó (`compose config`, puertos en 127.0.0.1, `-Docker` con el modo desarrollo vivo da código 2) |
| 12 | Detener sin borrar datos | Cumple | 07 B.7 y C.5 |
| 13 | Seeds seguros | Cumple | 07 B.5; tests de la rama interactiva |
| 14 | Prueba de humo | Cumple (login salteado) | 07 B.3. `SMOKE_USER`/`SMOKE_PASSWORD` no están cargados |
| 15 | Prueba de punta a punta | Parcial | Desarrollo y clon nuevo completos; Docker según el criterio 11. Datos intactos: 8/3/72/324 y 1482 filas antes y después |
| 16 | Calidad | Cumple | `tsc` en 0 y 0, eslint sin errores nuevos, `compose config` en 0 |
| 17 | Documentación | Cumple | 08 |
| 18 | `FRONTEND_PORT` | Cumple | 07 B.1 a B.7 con 3002; 05 vuelta 4; 06 |

## Qué quedó pendiente
1. **Criterio 11 (modo Docker en vivo):** repetir `.\dev.ps1 -Docker` y `.\dev.ps1 -Smoke` (frontend
   en 3001) en una red sin inspección TLS, o con el certificado raíz de la red instalado en Docker.
2. **Hallazgos menores sin corregir** (no bloquean):
   - un fallo de `compose up --build` sale con el código 3 ("Base de datos"), cuando correspondería
     un código propio;
   - en 5.1 aparecen líneas `RemoteException` en la salida cuando falla un comando nativo;
   - la rama "ya está levantado" toma el puerto del `.env` actual (05 M-1);
   - usar `[0-9]` en lugar de `\d` (05 M-2);
   - Next dev escucha en todas las interfaces, igual que antes (06 F-2): se puede agregar
     `-H 127.0.0.1`.
3. **Menores de seguridad pendientes** (06): S-1 (permisos del `.env` en Windows), S-4 (borrar los
   `.bak`), S-5, S-6 (fijar la imagen de Postgres) y los riesgos residuales R-1 a R-6 (logs con la
   contraseña y el token, CORS abierto, JWT sin verificar).
4. **Acciones del usuario:**
   - borrar `backend/.env.pre-003*.bak` cuando todo funcione;
   - decidir qué hacer con el volumen huérfano `backend_postgres_data`;
   - cargar `SMOKE_USER`/`SMOKE_PASSWORD` si quiere probar el login en `-Smoke`;
   - rotar la contraseña de Postgres de menos de 16 caracteres (el script lo avisa);
   - borrar `C:\Repositorios\_backup_git\` cuando esté conforme.
5. **`frontend/package-lock.json`:** figuraba modificado desde antes de las pruebas, y `dev.ps1` no lo
   tocó durante el testing. Se revisa antes del commit y, si no es del feature, queda fuera.
6. **Propuestos para después:** feature de seguridad del backend (BACKLOG 7, CORS, JWT) y un hook
   `pre-commit` contra secretos.

## Pasos omitidos y por qué
- **UX/UI:** no aplica, porque no hay interfaz gráfica.
- **Arquitecto, para el criterio 18:** no se relanzó. Es un parámetro acotado sobre el diseño aprobado
  y lo cubrieron el revisor (vuelta 4) y seguridad.
- **PowerShell 7 en ejecución:** no está instalado y el usuario no autorizó instalarlo. Se verificó solo
  de forma estática.
- **Rama interactiva de `-Seed` con `BORRAR`:** no se ejecutó, por la salvaguarda de no escribir en la
  base. Está cubierta por los tests con stubs.

## Vueltas de corrección
Se usaron 2 de 3: B-1 de la revisión y M-1/S-2/S-3 de seguridad. El criterio 18 fue un ajuste de
alcance y no un rechazo.

## Commit y push
Están autorizados por el usuario con todo aprobado y sin force. Antes del commit:
- `.claude/settings.json` vuelve al estado de HEAD (regla 12);
- se hace un barrido de secretos sobre lo que se va a commitear;
- se agregan solo los archivos del feature.
