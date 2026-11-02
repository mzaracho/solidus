# 09 — Cierre: 006-usuarios-dados-de-baja

Fecha: 2026-11-02. Autor: PO.

## Resultado
Todas las etapas quedaron aprobadas, sin vueltas de corrección (0 de 3).

| Etapa | Archivo | Veredicto |
|---|---|---|
| UX/UI | — | Omitida: no hay interfaz nueva |
| Arquitecto | — | Omitido: cambio chico, y la spec fija el diseño |
| Desarrollador | 04-implementacion.md | Completo |
| Revisor | 05-revision.md | APROBADO (2 menores) |
| Seguridad | 06-seguridad.md | APROBADO (2 bajos) |
| Tester | 07-testing.md | APROBADO |
| Documentador | 08-documentacion.md | Completo |

## Qué se entregó
- **Login:** un usuario con `deletedAt` sigue el mismo camino que uno inexistente: `bcrypt` contra el hash ficticio y
  el mismo 401 genérico.
- **`AuthenticationGuard`:** después de verificar el token, consulta al usuario por clave primaria
  (`select { id, deletedAt }`), sin caché. Responde 401 si el usuario no existe o está dado de baja. Rige en toda
  ruta no pública, incluidas las `@OrgOptional`.
- **`OrgAccessService`:** las ramas de membresía y de `Professional` exigen además `user.deletedAt = null`.
- **Tests:** en el backend pasan 13 suites y 148 tests.
- **Documentación:** BACKLOG #34 resuelto, RIESGOS (local) actualizado y una frase nueva en la regla 4 de
  `CLAUDE.md`.

## Verificación de los criterios (PO)
| Criterio | Estado |
|---|---|
| 1, 2 | Cumplen (Jest; el login de un usuario inexistente se probó en vivo) |
| 3 | Cumple. En vivo: un token de un UUID inexistente da 401 en `/api/org` y en `pro/memberships`. El caso de baja se probó solo en Jest, porque la base local no tiene usuarios dados de baja |
| 4 | Cumple (Jest) |
| 5 | Cumple: un usuario activo responde 200 y `-Smoke` da OK |
| 6, 7 | Cumplen |
| 8 | Cumple en desarrollo; los conteos no cambiaron |
| 9 | Cumple: sin migración |

## Pendiente
- **B-1 (seguridad):** si la base falla en el guard, se responde 500 en lugar de 401. Falla cerrado. Se trata en
  el 013 (errores sin `details`).
- **B-2:** `details` en el cuerpo de los errores, que ya existía. Va al 013.
- **Menores del revisor:** dos JSDoc de más de 120 caracteres y el test de baja en `login.spec`, que conviene
  pasar a un `describe` propio.

## Pasos omitidos
UX/UI y arquitecto, por lo que indica la spec.
