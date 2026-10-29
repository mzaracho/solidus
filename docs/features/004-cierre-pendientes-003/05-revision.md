# 05 - Revisión: 004-cierre-pendientes-003

> Nota del PO: el revisor no puede escribir archivos de informe en este entorno. Devolvió cada
> informe y el PO lo guardó sin cambios de contenido. Orden: el más reciente arriba.

# Revisión: H-2 completado y menor de N-3 (cierre de la vuelta 2, vigente)

No se ejecutó el build real. La detección de plataforma y los nombres de los engines se confirmaron
leyendo el código de Prisma 5.22.

## `backend/Dockerfile`
- **`openssl` en el builder (líneas 12-14):** correcto. Va envuelto en `with-extra-ca.sh` y antes de
  `npm install`. Prisma detecta la plataforma por openssl, así que el builder y el runner (línea 48)
  resuelven `linux-musl-openssl-3.0.x`.
- **Ubicación de los engines:**
  - el `postinstall` de `@prisma/engines` (`postinstall.js:78-101`) baja el schema engine a
    `node_modules/@prisma/engines/`;
  - el query engine queda en `node_modules/.prisma/client/`.
- **Nombres del `test -f` (líneas 32-33): correctos.**
  - `getBinaryName` arma `schema-engine-linux-musl-openssl-3.0.x`, sin extensión.
  - `getNodeAPIName` arma `libquery_engine-linux-musl-openssl-3.0.x.so.node`
    (`engines/dist/index.js:101`).
- **`npx prisma -v` (línea 30):** queda como respaldo porque el `postinstall` usa `failSilent`. El
  `test -f` hace que una falla se vea en el build y no en runtime.
- **Runner (línea 51):** copia `node_modules` completo del builder, sin prune.

## N-3 (`scripts/dev-lib.process.ps1:240`)
El mensaje dice que puede haber ventanas sin detener y que con un registro parcialmente válido se pudo
detener alguna. Es correcto, y los tests pasan.

## Regresiones
- **Tests:** `scripts\dev-lib.tests.ps1` da **980 OK, 0 fallidos**.
- **Parser:** 0 errores.
- **BOM:** uno solo en los 13 archivos.
- **`docker compose config --quiet`:** 0 con y sin el override.

## Hallazgos menores
- El `postinstall` usa un lock de 20 segundos y `failSilent`. Si omite la descarga, solo `prisma -v`
  cubre el schema engine. Es aceptable, porque el `test -f` lo detecta.
- El tester tiene que confirmar en vivo que `prisma migrate deploy` no descarga nada al arrancar.

VEREDICTO PARCIAL: APROBADO

---

# Re-revisión: corrección vuelta 2 (hallazgos del tester B-1, H-2 y N-3)

Resultado: APROBADO. H-2 queda observado como MAYOR no bloqueante. El PO lo devolvió al
desarrollador para completarlo (ver arriba y en 04, "Corrección vuelta 2").

## Verificaciones ejecutadas
- `scripts\dev-lib.tests.ps1`: **974 OK, 0 fallidos**.
- Parser y BOM de `dev.ps1` y de los 12 `scripts/*.ps1`: 0 errores de sintaxis y un solo BOM en cada archivo.
- Funciones duplicadas: ninguna `^function` repetida en los `dev-lib*.ps1` (sin contar el de tests).
- `docker compose config --quiet`: 0, con y sin `-f docker-compose.extra-ca.yml`.
- Se leyeron `scripts/dev-lib.core.ps1:26`, `backend/Dockerfile`, `scripts/dev-lib.process.ps1:218-241`,
  `dev.ps1:321-326`, `backend/docker/with-extra-ca.sh`, `backend/prisma/schema.prisma` y `backend/package.json`.
- No se hizo ningún build, por regla.

## Estado por hallazgo
- **B-1: resuelto.**
  - El patrón suma `TLS-related` y `Error while requesting resource`.
  - No hay `certificate` suelto.
  - Tiene 3 tests positivos y 3 negativos.
  - MENOR: `Error while requesting resource` es genérico. Un fallo de red cualquiera (DNS, sin
    conexión) también mostraría la pista de `-ExportCa`. Es solo una pista; se acepta.
- **N-3: resuelto.**
  - `Test-DevStateReadable` no expone contenido.
  - `Stop-DevProcesses` no cambió, así que no se mata nada sin verificar.
  - MENOR (`dev-lib.process.ps1:240`): con una entrada válida y otra inválida, la válida se detiene.
    En ese caso el texto "no se detuvo ninguna ventana" es inexacto. Sugerencia: "puede haber
    ventanas sin detener".
