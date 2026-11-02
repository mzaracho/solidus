# 008 — Arreglo de la pantalla `work-items` ("No results") y "Eliminar" según el rol

## Contexto
- **Bug O-3 del tester del 005.** `frontend/src/app/(dashboard)/[orgSlug]/work-items/page.tsx` le pasa a
  `WorkloadTable` el objeto que devuelve `getWorkItems`, `{ items, total, ... }`, en lugar del arreglo. La tabla
  muestra "No results" aunque la API devuelve 324 atenciones. El error ya estaba antes del 005.
- **Campos desalineados.** Además del objeto, los campos no coinciden. `workload/columns.tsx` y
  `workload/data-schema.ts` esperan `professionalName`, `payerName`, `serviceType`, `status`, `grossAmount` y
  `netAmount` (con varios respaldos). La API de `GET /activity` devuelve otra forma; `AtencionesTable` ya la mapea.
- **La página es la única Server Component** que llama a la API con el token de la cookie (`withServerSession`),
  así que se usa para verificar la sesión del lado del servidor (005). No tiene enlace en el menú.
- **"Nuevo Item"** de `WorkloadTable` no hace nada.
- **BACKLOG #44.** En `workload/columns.tsx`, "Eliminar" se muestra igual a todos los roles. La política del 007
  (decisión 1b) dice que el `MEMBER` solo borra lo propio; el backend responde 403 y la UI ya muestra el error.

## Historia de usuario
Como usuario de una organización, quiero que la pantalla de carga de trabajo muestre las atenciones reales con
sus datos correctos, y que no me ofrezca acciones que no puedo hacer.

## Criterios de aceptación
1. **La tabla muestra datos.** `/[orgSlug]/work-items` muestra las atenciones de la organización que devuelve la
   API, no "No results", con un usuario con acceso.
2. **Columnas correctas.** Cada columna muestra el dato que corresponde: fecha, profesional, paciente, práctica
   o tipo, pagador, estado de pago, monto total y neto del profesional. Se mapea desde la respuesta real de
   `GET /activity`, siguiendo el mapeo que ya usa `AtencionesTable` cuando aplique. Si un dato no viene en la
   API (por ejemplo, el neto del profesional), se muestra "—" o se deriva de los splits que sí vienen, y se
   documenta. No hay que agregar campos al backend.
3. **Estado y colores.** El badge y el color de fila usan `PAYMENT_STATUS` de `src/lib/constants.ts`, no
   literales `'Paid'` ni `'Rejected'`.
4. **Paginación.** Se muestra la primera página (20 ítems, como hoy) y el total que devuelve la API. Paginar en
   el servidor es opcional; si se agrega, que sea con `searchParams` y sin romper la sesión del servidor.
5. **"Nuevo Item".** Se oculta, porque hoy no hace nada y la carga se hace desde Admisiones o Atenciones. No se
   implementa un alta nueva.
6. **"Eliminar" según el rol (#44).** Mismo criterio que `AdmisionesTable` en el 007:
   - para un `MEMBER`, "Eliminar" queda deshabilitado, con tooltip, en las atenciones que no puede borrar;
   - puede borrar las propias (`createdByUserId = sub`);
   - si `createdByUserId` es null, solo si es dueño del `Professional`;
   - el `ADMIN` no tiene restricción;
   - se reutiliza la lógica del 007; si es posible, se extrae a una función compartida (por ejemplo, en
     `src/lib`) con un test de `node --test`;
   - el backend sigue siendo la autoridad.
7. **Sin regresiones:**
   - editar, marcar pagado o pendiente y eliminar siguen funcionando con los mensajes de error del 007;
   - `withServerSession` sigue llevando a `/login` sin cookie o con la cookie vencida, y a `/sin-acceso` con una
     organización ajena.
8. **Calidad:**
   - `npx tsc --noEmit` del frontend sin errores;
   - ESLint sin errores nuevos en los archivos tocados;
   - `npm test` del frontend en verde;
   - `npm run build` OK.
9. **Verificación (tester):**
   - en modo desarrollo, con una cookie válida de un `ADMIN`, la página devuelve 200 y el HTML del servidor
     contiene filas con datos (sin imprimir datos personales: solo contar filas o verificar que no aparece
     "No results");
   - con un `MEMBER`, 200;
   - `-Smoke` OK y los conteos de la base sin cambios.

## Fuera de alcance
- Agregar la página al menú o rediseñarla.
- Un alta de atención desde esta pantalla.
- Cambios en el backend.

## Riesgos
- **La forma de la API:** el desarrollador la toma del código del backend y de `AtencionesTable`, sin llamar a
  la API real con datos.
- **`RetroactiveModal`:** espera la forma vieja de `WorkItem`. Hay que adaptarla para que editar siga
  funcionando.

## Pasos del flujo
- Requiere UX/UI: **no**. Es un arreglo de una pantalla existente; ocultar "Nuevo Item" y deshabilitar
  "Eliminar" sigue el patrón del 007.
- Requiere seguridad: **no**. El cambio es de presentación en el frontend, sin endpoints nuevos ni cambios en la
  autorización, que sigue en el backend (verificada en el 007).
- Arquitecto: **omitido**. El cambio es chico y la spec fija el enfoque.
- Documentador: **sí, acotado**: BACKLOG (#44 resuelto) y nota del bug O-3.
- Cambios de schema: no.
- Commit y push: autorizados por el usuario al aprobarse (sin force).

## Salvaguardas vigentes
- Sin seeds ni SQL de escritura; sin `down -v`, `prune` ni borrar volúmenes; sin stash, reset ni checkout.
- No tocar el puerto 3000 (coach-claudio) ni el 3001 (otro proyecto del usuario).
- No imprimir valores del `.env` ni datos personales.
