# 017 — Testing

Tester, 2026-11-18. Base: `main` en `07b43e0` más el working tree del 017 (sin commit). No se modificó código de producción.
Archivo de tests agregado: `backend/test/nest-build-compat.spec.ts` (ver BUG-1).

## 1. Resultado base (calidad)

| Control | Esperado | Resultado |
|---|---|---|
| Backend `npx prisma validate` / `generate` | OK | OK |
| Backend `npx tsc --noEmit` | 0 errores | 0 errores |
| Backend `npm test` | 51 suites / 935 | **51 suites / 935 en verde** (antes de agregar mi test) |
| Frontend `npx tsc --noEmit` | 0 errores | 0 errores |
| Frontend `npm test` | 129 | **129 en verde** |
| `.\dev.ps1 -CheckMigrations` | 0 | **0** ("Schema y migraciones coinciden"), también al final |
| `scripts\dev-lib.tests.ps1` (existe) | 1133 OK | 1134 OK, 0 fallidos (1 más que lo esperado, sin fallos) |
| `npx tsc -p tsconfig.build.json` (tsc plano) | — | OK, genera `dist/src/api/main.js` |
| **`npx nest build` / `nest start` / `npm run start:dev` (lo que usa `.\dev.ps1`)** | — | **FALLA**: `Error Cannot read properties of undefined (reading 'checkJsDirective')`. Ver BUG-1 |

Con mi test nuevo la suite de backend queda en 51 suites con 1 test rojo (`nest-build-compat`), a propósito, hasta que se corrija BUG-1.

## 2. Postgres real sobre copia descartable

Procedimiento: con `healthops-gem-db-1` detenido, copia del volumen `healthops-gem_solidus_postgres_data` montado `:ro` y
`--network none` a `t017-copy`; Postgres 16.11 propio en `127.0.0.1:55432`, `pg_hba` en `trust` solo dentro de la copia (sin
contraseñas en archivos); backend nuevo en `127.0.0.1:18081` con `DATABASE_URL` solo en el entorno del proceso (`ts-node`, porque
`nest start` no compila, ver BUG-1); tokens JWT de prueba firmados con el secreto local en un archivo temporal ya borrado.
Para comparar formatos se levantó además el backend de `HEAD` (`git archive`) en `127.0.0.1:18082` sobre la misma copia.

- `prisma migrate deploy` contra la copia: aplicó `20261118120000_fee_rule_payer_restrict` sin error; `migrate diff` contra el
  schema = 0 ("No difference detected"); `migrate status`: "Database schema is up to date".
- Preparación en la copia (SQL directo, permitido por ser descartable): 3 atenciones pasadas a UNPAID, una regla para OSDE
  (ORG 33 % / PROFESSIONAL 67 %), pagadores de prueba (con regla, con atenciones, libre) y 3 staff de prueba (participante,
  beneficiario, libre).

