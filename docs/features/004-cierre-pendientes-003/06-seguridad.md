# 06 - Seguridad: 004-cierre-pendientes-003

> Nota del PO: el agente de seguridad no puede escribir archivos de informe. Devolvió cada informe y
> el PO lo guardó. Las re-verificaciones están sin cambios de contenido. El informe inicial está
> resumido en las conclusiones por área, pero conserva completos los hallazgos y las condiciones.
> Orden: el más reciente arriba.

## Re-verificación: H-2 completado (cierre de la vuelta 2, vigente)

Solo lectura. No se ejecutaron `dev.ps1`, builds ni contenedores.

| Punto | Resultado |
|---|---|
| Pasos con red de `backend/Dockerfile` | Los cinco usan el mismo `--mount=type=secret,id=extra_ca` y el `bind` de `with-extra-ca.sh`: en el builder, `apk add openssl` (líneas 12-14), `npm install`, `prisma generate` y `prisma -v`; en el runner, `apk add` (líneas 46-48). `RUN test -f` (líneas 32-33) y `npm run build` no usan red ni montan el secreto. |
| CA en capas | No queda en ninguna. El bundle se arma en `mktemp` y se borra con `trap`. Las variables se exportan solo en el proceso hijo. Se rechazan archivos con `PRIVATE KEY` o sin `BEGIN CERTIFICATE`. |
| `ENV` | No hay `ENV` de CA ni `ENV PRISMA_*`. El único `ENV` sigue siendo `NODE_ENV production`. |
| TLS | No se desactiva. |
| Sin CA | Ejecuta `"$@"` tal cual. El build es el de antes, más `openssl` en el builder (ya estaba en el runner). |
| N-3 (`dev-lib.process.ps1:240`) | Texto fijo que solo menciona la ruta `.dev\processes.json`, sin contenido, PIDs ni excepciones. |
| Barrido de secretos | `POSTGRES_PASSWORD`, `JWT_SECRET` y `SMOKE_PASSWORD`, comparados en memoria, dan 0 coincidencias. Claves privadas y `eyJ`: 0. URLs con credenciales: solo placeholders (`change-me`, `fakeuser`, `urluser`). `192.168.`: solo como patrón y en tests. Nada staged. No hay archivos sensibles trackeados; los únicos `.sql` son migraciones. |
| `.claude/settings.json` | `git diff --ignore-cr-at-eol` está vacío. |

Hallazgos nuevos: ninguno.
- Si el nombre de un engine no coincide, el `test -f` corta el build. Falla cerrado, así que es un riesgo funcional y no de seguridad.

VEREDICTO PARCIAL: APROBADO

---

## Re-verificación: corrección vuelta 2 (hallazgos del tester)

Solo lectura. No se ejecutaron `dev.ps1`, builds ni contenedores.

| Punto | Resultado |
|---|---|
| `backend/Dockerfile`, nuevo `RUN ... npx prisma -v` | Usa el mismo `--mount=type=secret,id=extra_ca` y el `bind` de `with-extra-ca.sh`. No hay `ENV` de CA ni `COPY`/`ADD` de PEM; el único `ENV` es `NODE_ENV` en el runner. No desactiva TLS. Sin secreto, ejecuta el comando tal cual. Bajar los engines en el build en vez de en runtime es positivo. |
| `$script:TlsErrorPattern` | Solo decide si se muestra la pista y el código 9. No relaja TLS ni confía en ninguna CA. |
| N-3 (`dev-lib.process.ps1:218-241`, `dev.ps1:321-326`) | `Test-DevStateReadable` devuelve un booleano y no propaga la excepción. El mensaje es fijo. `Stop-DevProcesses` no cambió, así que S-5 se mantiene. |
| Barrido de secretos (38 archivos modificados o nuevos) | `POSTGRES_PASSWORD`, `JWT_SECRET` y `SMOKE_PASSWORD`, comparados en memoria, dan 0 coincidencias. Claves privadas y `eyJ`: 0. URL con credenciales: solo el placeholder `change-me` de `backend/.env.example:7`. `192.168.`: solo en la spec, en el regex del hook y en un test con IP armada. |
| Archivos sensibles | Ningún `.pem`, `.crt`, `.key`, `.cer`, `.env` ni `.dev/` está trackeado. No hay nada staged. `.env`, `.dev` y `backend/.env` están ignorados. |
| `.claude/settings.json` | `git diff --ignore-cr-at-eol` está vacío: solo cambia el fin de línea. |

