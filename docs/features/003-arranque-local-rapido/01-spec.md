# 003 — Arranque local rápido

## Contexto
Después del feature 002, las credenciales viven solo en archivos locales ignorados (`.env` en la raíz y
`backend/.env`). En la máquina actual el proyecto levanta, pero no de forma rápida ni confiable:

- **Credenciales duplicadas:** la contraseña de Postgres y `JWT_SECRET` están en los dos `.env` y hay
  que mantenerlos iguales a mano. `backend/.env` además repite usuario y contraseña dentro de
  `DATABASE_URL`.
- **IP fija en el compose raíz:**
  - `docker-compose.yml` hardcodea la IP de la red local de la máquina de desarrollo en
    `NEXT_PUBLIC_API_BASE_URL` (build arg del frontend) y en `CORS_ORIGIN`.
  - Si cambia la IP o se usa otra PC, el frontend no llega al backend.
  - `CORS_ORIGIN` hoy lo ignora el código (`cors-config.ts` usa `origin: true`).
- **SSR del frontend fuera de Docker:**
  - En modo desarrollo (`npm run dev`), `frontend/src/services/data.ts` usa `INTERNAL_API_URL` y, si
    falta, `http://backend:8080/api` (nombre del servicio Docker). Ese host no existe fuera de Docker.
  - No existe `frontend/.env.example` ni se documenta `frontend/.env.local`.
- **Arranque manual en varios pasos:** levantar Postgres, `npm install`, `prisma generate`,
  `prisma migrate deploy`, backend y frontend. En un clon nuevo, además, hay que crear los `.env` a mano.
- **Seeds:** son locales y opcionales. Algunos hacen `TRUNCATE` de todas las tablas.
- **Sin prueba de punta a punta:** nunca se probó el arranque completo con login después del 002.

Plataforma del usuario: Windows 11, PowerShell, Docker Desktop y Node 22+.

## Historia de usuario
Como desarrollador, quiero levantar todo el proyecto en local con un solo comando, tanto en esta
máquina como en un clon nuevo, sin editar archivos a mano ni duplicar credenciales, para empezar a
trabajar en minutos.

## Criterios de aceptación

### Configuración
1. **Fuente única de credenciales:** usuario, contraseña y nombre de la base de Postgres, y
   `JWT_SECRET`, se definen en **un solo archivo local**, el `.env` de la raíz. El backend en modo
   desarrollo (Nest y Prisma CLI) y los dos modos de arranque los toman de ahí, sin copiarlos a mano a
   otro archivo. Si el diseño necesita un `backend/.env`, lo genera o sincroniza el script de forma
   automática, y queda ignorado por git. `DATABASE_URL` no se escribe a mano.
2. **Sin IP fija:**
   - `docker-compose.yml` no contiene ninguna IP de red local.
   - La URL pública de la API para el frontend (`NEXT_PUBLIC_API_BASE_URL`) sale de una variable del
     `.env`, con `http://localhost:8080/api` por defecto.
   - `CORS_ORIGIN` se parametriza igual o se elimina del compose, porque el código no lo usa.
     Cambiar la política CORS del código queda fuera de alcance.
3. **SSR del frontend en modo desarrollo:**
   - el frontend en `npm run dev` funciona sin Docker, porque `INTERNAL_API_URL` apunta a
     `http://localhost:8080/api`;
   - el ajuste se hace por un archivo local generado (`frontend/.env.local`) o por un default correcto
     según el entorno, sin romper el modo Docker, donde se sigue usando `http://backend:8080/api`;
   - existe `frontend/.env.example` versionado, si corresponde.
4. **Plantillas:** `.env.example` (raíz) documenta todas las variables, incluidas las nuevas, solo con
   placeholders. Ningún archivo versionado contiene credenciales: siguen vigentes las reglas 3 y 12 de
   `CLAUDE.md` y los controles del feature 002.

### Script de arranque
5. **`dev.ps1` en la raíz:**
   - es compatible con Windows PowerShell 5.1 y con PowerShell 7;
   - con un solo comando (`.\dev.ps1`) deja el proyecto funcionando en **modo desarrollo**: Postgres en
     Docker y backend y frontend con hot reload;
   - si el arranque falla, muestra un mensaje claro de qué falló y cómo resolverlo.
6. **Primera vez (clon nuevo):**
   - si no existe `.env`, lo crea desde `.env.example`;
   - genera un `JWT_SECRET` aleatorio de 32 bytes o más y una contraseña aleatoria de Postgres;
   - no muestra esos valores en consola;
   - si `.env` ya existe, **no lo sobrescribe** ni cambia valores existentes, para no romper el volumen
     de Postgres ya inicializado. Solo agrega las variables nuevas que falten, con su default.
7. **Prerrequisitos:**
   - verifica que Docker esté corriendo y que Node y npm estén instalados, con un mensaje claro si falta
     algo;
   - avisa si los puertos 5433, 8080 o 3000 están ocupados por otro proceso (3000 = el puerto del
     frontend en desarrollo; ver criterio 18).
8. **Base de datos:**
   - levanta Postgres y espera a que acepte conexiones;
   - ejecuta `npx prisma migrate deploy` y `npx prisma generate`;
   - nunca usa `db push`.
9. **Dependencias:** ejecuta `npm install` en `backend/` y `frontend/` solo si falta `node_modules`, o
   si cambió el `package-lock.json` desde la última instalación.
10. **Backend y frontend:**
    - arranca `npm run start:dev` (backend) y `npm run dev` (frontend) para que el usuario vea sus logs,
      por ejemplo en ventanas separadas;
    - espera a que el backend responda y muestra las URLs: frontend, API y Swagger.