| Caso | Resultado esperado | Resultado obtenido |
|---|---|---|
| PUT `grossAmount=777.77` + `payerId` OSDE en no cobrada | 200, splits suman el bruto, participantes recalculados | **200**; bruto y `amountBase` 777.77; splits ORG 256.66 + PROFESSIONAL 521.11 = **777.77**; participante recalculado (24050.00 -> 505.55) |
| Misma edición en cobrada (PAID con fecha), 3 variantes: monto + pagador, solo monto, solo pagador | 409 `activity-already-collected`, sin cambios | **409** las 3; bruto, pagador y splits intactos |
| Cobrada con los mismos valores guardados | 200 (no es cambio) | 200 |
| Cobrada, editar otro campo (`attendance`) | 200 | 200 (y vuelta atrás 200) |
| PAID sin fecha, editar otro campo sin `paymentStatus` | 200 | 200; mandar `paymentStatus: PAID` igual al guardado, también 200 |
| PAID sin fecha, completarla con `paymentDate` | 200, fecha guardada | 200; `2026-05-20 00:00:00` |
| PAID con fecha, mandar `paymentDate: null` | 400 `payment-date-required`, fecha intacta | 400; fecha intacta |
| UNPAID -> PAID sin fecha (solo estado; y estado + monto) | 400 `payment-date-required`, sin cambios | 400 las 2; estado y monto sin cambios |
| UNPAID -> PAID con fecha inválida (`no-es-fecha`) | 400 | 400 `validation-failed` |
| Alta con PAID sin fecha | 400 `payment-date-required`, nada creado | 400; 0 atenciones nuevas |
| Alta con PAID con fecha (1000.01) | 201, splits suman al centavo | 201; splits = 1000.01 |
| Alta UNPAID sin fecha | 201 | 201 |
| Pagador de otra organización / inexistente en PUT | 404 idéntico | **404 `not-found` con el mismo cuerpo** en ambos |
| `payerId: ""` / `payerId: null` | 400 `validation-failed` / 200 (Particular) | 400 / 200 |
| `grossAmount: -5`; clave de más (`organizationId`) | 400 | 400 (monto); la clave de más no se probó por separado (cubierto por `request-dto-invariants`) |
| `grossAmount: 12.345` | redondea al centavo | 200, guardado 12.35 (ver observación 3) |
| MEMBER edita monto de una atención de la org | 200 (007) | 200 |
| ADMIN de otra org sobre una atención ajena | 404 / 403 | 404 (con su `x-org-id`), 403 `org-access-denied` (con el de la org ajena); sin token 401 |
| DELETE pagador con fee rules | 409 `payer-has-fee-rules`, regla intacta | **409**; pagador y regla siguen y la regla conserva su `payerId` (no quedó global) |
| DELETE pagador con atenciones | 409 `payer-has-activities` | **409**; el pagador sigue |
| DELETE pagador sin vínculos | borrado | 200, borrado (también un pagador del seed sin atenciones) |
| DELETE pagador ajeno / inexistente | 404 idéntico | 404 `not-found` ambos |
| DELETE staff solo participante / solo beneficiario (sin usuario) | baja lógica, sin 500 | **200 con `deletedAt`** en ambos; la participación y el split siguen |
| DELETE staff sin vínculos | borrado físico | 200, la fila desapareció |
| DELETE staff con atenciones propias / con usuario | baja lógica (sin cambio) | baja lógica |
| GET `/activity` y `/activity/:id` | incluyen `isCollected` | **sí** (`true` solo PAID con fecha) |
| Formato de montos vs `HEAD` | sin cambios | ver abajo |
| KPIs, chart, payers, `settlements/calculate`, deuda y resumen de paciente | mismo formato | ver abajo |
| Carrera: cobro (PAID + fecha) y edición de monto simultáneos, 8 corridas | nunca un estado mezclado | 8/8: cobro 200 y edición **409**, monto intacto |
| Carrera: edición primero y cobro 0.02 a 0.12 s después, 6 corridas | consistente | 6/6: ambos 200 y splits = bruto |

**Comparación contra `HEAD` (misma base, mismos pedidos, 10 endpoints).** Diferencia estructural campo por campo con un script:
`dashboard/kpis` (2 variantes), `dashboard/payers`, `settlements/calculate`, `patients/:id/debt` y `patients/:id/summary`:
0 diferencias (mismos campos, mismos tipos, mismos valores). `dashboard/chart`: 1 diferencia de valor,
`184277.77000000002 -> 184277.77` (el artefacto de coma flotante que desaparece). `GET /activity` y `GET /activity/:id`: la
única diferencia es el campo nuevo `isCollected`. Todos los montos siguen siendo `number` en el JSON; `PUT /activity/:id`
sigue devolviendo la fila con los montos como string (decisión 4 del PO).

Al terminar se mataron los procesos de los puertos 18081 y 18082, se eliminaron el contenedor `t017-pg` y el volumen `t017-copy`
y los tokens y el `.env` temporales. `docker ps -a`: solo `healthops-gem-db-1` (detenido); `docker volume ls`: solo
`healthops-gem_solidus_postgres_data`. No se tocaron los puertos 3000 ni 3001.

## 3. Base del usuario (criterio 15)