Hallazgos nuevos: ninguno.
- Observación sin acción: `Test-DevStateReadable` y `Stop-DevProcesses` leen el archivo por separado. No es explotable, porque toda entrada se verifica igual.
- La eficacia funcional de H-2 queda para el tester.

---

## Re-verificación: corrección vuelta 1

Solo lectura. No se ejecutaron `dev.ps1`, builds, Docker ni SQL, y no se imprimieron valores de `.env`.

| Punto | Resultado |
|---|---|
| N-1: duplicados entre módulos | Sin funciones ni constantes `$script:` repetidas en `dev-lib.{ca,core,db,docker,dotenv,env,hooks,process}.ps1`. Las constantes están solo en `dev-lib.core.ps1:5-31`. Los nombres repetidos de `dev-lib.tests.ps1` son mocks. |
| N-2: `Assert-DotEnvKeysUnique` (`dev-lib.env.ps1:128-141`) | Cuenta cada clave con `-ceq`. Si hay más de una, corta con código 1 y el mensaje nombra solo la clave y la cantidad. |
| `Set-DotEnvValues` | Llama al assert antes de escribir (`:146`). Después lee de nuevo con `Read-DotEnv` y compara en memoria (`:164-169`). |
| Escritura atómica (`Write-SecretFile`, `:80-100`) | Temporal con ACL de dueño, UTF-8 sin BOM, `File.Replace` o `Move`, temporal borrado en `finally` y ACL reaplicada. |
| `-RotateDbPassword` | El assert va antes de la confirmación, de levantar la base y del `ALTER ROLE` (`db.ps1:253` y `:278`). Si falla el guardado del `.env`, código 10 con un mensaje de reintento sin valores. La verificación por TCP usa stdin. |
| `-RotateJwtSecret` | El assert va antes de la confirmación y de generar el secreto (`:321` y `:329`). |
| Barrido de secretos | `POSTGRES_PASSWORD` y `JWT_SECRET` (comparados en memoria) no aparecen en los archivos modificados ni en los nuevos. Ningún `Write-*` interpola valores secretos. |
| `.claude/settings.json` | `git diff --ignore-cr-at-eol` da 0 líneas: solo cambia el fin de línea. |

- N-1: resuelto.
- N-2: resuelto.
- Menor informativo: la comparación de claves distingue mayúsculas y minúsculas, y las líneas comentadas no cuentan. Coincide con cómo lee compose; no requiere acción.

---

## Re-verificación: correcciones post-revisión

Resultado: APROBADO con N-1 y N-2 (corregidos después, ver arriba).

### Verificaciones
- **Barrido de secretos:** con `valores.txt` y con los valores actuales del `.env`, comparados en memoria, sobre el diff y los 37 archivos nuevos o modificados, el resultado es 0. Los patrones del hook solo encuentran coincidencias inocuas, como la propia definición del patrón bcrypt. No hay desactivación de TLS en ningún lado.
- **`core.hooksPath`:** sigue sin definir.
- **V-1:** las ACL de `.env` en disco siguen heredadas. Es lo esperado hasta que se ejecute `-Init` en real.
- **Valores expuestos:** el `POSTGRES_PASSWORD` y el `JWT_SECRET` actuales todavía figuran en `valores.txt`, porque no se rotaron.

### Estado de cada corrección
- **M-1 (`-ExportCa`): resuelto.**
  - Muestra el sujeto y la huella SHA-1 completa.
  - Pide confirmación (`s/N` o `-Yes`). Sin consola cancela con código 0 y no escribe nada.
  - Avisa cuando la cadena está incompleta o la raíz no está en el almacén de Windows.
  - Si no hay ninguna raíz exportable, sale con 1.
  - Exporta solo `RawData`.