- **H-2: no confirmado. MAYOR, no bloqueante.**
  - **Por qué el paso nuevo no ayuda:** `npx prisma -v` en el builder probablemente no hace nada.
    El postinstall de `@prisma/engines` ya descargó el schema-engine durante `npm install`, que
    corre con la CA.
  - **Causa probable del fallo en runtime:** las plataformas del builder y del runner no coinciden.
    - El builder (`node:22-alpine`, sin openssl) baja el motor de `linux-musl`.
    - El runner tiene `openssl` 3, así que Prisma busca el motor de `linux-musl-openssl-3.0.x` y lo
      descarga en runtime sin la CA.
    - `binaryTargets` cubre solo el query engine.
  - **Sugerencia:** elegir una de estas opciones y verificar que exista
    `node_modules/@prisma/engines/schema-engine-linux-musl-openssl-3.0.x`.
    - Instalar `openssl` en el builder (con `with-extra-ca.sh`) antes de `npm install`.
    - Usar `PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x` durante el build.
- Recordatorio: `.claude/settings.json` figura modificado. Revisarlo antes de commitear (regla 12).

---

# Re-revisión: corrección vuelta 1

## Verificaciones ejecutadas
- `scripts\dev-lib.tests.ps1`: **958 OK, 0 fallidos**. Los avisos de "truncate.sql" que salen en la consola son salida normal de los tests.
- Parser y BOM de los 13 `.ps1` (`scripts/*.ps1` y `dev.ps1`): 0 errores de sintaxis, un solo BOM en cada archivo y ninguno con BOM doble.
- Duplicados: ningún nombre de `^function` ni ninguna asignación `$script:X =` aparece repetido en los `dev-lib*.ps1` (sin el de tests). Se comprobó con un script propio, ejecutado desde el directorio temporal y no desde el repo.
- `dev-lib.core.ps1` tiene 208 líneas (antes 389). Sus 7 módulos hermanos están limpios.
- `npx tsc --noEmit` del backend: sin errores. `npm test` del backend: 2 suites, 21 tests OK.
- `docker compose config --quiet`: código 0, con y sin `-f docker-compose.extra-ca.yml`.
- `.claude/settings.json`: el harness no agregó permisos nuevos. El diff sigue siendo solo el aviso LF→CRLF.

## Estado de los hallazgos
- **M-1 (duplicado en `dev-lib.core.ps1`): resuelto.** El bloque repetido ya no está. Hay tests de unicidad en `dev-lib.tests.ps1` (cerca de la línea 1785): un chequeo por `^function` y otro por `$script:`. Fallarían si alguien reintroduce un duplicado.
- **m-1 (comentario de uso): resuelto.** `scripts/dev-lib.ps1:2` ahora dice `. .\scripts\dev-lib.ps1`.
- **m-2 (afirmaciones sobre `bootstrap.ts`): resuelto.** El texto de 04 ya dice que `bootstrap.ts` sí se modificó.
- **N-2 (claves duplicadas en `.env`): resuelto.**
  - `Assert-DotEnvKeysUnique` (`dev-lib.env.ps1:128`) falla con código 1 y nombra solo la clave, sin valores.
  - La llaman `Set-DotEnvValues` antes de leer y escribir (`env.ps1:146`), `Invoke-RotateDbPassword` antes de la confirmación y del `ALTER ROLE` (`db.ps1:253`) e `Invoke-RotateJwtSecret` (`db.ps1:321`).
  - Después de escribir, se verifica en memoria el valor efectivo.
  - Los tests usan valores ficticios.

## Hallazgos nuevos
Ninguno bloqueante ni mayor. Un comentario menor, sin acción requerida: `Assert-DotEnvKeysUnique` cuenta solo las líneas que reconoce `Get-DotEnvEntries`, y la verificación posterior cubre el caso de una línea mal formada. No hay regresiones.

---

# Re-revisión: correcciones post-revisión (vuelta 2)