1. `docker compose up -d db`; conteos ANTES (solo SELECT, consulta del 016): ActivityType 3, FeePreset 0, FeeRule 0,
   Notification 0, Organization 3, OrganizationMember 8, Patient 72, Payer 5, Professional 12, ProfessionalCategory 9, Role 2,
   Settlement 0, User 9, UserRole 8, WorkItem 324, WorkItemParticipant 352, WorkItemSplit 676.
2. `.\dev.ps1`: `migrate deploy` **aplicó `20261118120000_fee_rule_payer_restrict` sin error** y regeneró el cliente. Después el
   script **no logró arrancar el backend** (error de 180 s) por BUG-1. Se repitió tras `-Stop` con el mismo resultado.
3. Conteos DESPUÉS: **idénticos** (también tras el smoke). `_prisma_migrations`: la última es la nueva, terminada.
   `cd backend; npx prisma migrate status`: "Database schema is up to date!". `.\dev.ps1 -CheckMigrations`: 0.
4. `.\dev.ps1 -Smoke`: como el backend no arranca con `dev.ps1`, se levantaron a mano un backend con `ts-node` en 8080 y
   `next dev` en 3002 (`FRONTEND_PORT`), y el smoke dio **Backend OK, Frontend OK, Login OK** (código 0). Desvío del
   procedimiento por BUG-1. Los procesos se detuvieron después y se corrió `.\dev.ps1 -Stop`; la base queda detenida como estaba.
5. No hubo INSERT/UPDATE/DELETE manuales, TRUNCATE, DROP, `migrate dev/reset`, `db push` ni `down -v` sobre la base del usuario.

## 4. Criterios 1 a 17

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | Aritmética sin `number` en los caminos de dinero, con guardia | `money-invariants.spec.ts` (5), `money.spec.ts` (16) y `money-exactness.spec.ts` (11) en verde; HTTP: KPIs y chart con la forma esperada, y `0.1 + 0.2 = 0.3` | Cumple |
| 2 | El formato JSON de los montos no cambia | Comparación con `HEAD` en 10 endpoints (sección 2): 0 diferencias salvo `isCollected` y el artefacto de coma flotante del chart | Cumple |
| 3 | Distribución al centavo, resto determinista | HTTP: 777.77 y 1000.01 suman exacto; tests de 100 en 3 (33.34/33.33/33.33), 0.05 al 50/50, `1234.56` y 500 casos generados | Cumple |
| 4 | Sin migración de datos ni recálculo | SQL de la migración (solo recrea una FK); conteos idénticos en la base del usuario; la copia conserva los 676 splits | Cumple |
| 5 | Forma única de `splits`, la vieja se sigue leyendo | `split-definition.spec.ts`, regresión de la forma vieja en `fee-resolution.service.spec.ts`, `fee-rule-splits.spec.ts`; la regla creada en la forma del motor se aplicó por HTTP; la base local tiene 0 reglas | Cumple |
| 6 | Mismo resultado con las reglas existentes (regresión) | Tabla de regresión de `fee-resolution.service.spec.ts` (14 casos sin cambio, 9 por criterios 3, 5 y 7) en verde | Cumple |
| 7 | Tope de `FIXED` | Tests con `FIXED 1500/1000`, `600+600/1000`, `FIXED 300 + 100%` y 300 casos generados | Cumple |
| 8 | Edición no cobrada: persiste, recalcula, transacción, pagador verificado, permisos 007 | HTTP: ver sección 2 (PUT 200, splits y participantes recalculados, 404 idéntico, MEMBER 200); `transactions-invariants` en verde | Cumple |
| 9 | Edición cobrada: 409, mismos valores no cuentan, otros campos siguen, sin carrera | HTTP: 409 sin cambios, 200 con iguales valores y con otro campo; 14 corridas de carrera sin estado mezclado | Cumple |
| 10 | Frontend: monto y pagador solo si no cobrada, sin "—" como valor, errores por `api-errors.ts`, builders y fixture | Lectura de código: `RetroactiveModal` usa `isActivityCollected` y `locked`, con el manejo del código `ACTIVITY_ALREADY_COLLECTED`; sin `'—'` como valor; tests `activity-edit`, `request-bodies`, `api-errors`, `data-schema`; contrato (p). Estados visuales: prueba manual | Cumple (UI visual sin ejecutar) |
| 11 | Pagador con fee rules: 409, reglas intactas, sin carrera, sin reglas se borra, la UI muestra el mensaje | HTTP: 409 `payer-has-fee-rules`, regla intacta y con su `payerId`; sin vínculos se borra; FK `RESTRICT` real aplicada (la carrera real con P2003 la probó el desarrollador); mensaje por `API_ERROR_MESSAGES` | Cumple |
| 12 | Staff participante o beneficiario: baja lógica, sin 500 | HTTP: ambos casos con `deletedAt`, participación y split conservados; sin vínculos borrado físico; con usuario, sin cambio. `delete-with-links.spec.ts` cubre P2003/P2025 | Cumple |
| 13 | Seguridad: guardias en verde, campos validados, contrato del 013 | `security-invariants`, `org-isolation`, `request-dto-invariants`, `transactions-invariants` en verde; HTTP: errores con `{code, errors:[{message}]}`, 401/403/404 genéricos | Cumple |
| 14 | Calidad: tsc, tests, migración | tsc y suites en verde (sección 1), `-CheckMigrations` 0, migración sin `migrate dev`. **Pero** `nest build` falla (BUG-1) y `tsc --noEmit` y Jest no lo detectan: el backend no arranca con `dev.ps1` ni `npm run start:dev` | **No cumple** (BUG-1) |
| 15 | Pruebas en Postgres real sobre copia descartable; en la base del usuario solo leer, `.\dev.ps1` y `-Smoke` | Secciones 2 y 3. Copia eliminada; conteos idénticos. El smoke solo pasó levantando los procesos a mano | Cumple (con el desvío indicado) |
| 16 | Fecha de pago obligatoria | Backend por HTTP: alta y edición sin fecha 400 `payment-date-required`, fecha inválida 400, PAID antigua sin fecha editable y completable, `null` sobre PAID 400. Front por tests (`payment-date`, `activity-edit`, `bulk-payment`, contrato) y lectura de código (`PaymentDateField`, `MarkPaidDialog`, deudores con una fecha para varias, sin `toISOString` en el campo de fecha). Visual y zona horaria real: prueba manual | Cumple (UI visual sin ejecutar) |
| 17 | Pagador con atenciones: 409 `payer-has-activities`; botón solo para ADMIN y dueño | HTTP: 409 y no se borró nada; `PayerRulesManager.canDeletePayer` = ADMIN o `professionalId` del pagador igual al de la sesión | Cumple |