- **M-2: resuelto.** `POSTGRES_USER` y `POSTGRES_DB` se validan con `$script:PostgresIdentifierPattern`, el mismo que usa la rotación.
- **M-3: resuelto.** Los `.dockerignore` excluyen `**/*.pem|crt|key|pfx|p12` y `.env*`.
- **M-4: resuelto.**
  - `getListenHost` usa `127.0.0.1` por defecto.
  - Compose define `LISTEN_HOST: "0.0.0.0"` y `Sync-BackendEnv` siempre escribe `LISTEN_HOST`.
  - Hay aviso de exposición en modo desarrollo y en Docker.
  - IPv6 se rechaza en modo Docker.
  - El backend arrancado a mano sin `LISTEN_HOST` queda en loopback, cerrado por defecto.
- **M-5: resuelto.**
  - El hook bloquea `.envrc`, `*.env`, `.env.*` salvo `.env.example`, `*.sqlite`, `*.sqlite3`, `*.db`, `*.dump` y los `.sql` fuera de `backend/prisma/migrations/`.
  - Se agregó el patrón bcrypt.
  - `.tar.gz` y `.rar` no se bloquean (documentado).
- **M-6: resuelto.**
  - El hook usa `ACMRT` y bloquea `*.jks`, `*.keystore`, `*.zip` y `*.7z`.
  - Sin `.env`, avisa y sigue.
  - Se corrigió el fallo latente y sigue fallando cerrado ante errores reales.
  - La segunda barrera es la push protection o el secret scanning de GitHub.
- **M-7: resuelto en código.** `.dev` y `.dev/certs` se crean con ACL. El efecto en disco se verifica en V-1.
- **M-8:** queda para el documentador.
- **M-9: resuelto en código.**
  - `-RotateJwtSecret` cambia solo `JWT_SECRET`, pide confirmación y no imprime valores.
  - Recrea solo el backend.
  - Usa los códigos 1 y 10.
- **Módulos:** no hay superficie nueva.
  - El hook carga solo `dotenv` y `secret-scan`.
  - Ningún módulo ejecuta código al cargarse.
  - No hay `Invoke-Expression`, `Add-Type` ni descargas.

### Hallazgos nuevos (menores)
- **N-1.** Bloque duplicado en `scripts/dev-lib.core.ps1:210-389`. Remediación: borrarlo.
- **N-2.** `Set-DotEnvValues` reemplazaba solo la primera aparición de la clave, pero `Read-DotEnv` y compose toman la última. Una rotación podía informar éxito sin efecto real. Remediación: fallar si la clave está duplicada y verificar después de escribir. Aplica también a `-RotateDbPassword`.

### Condiciones previas al commit
- **V-1:** verificar las ACL con `icacls` después de ejecutar en real. **Cumplida por el tester (07).**
- **V-2 resuelta:** `settings.json` es igual a HEAD, salvo el fin de línea.
- **Rotación:** ejecutar `-RotateDbPassword` y `-RotateJwtSecret` antes de la 005, y después borrar los backups autorizados. **Rotaciones hechas por el tester (07).**

---

## Revisión inicial

Resultado: APROBADO con M-1 a M-9 (corregidos después, ver arriba).

### Verificaciones
- **Barrido de secretos:** con `valores.txt` y con los valores actuales del `.env` en memoria, el resultado es 0. Los patrones del hook solo encuentran placeholders `{0}` y `{1}`.
- **Ignorados por git:** `git check-ignore` confirma que se ignoran el PEM, `*.pem` y `*.key` en subcarpetas, los `.bak` y los `.env.tmp-*`.
- **TLS:** no se desactiva en ningún lado.
- **Puertos:** `5433` escucha solo en `127.0.0.1`; `8080` y `3001` dependen de `BIND_ADDRESS`.
- **Hook:** `core.hooksPath` sin definir.
- **`package-lock.json`:** solo cambian `name` y el salto de línea final.
- **ACL:** heredadas (V-1).