Resultado: RECHAZADO, solo por M-1. Se corrigió en la vuelta 1 de corrección (ver arriba).

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| `scripts\dev-lib.tests.ps1` | 944 OK, 0 fallidos |
| Parser, BOM y fin de línea de `dev.ps1` y los 12 `.ps1` de `scripts/` | 0 errores, todos con BOM y LF |
| `npx tsc --noEmit` backend y frontend | 0 y 0 |
| `npm test` backend | 2 suites, 21 tests OK |
| `npx eslint` sobre `listen-config.ts` y `listen-config.spec.ts` | Limpio |
| `npx eslint` sobre `bootstrap.ts` | 2 errores `no-unused-vars` (`DocumentBuilder`, `SwaggerModule`, línea 2), ya presentes en HEAD |
| `docker compose config --quiet`, con y sin el override de CA | 0 y 0 |
| Funciones definidas en HEAD (60) contra los 8 módulos | No falta ninguna |
| Funciones definidas más de una vez | Sí: ver M-1 |

## Hallazgos
- **MAYOR M-1.** `scripts/dev-lib.core.ps1` tenía todo su contenido duplicado: las líneas 29–208 y 210–389 eran idénticas. Quedaban definidas dos veces 14 funciones del núcleo y las constantes `SmokeUser*` y `SmokePasswordPattern`. No cambiaba el comportamiento, pero rompía el requisito de que cada función exista una sola vez y dejaba ediciones futuras tapadas por la segunda copia. Propuesta: borrar el bloque y agregar un test de unicidad.
- **MENOR m-1.** `scripts/dev-lib.ps1:2`: al comentario de uso le faltaba la barra.
- **MENOR m-2.** `04-implementacion.md` decía "no se tocó `bootstrap.ts`", pero el archivo sí se modificó.

## Estado de lo pedido en esa vuelta
- **R-5 (8 módulos):** conforme, salvo M-1.
- **R-6:** el hook carga solo `dev-lib.dotenv.ps1` y `secret-scan.ps1`.
- **M-9 `-RotateJwtSecret`:** cambia solo `JWT_SECRET`, pide `ROTAR` o `-Yes`, recrea solo el backend y reutiliza el código 10. OK.
- **M-4:** default `127.0.0.1`, con `LISTEN_HOST: "0.0.0.0"` en compose y siempre presente en `backend/.env`. OK.
- **M-1 de seguridad (`-ExportCa`):** OK.
- **R-1, R-2, R-3, R-4, M-2, M-5, M-6 y M-7:** OK.
- **M-8:** pendiente para el documentador.

---

# Revisión inicial (vuelta 1)

Resultado: APROBADO con menores. Los menores 1 a 6 se corrigieron después (ver arriba).

## 1. Verificaciones ejecutadas

| Verificación | Resultado |
|---|---|
| `scripts\dev-lib.tests.ps1` | 692 OK, 0 fallidos |
| Parser de PS 5.1 en los 5 `.ps1` | 0 errores; los 5 con BOM |
| `npx tsc --noEmit` en backend y frontend | 0 errores |
| `npx eslint` sobre `listen-config.ts`, `listen-config.spec.ts` y `bootstrap.ts` | Los dos primeros limpios; `bootstrap.ts` con 2 errores preexistentes |
| `npm test` en backend | 2 suites, 22 tests OK |
| `prettier --check` sobre los dos archivos nuevos del backend | OK |
| `docker compose config --quiet`, con y sin el override de CA | 0 en ambos |
| Barrido de patrones sobre los 27 archivos modificados o nuevos | 0 hallazgos |
| Finales de línea | El hook y los `with-extra-ca.sh` son LF y las dos copias son idénticas; `.gitattributes` coherente |
| Estado del repo tras los tests | `core.hooksPath` sin definir, sin archivos nuevos, `.dev/` vacío |

## 2. Hallazgos (menores)
1. Pista de TLS con falsos positivos (`certificate` suelto en `$script:TlsErrorPattern`).
2. `BIND_ADDRESS` IPv6 aceptada, pero rompe `-Docker`.
3. `.dockerignore` no cubre subcarpetas (`**/*.pem`, etc.).
4. Test del backend frágil, que leía `bootstrap.ts` como texto.
5. `dev-lib.ps1` difícil de recorrer (1928 líneas): conviene dividirlo en módulos.
6. El hook parsea toda la biblioteca en cada commit.
7. Cobertura no automatizable (TLS real, ramas de `dev.ps1`): queda para el tester.

## 3. Conformidad con spec y diseño
Conforme en los criterios 1, 2, 4 a 15 y 17. Los criterios 16, 18 y 19 los hacen el PO y el tester; el 21 es del documentador. Convenciones del backend OK y sin cambios de schema. Regla 12: hay que restaurar `.claude/settings.json` antes del commit.

---

VEREDICTO: APROBADO