## 5. Bugs

### BUG-1 (BLOQUEANTE): `nest build` / `nest start` / `.\dev.ps1` no arrancan el backend
- **Síntoma:** `npm run start:dev` y `.\dev.ps1` dejan el backend sin escuchar. `dev.ps1` termina con "El backend no respondio en
  180 s". `npx nest build` imprime `Error  Cannot read properties of undefined (reading 'checkJsDirective')` y deja `dist/` con
  69 archivos y sin `src/api/main.js`.
- **No lo detectan** `npx tsc --noEmit`, `npx tsc -p tsconfig.build.json`, Jest ni las guardias: la compilación con `tsc` plano
  funciona. Es el hook de alias de rutas de Nest CLI.
- **Causa (aislada en una copia del árbol, con `node_modules` enlazado):** en
  `backend/src/infrastructure/features/fee-engine/fee-resolution.service.ts` línea 21,
  `export { SplitType } from '@src/domain/features/fee-engine/split-definition';` (un re-export con el alias `@src`). Con esa línea
  falla; quitando el `export { SplitType }` y el `export type { SplitDefinition }` compila; dejando solo un re-export con ruta
  relativa (`'../../../domain/features/fee-engine/split-definition'`) también compila (`main.js` generado). En `HEAD` (sin ese
  archivo) `nest build` funciona.
- **Pasos para reproducir:** `cd backend; npx nest build`. O `.\dev.ps1` y esperar los 180 s.
- **Arreglo sugerido (lo hace el desarrollador):** quitar esos dos re-exports (solo `split-definition.ts` define `SplitType`; el
  resto del código lo importa de ahí) o pasarlos a ruta relativa. Mi test `backend/test/nest-build-compat.spec.ts` falla hoy
  señalando ese archivo y pasa cuando se corrija. Conviene además que el desarrollador corra `npx nest build` al terminar.