### Conclusiones por área (resumen)
- **CA extra en builds: conforme.**
  - Usa un secreto de BuildKit y un script montado con `bind`, así que la CA no queda en ninguna capa y el runner del backend queda cubierto.
  - Sin BuildKit, el build falla cerrado.
- **`-ExportCa`: conforme.**
  - Exporta solo la parte pública, con la validación TLS normal de Windows y DACL propia.
  - Debilidad de criterio: ver M-1.
- **`-CreateSmokeUser`: conforme.**
  - El `ON CONFLICT` tiene una segunda barrera por nombre, el email y el hash pasan por regex, y la contraseña va por stdin con bcrypt cost 10.
  - Crea una sola fila en `User`.
- **`-RotateDbPassword`: conforme.**
  - El valor va por stdin con `format('%I','%L')`.
  - Orden: base, `.env`, `backend/.env`, verificación scram por TCP y recreación del backend.
  - Pide confirmación y usa los códigos 3 y 10.
- **ACL: código conforme.** Usa SIDs, herencia cortada, un temporal con ACL y `File.Replace`.
- **Hook: conforme.**
  - Falla cerrado, analiza solo las líneas agregadas y no imprime valores.
  - Lee `settings.json` desde el blob staged.
- **Loopback, daemon por TCP en loopback y `-Stop` con línea de comandos: conformes.**
- **Inyección:** todas las entradas están validadas salvo M-2.

### Hallazgos (menores)
- **M-1.** La auto-detección de la CA no pide confirmación y la huella sale truncada. Si la cadena no llega al almacén, se informa en silencio que "son públicas". Remediación: mostrar la huella completa y el sujeto, confirmar o usar `-Yes`, y avisar cuando la cadena esté incompleta.
- **M-2.** `POSTGRES_USER` y `POSTGRES_DB` no se validan en `-CreateSmokeUser`. Remediación: aplicar el `$idPattern`.
- **M-3.** El `.dockerignore` no es recursivo. Remediación: `**/*.pem`, etc.
- **M-4.** No hay aviso cuando la API queda expuesta en la red, y el default de `getListenHost` es `0.0.0.0`. Remediación: avisar y usar `127.0.0.1` por defecto.
- **M-5.** Cobertura del hook. Remediación: bloquear `.envrc`, `*.env`, `*.sqlite`, `*.db`, `*.dump` y `*.sql` fuera de las migraciones, y detectar bcrypt.
- **M-6.** Límites del hook: binarios, el filtro `T` y el aviso cuando falta `.env`. Remediación: `ACMRT`, bloqueo por extensión y push protection en GitHub.
- **M-7.** `.dev` se crea con permisos heredados en el primer uso. Remediación: aplicarle la ACL en `Protect-LocalSecretFiles`.
- **M-8.** Si falla el SQL del usuario de humo, el hash bcrypt puede quedar en `docker compose logs db`. Remediación: documentarlo.
- **M-9.** El `JWT_SECRET` vigente figura en los valores expuestos y no hay forma de rotarlo. Remediación: rotarlo antes de la 005 (`-RotateJwtSecret`).

### Condiciones previas al commit
- **V-1.** Verificar con `icacls` que las ACL quedaron restringidas después de la ejecución real.
- **V-2.** Restaurar `.claude/settings.json` a HEAD.

### Riesgos residuales
- **Usuario de humo:** no tiene organización ni membresía. Hoy no agrega privilegios, porque los JWT no se verifican y los headers se pueden fabricar. En la 005 hay que comprobar que un usuario sin membresía reciba 401 o 403. Su contraseña aparece en el log debug del backend (R-1, BACKLOG 7).
- **Backups con secretos** (`_backup_git\002-redact\valores.txt` y `.bak`): borrarlos al cerrar (autorizado). Los `.bak` ya se borraron (07); `_backup_git` se borra después del push.
- **SHA-1:** se usa solo como identificador en `EXTRA_CA_THUMBPRINT`.
- **Hook local:** se puede saltear con `--no-verify`.

### Dependencias
No hay dependencias nuevas. No se corrió `npm audit`.

---

VEREDICTO: APROBADO
