# 07 — Testing: 008-fix-tabla-work-items

> Autor: tester. Fecha: 2026-11-02. No se modificó código de producción. Se agregaron tests (ver 1.2). Sin seeds, sin SQL de escritura,
> sin commit ni push, sin tocar los puertos 3000 y 3001 ni `.env`, `backend/.env` ni `.claude/`. Tokens firmados en memoria con el
> `JWT_SECRET` local (HS256, issuer y audience del 005), sin imprimirlos ni escribirlos. Solo peticiones GET. Scripts en el scratchpad.

## 1. Comandos

| Comando | Resultado |
|---|---|
| `frontend: npx tsc --noEmit` | Sin errores (también tras agregar mis tests) |
| `frontend: npm test` | **24 de 24 en verde** (17 previos + 7 míos) |
| `frontend: npm run build` (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`) | OK; `/[orgSlug]/work-items` figura como ruta dinámica |
| `.\dev.ps1` (desarrollo, puerto 3002, sin Docker del frontend) | OK, migraciones sin pendientes |
| `.\dev.ps1 -Smoke` | `Backend OK - Frontend OK - Login OK` |
| `.\dev.ps1 -Stop` | OK |

ESLint: no lo corrí por mi cuenta; confío en la comparación contra `HEAD` de `04` y `05-revision.md` (sin errores nuevos).

### 1.2 Tests agregados (huecos que marcó el revisor)
- `frontend/src/components/domain/workload/data-schema.test.mts` (+4): `grossAmount`/`netAmount` como string numérico (Decimal serializado);
  montos inválidos o vacíos a null y cero conservado; `date` con hora ISO sin retroceder el día; `status` vacío y PARTIAL/UNPAID.
- `frontend/src/lib/session.test.mts` (+3): `readSessionIdentity` con `document` simulado (sub y professionalId; tipos inválidos o
  sin professionalId; sin cookie, token basura y sin `document`).

## 2. Verificación en vivo (frontend HTTP, puerto 3002)

Usuarios: un ADMIN y un MEMBER de la organización con datos (324 atenciones). Solo leí ids; nada de datos personales impreso.

| Caso | Esperado | Obtenido |
|---|---|---|
| ADMIN `GET /<org>/work-items` | 200, filas, sin "No results" | 200; 21 `<tr>` (1 encabezado + 20 filas); sin "No results"; "Mostrando 20 de 324" (el total coincide con la base) |
| MEMBER, igual | 200 | 200; 21 `<tr>`; sin "No results"; "Mostrando 20 de 324" |
| "Nuevo Item" en el HTML (ADMIN y MEMBER) | ausente | Ausente |
| Literal `Rejected` en el HTML | ausente | Ausente |
| Sin cookie | redirige a `/login` | 307 a `/login` |
| Cookie vencida | redirige a `/login` | 307 a `/login` |
| Organización ajena (ADMIN y MEMBER) | `/sin-acceso` | 307 a `/sin-acceso` |

## 3. Conteos (solo SELECT)

| Momento | User | Organization | Patient | WorkItem | Total `public` (sin `_prisma_migrations`) |
|---|---|---|---|---|---|
| Esperado/antes | 9 | 3 | 72 | 324 | 1483 |
| Después | 9 | 3 | 72 | 324 | 1483 |

Idénticos.

## 4. Criterio por criterio

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | La tabla muestra datos | En vivo: ADMIN y MEMBER, 20 filas en el HTML del servidor, sin "No results" | **Cumple** |
| 2 | Columnas correctas | `data-schema.test.mts` (6 tests: campos, nulos a "—", "Unknown" a "—", montos string, fecha con hora, status). El mapeo contra la API real lo revisó el revisor en el código del backend. Los valores de cada celda en pantalla: lista manual | **Cumple** (tests); valores visuales en manual |
| 3 | PAYMENT_STATUS, sin literales | En vivo: no aparece `Rejected`; el revisor confirmó el uso de `PAYMENT_STATUS`; test de status PAID/PARTIAL/UNPAID | **Cumple** |
| 4 | Paginación: 20 y total de la API | En vivo: "Mostrando 20 de 324" | **Cumple** |
| 5 | "Nuevo Item" oculto | En vivo: ausente en el HTML | **Cumple** |
| 6 | "Eliminar" según el rol | `activity-permissions.test.mts` (ADMIN todo; MEMBER propio/ajeno; autor null con y sin dueño del Professional; sin identidad) y `readSessionIdentity` (3 tests nuevos). El estado deshabilitado depende de la hidratación en el cliente | **Cumple** (lógica); render deshabilitado en manual |
| 7 | Sin regresiones | En vivo: `/login` sin cookie y vencida; `/sin-acceso` con organización ajena. Editar/pagado/pendiente/eliminar: requieren escribir, no ejercidos | **Cumple** (sesión); acciones en manual |
| 8 | Calidad | tsc sin errores; 24 tests verdes; build OK; ESLint por el informe de 04 y 05 | **Cumple** |
| 9 | Verificación del tester | ADMIN 200 con filas, MEMBER 200, `-Smoke` OK, conteos sin cambios | **Cumple** |

## 5. Lo que no pude verificar
- Render de "Eliminar" deshabilitado, tooltip y valores de cada celda: dependen del navegador (hidratación y cookie).
- Editar, marcar pagado/pendiente y eliminar: son escrituras, prohibidas por la salvaguarda. Los mensajes de error del 007 solo por lectura de código.
- Las 324 atenciones tienen `createdByUserId` null (observación O-2 del 007): en datos reales un MEMBER solo borraría las de su propio `Professional`.
- ESLint por mi cuenta.

## 6. Hallazgos
Sin bugs nuevos. Se confirman las observaciones menores del revisor, que no bloquean ningún criterio:
- M1 (preexistente): el modal de edición dice "Actualizado correctamente" pero el backend ignora monto y pagador.
- M2: el pagador "—" podría enviarse como `payerName` desde el modal (hoy el backend lo ignora).
- M3: el `title` del ítem deshabilitado probablemente no se vea (`pointer-events-none`). Verificar en el navegador.
- M4: con `orgRole` aún null, "Eliminar" aparece habilitado hasta hidratar (el backend responde 403).

## 7. Lista de verificación manual (navegador)
Con un ADMIN y un MEMBER de la organización con datos. Escribir solo en datos de prueba.
1. Abrir `/<org>/work-items` (no tiene enlace en el menú: ir por URL). Se ven 20 filas y la descripción "Mostrando 20 de 324 atenciones".
2. Columnas: fecha (el día correcto, no el anterior), profesional, paciente, práctica, pagador ("—" si falta), estado (badge Pagado/Parcial/Pendiente),
   monto total y neto del profesional. Comparar un par de filas con la pantalla de Atenciones.
3. No hay botón "Nuevo Item". Las filas pagadas se ven con el color de fila de pagado.
4. Menú de acciones, como ADMIN: Eliminar habilitado en todas (salvo una cobrada con fecha de pago, que sigue deshabilitada).
5. Como MEMBER: Eliminar deshabilitado en atenciones ajenas (o con autor null sin ser dueño del Professional), con tooltip "Solo podés eliminar tus
   propias atenciones" (verificar si el tooltip aparece: M3). Habilitado en las propias.
6. Marcar pagado y marcar pendiente: toast de éxito y la fila se actualiza (`router.refresh()`).
7. Editar (monto/pagador): abre el modal con los valores actuales; confirmar y notar que el backend no persiste el cambio (M1).
8. Forzar un 403 (MEMBER intenta eliminar una ajena habilitada por la carrera de hidratación) y un 404: se ve el mensaje de error, no el de éxito.
9. Cerrar sesión/vencer la cookie: recargar lleva a `/login`; una organización ajena por URL lleva a `/sin-acceso`.

## 8. Estado del entorno al terminar
- `.\dev.ps1 -Stop` ejecutado: backend y frontend detenidos; contenedores de db y backend detenidos; volumen intacto (sin `down -v`).
- Puertos 3002, 8080 y 5433 sin escuchas (solo conexiones TIME_WAIT). El 3000 y el 3001 no se tocaron.
- `.env`, `backend/.env` y `.claude/` sin modificar. `npm run build` regeneró `frontend/.next` (ignorado por git).
- Archivos de tests tocados: `data-schema.test.mts` y `session.test.mts`. Scripts auxiliares en el scratchpad.

VEREDICTO: APROBADO