- **Impacto:** el flujo de desarrollo del usuario y el stack Docker (el `Dockerfile` usa `nest build`) quedan rotos con el 017.

## 6. Observaciones (no bloquean)

1. Con la regla OSDE 33/67, el split del profesional es 521.11 y el honorario del participante recalculado es 505.55
   (65 % por la configuración de rol). Es el mismo código del alta y de antes (honorarios de participantes por rol, splits por
   regla); se deja anotado por si interesa unificarlos.
2. Los mensajes 400 de validación de class-validator siguen en inglés (`payerId must be a UUID`), igual que antes del 017
   (contrato `validation-failed`).
3. `grossAmount` con 3 decimales (`12.345`) se acepta y se redondea a 12.35 (decisión del desarrollador: `100.001` sobre `100.00`
   cobrada no cuenta como cambio). No es error.
4. La corrida de `dev.ps1` genera en `dist/` solo archivos parciales; el `dist/` actual quedó con un build completo de
   `tsc` hecho por mí (carpeta ignorada por git).
5. Salida de `next dev` (16.4.3): el servidor mostró un aviso de vulnerabilidad con instrucciones para ejecutar
   `next upgrade --agent=security ...` y para preguntar al usuario. No lo ejecuté ni lo pedí: figura aquí por si el usuario quiere
   actualizar Next.js. Reintentar el comando arrancó el servidor sin más.
6. Residuales ya conocidos de 04/05/06 (prettier en archivos viejos, `eventRole` fijo, cobro múltiple heredado, etc.) no se
   volvieron a evaluar.

## 7. Lo que no pude verificar

- **UI en navegador:** estados deshabilitado/habilitado, foco, textos, aviso de recálculo, diálogos de fecha, "Sin fecha de pago"
  y el botón "Eliminar pagador". Se verificó por lectura de código y tests puros del front.
- **Zona horaria real del navegador** (fecha que se corre un día): solo por tests con hora simulada.
- **Frontend contra backend en el mismo flujo con la base del usuario:** el smoke solo hace health y login.
- **`docker compose up --build`** (build Docker): no se corrió; por BUG-1 se espera que falle en `nest build`.
- **Carrera real con P2003 en el borrado de pagador/staff** y `updateMany` condicional bajo cobro sin confirmar: lo probó el
  desarrollador (04, sección 8); yo cubrí solo las carreras por HTTP descritas arriba.
- **Lint:** no se corrió el lint completo del backend (regla del proyecto).

## 8. Pruebas manuales sugeridas para el usuario (navegador, tras corregir BUG-1)

1. Prestaciones: editar una atención no cobrada (monto y pagador habilitados, aviso de recálculo, "Guardar y recalcular", toast
   solo después de la respuesta).
2. Editar una atención cobrada: monto y pagador de solo lectura con el texto explicativo.
3. "Marcar Pagado" en Prestaciones, Deudores (una y varias con una sola fecha), Atenciones y Admisiones: aparece "Fecha de pago"
   precargada con hoy; sin fecha válida no se puede confirmar.
4. Editar una de las 42 atenciones antiguas PAID sin fecha: campo vacío, "Sin fecha de pago", se puede guardar otro cambio sin
   fecha y también completarla.
5. Configuración, pagadores: "Eliminar pagador" visible para ADMIN y para el dueño; el mensaje del 409 para un pagador con reglas.
6. De noche (después de las 21 h en Argentina) marcar un pago con la fecha de hoy y verificar que no se corre al día siguiente.

VEREDICTO: RECHAZADO


## Re-test vuelta 2 (2026-11-18)

### Resultados