11. **Modo Docker completo:** `.\dev.ps1 -Docker` levanta el stack completo con `docker compose up
    --build -d` usando el mismo `.env`, y muestra la URL del frontend (`http://localhost:3001`).
12. **Detener:** `.\dev.ps1 -Stop` (o un `stop.ps1`) detiene lo que levantó el script: procesos de
    backend y frontend y contenedores. **No borra volúmenes ni datos.**
13. **Seeds (opcional y seguro):**
    - el script **no carga seeds por defecto**;
    - con un flag explícito (por ejemplo `-Seed`) carga los seeds locales que existan, en el orden
      documentado en `docs/auditoria/COMANDOS.md`;
    - si la base ya tiene datos, pide confirmación interactiva antes de cualquier seed que haga
      `TRUNCATE`;
    - si los archivos de seed no existen (clon nuevo), avisa y sigue;
    - solo opera contra el contenedor local (regla 10 de CLAUDE.md).

### Verificación
14. **Prueba de humo:** existe una forma automatizada (por ejemplo `.\dev.ps1 -Smoke` o
    `scripts/smoke.ps1`) que, con el proyecto levantado, verifica:
    - que el backend responde (Swagger o un endpoint público);
    - que el frontend responde en su puerto;
    - que el login funciona con un usuario de prueba.

    Las credenciales del usuario de prueba salen del `.env` local (variables `SMOKE_USER` y
    `SMOKE_PASSWORD`, con placeholders en `.env.example`), nunca de un archivo versionado. Si no están
    definidas, la prueba de login se saltea con un aviso y el resto se ejecuta. La prueba no escribe
    en la base.
15. **Probado de punta a punta en esta máquina:**
    - el tester ejecuta `.\dev.ps1` y la prueba de humo contra la base local actual, sin borrar ni
      reemplazar datos y sin cargar seeds;
    - verifica el modo Docker;
    - simula un clon nuevo en una carpeta temporal (sin `.env`), al menos hasta la creación del `.env`
      y la validación de la configuración.
16. **Calidad:**
    - `npx tsc --noEmit` sin errores en backend y frontend;
    - lint sin errores nuevos en los archivos tocados;
    - `docker compose config --quiet` OK.

### Documentación
17. **Docs:** `CLAUDE.md` (Comandos) y `docs/auditoria/COMANDOS.md` explican el arranque rápido
    (`.\dev.ps1`, `-Docker`, `-Stop`, `-Seed`, `-Smoke`), qué archivo local editar y cómo resolver los
    errores comunes. Si el diseño elimina `backend/docker-compose.yml`, se actualizan las referencias.

### Ajuste de alcance (pedido por el usuario durante la implementación)
18. **Puerto del frontend configurable en modo desarrollo (`FRONTEND_PORT`):**
    - en esta máquina el puerto 3000 lo usa otro proyecto (pm2), que no se toca;
    - `FRONTEND_PORT` en el `.env` de la raíz define el puerto de `npm run dev` del frontend; si falta
      o está vacío, se usa 3000;
    - debe ser un entero entre 1024 y 65535, distinto de 5433 y 8080; si no, error claro sin imprimir
      el valor;
    - el chequeo de puertos (criterio 7), la espera del frontend y las URLs (criterio 10) y la prueba
      de humo (criterio 14) usan ese puerto en modo desarrollo;
    - el modo Docker no cambia: el frontend sigue en 3001;
    - `.env.example` la documenta comentada; en un `.env` existente se agrega solo si falta, sin
      modificar valores;
    - la documentación (criterio 17) la explica.

## Fuera de alcance
- Scripts para macOS y Linux (bash). Se puede proponer después.
- Cambiar la política CORS del backend (`origin: true`), que es un riesgo de seguridad conocido y va
  aparte.
- Arreglar la verificación de JWT (riesgo S1).
- Distribuir los seeds por otro canal o crear seeds nuevos.
- Rotar la contraseña del volumen de Postgres existente.
- CI/CD.

## Riesgos
- **Volumen existente:** si el script regenerara la contraseña, Postgres dejaría de aceptar la
  conexión. Se mitiga con el criterio 6.
- **Seeds destructivos:** se mitiga con el criterio 13 (opt-in y confirmación).
- **Procesos colgados:** las ventanas o procesos de backend y frontend pueden quedar abiertos. Se
  mitiga con el criterio 12.
- **Política de ejecución de PowerShell:** puede bloquear scripts sin firmar. Hay que documentar
  `powershell -ExecutionPolicy Bypass -File .\dev.ps1` o `Unblock-File`.
- **Unificar los `.env`:** cambia el flujo actual. Hay que migrar sin perder los valores locales del
  usuario: el script detecta `backend/.env` existente y conserva sus valores.
- **`settings.json`:** al aprobar comandos durante la implementación se vuelve a ensuciar. Hay que
  revisarlo antes de commitear (regla 12).
- **Puerto 3000 de otro proyecto:** el script nunca detiene procesos ajenos; se mitiga con el
  criterio 18.

## Pasos del flujo
- Requiere UX/UI: **no**. No hay interfaz gráfica; los mensajes de consola los define el diseño técnico.
- Requiere seguridad: **sí** (generación y manejo de credenciales, `.env` y scripts que operan sobre la
  base).
- Arquitecto: **sí**. El criterio 18 es un ajuste acotado del diseño aprobado (parámetro de puerto);
  no se relanzó al arquitecto, lo cubren revisor y seguridad.
- Documentador: **sí**.
- Cambios de schema: ninguno.
- Commit y push: autorizados por el usuario cuando revisor, seguridad y tester aprueben (sin force).