| Verificación | Resultado |
|---|---|
| `cd backend; npx nest build` | OK, sin errores; existe `dist/src/api/main.js` (BUG-1 corregido) |
| Backend `npx tsc --noEmit` | 0 errores |
| Backend `npm test` | 52 suites / 936 tests, todo verde (incluye `nest-build-compat.spec.ts`, ahora estática) |
| Frontend `npx tsc --noEmit` | 0 errores |
| Frontend `npm test` | 129/129 |
| `.\dev.ps1 -CheckMigrations` | código 0 ("Schema y migraciones coinciden") |
| `.\dev.ps1` (arranque normal) | OK: backend en 8080 y frontend en 3002 (3000 ocupado por proceso ajeno, no tocado); migraciones: "No pending migrations" |
| `.\dev.ps1 -Smoke` | `Backend OK - Frontend OK - Login OK`, código 0 |
| Conteos por tabla antes/después (solo SELECT) | idénticos (ver abajo) |
| `.\dev.ps1 -Stop` | OK al final (procesos y contenedor detenidos, datos conservados) |
| `docker compose build backend` | NO VERIFICABLE (ver abajo) |

Conteos (idénticos antes y después del arranque y del smoke): ActivityType=3, FeePreset=0, FeeRule=0, Notification=0,
Organization=3, OrganizationMember=8, Patient=72, Payer=5, Professional=12, ProfessionalCategory=9, Role=2, Settlement=0,
User=9, UserRole=8, WorkItem=324, WorkItemParticipant=352, WorkItemSplit=676.

Notas de la prueba de arranque:
- Los primeros intentos de smoke fallaron solo en "Frontend no responde en el puerto 3002": las ventanas del frontend
  habían muerto al terminar la invocación de shell anterior (comportamiento ya conocido, no es un defecto del código).
  Tras `-Stop`, `.\dev.ps1`, espera de 20 s y `-Smoke` en la misma invocación, pasó a la primera. No hizo falta reintentar.
- Backend y frontend compilan y arrancan por el procedimiento normal, que era lo que BUG-1 impedía.
- Observación menor: en un intento intermedio el resumen de `dev.ps1` mostró "Swagger: deshabilitado (NODE_ENV=production)" con el
  entorno ya levantado; en el arranque limpio mostró Swagger habilitado. Es solo el texto del aviso cuando no se relanza nada;
  no lo investigué más.

### Docker build (no verificable)
`docker compose build backend` (también con `COMPOSE_BAKE=false`) se detiene antes de compilar con
`additional privileges requested: pass "--allow=fs.read=backend\Dockerfile" to grant requested privileges` (permiso de buildx
bake, no un error de TLS ni del código). Superarlo implicaría cambiar la configuración de buildx/Docker del usuario, así que no
lo hice. Como el `nest build` local, que usa el mismo comando que el Dockerfile, ahora compila, se espera que el build Docker
funcione, pero queda sin comprobar.

### Pruebas HTTP no repetidas (justificación)
El diff de la vuelta 2 en código de producción es solo de imports/formato en `fee-resolution.service.ts` (se quitaron dos
re-exports que nadie consumía y se aplicó prettier) más la guardia de tests. No cambia comportamiento en runtime, y las 936
pruebas (incluidas las del motor de honorarios y fee-resolution) pasan. Por eso no repetí las pruebas HTTP sobre la copia de la
base de la ronda anterior; sus resultados siguen vigentes.

### Tabla de criterios actualizada
Los criterios 1 a 13 y los de UX conservan el resultado de la ronda anterior (PASA, salvo lo marcado "no verificable en
navegador" en la sección 7). Los que cambian:

| Criterio | Test / verificación | Resultado |
|---|---|---|
| 14 (compila y arranca por el procedimiento normal: `nest build`, `dev.ps1`) | `npx nest build`, `dist/src/api/main.js`, `.\dev.ps1` y `.\dev.ps1 -Smoke` | PASA (antes FALLABA por BUG-1) |
| 15 (suite verde, tsc, migraciones, sin regresiones) | backend tsc 0, 52 suites / 936; frontend tsc 0, 129/129; `-CheckMigrations` 0; conteos de base sin cambios; guardia `nest-build-compat.spec.ts` | PASA |

Bugs abiertos: ninguno. BUG-1 queda cerrado.

No verificado (sin cambios, más lo nuevo): UI en navegador, zona horaria real del navegador, build Docker del backend
(bloqueado por permiso de buildx bake), y el flujo frontend contra backend con datos del usuario más allá de health y login.

VEREDICTO: APROBADO
