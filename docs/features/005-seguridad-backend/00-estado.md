# Estado del feature 005 (traspaso entre sesiones)

Última actualización: 2026-11-02, por el PO. **Feature cerrado (09-cierre.md), commit `314fe63` pusheado a `main`.**

## Etapas
| Etapa | Archivo | Estado |
|---|---|---|
| Spec | 01-spec.md | Lista (con los ajustes aceptados abajo) |
| UX/UI | 02-ux.md | APROBADO |
| Arquitecto | 03-diseno-tecnico.md | APROBADO |
| Desarrollador | 04-implementacion.md | Completo (13 de 13 pasos) |
| Revisor | 05-revision.md | APROBADO |
| Seguridad | 06-seguridad.md | APROBADO |
| Tester | 07-testing.md | APROBADO |
| Documentador | 08-documentacion.md | Completo |
| Cierre | 09-cierre.md | Escrito |

Vueltas de corrección usadas: 0 de 3.

## Después del cierre
- Commit `314fe63` en `main`, pusheado sin force. Quedaron fuera los archivos que solo cambiaron de fin de
  línea, `.claude/settings.json`, `.vscode/` y `frontend/AGENTS.md`.
- Pendientes: ver 09-cierre ("Pendiente"). El orden de los features siguientes está en
  `docs/features/PLAN-pendientes.md`.

## Decisiones del PO sobre el diseño (2026-10-29)
El PO acepta las 6 aclaraciones del arquitecto (03, final). Prevalecen sobre la letra de la spec:
1. **No existe el slug.** La base no tiene esa columna y el segmento de la URL ya es el UUID de la
   organización. Un valor que no sea UUID responde 403. Así se lee el criterio 7.
2. **Orígenes de Docker.** Los de 3001 van en `docker-compose.yml`. `backend/.env` solo se usa en modo
   desarrollo (criterio 13).
3. **Rol en `OrgRoleGuard`.** Se toma de la base para la organización pedida, no del `orgRole` del
   token. Es más seguro (criterio 5).
4. **Organización obligatoria por defecto.** Rige en todas las rutas autenticadas, salvo las marcadas
   `@OrgOptional` (`logout` y `pro/memberships`). Endurece el criterio 7.
5. **Ruta de salud.** La ruta pública extra es `GET /health/liveness`, que reemplaza a `/` en `-Smoke`
   y en las esperas de `dev.ps1`. Swagger pasa a `/docs` y no se monta en producción (criterio 3).
6. **`CORS_EXTRA_ORIGINS`.** Variable opcional que nunca acepta `*` ni comodines.

Además se acepta:
- `axios` 1.20.0, en lugar de la 1.21.0 recién publicada;
- `next` y `eslint-config-next` en 16.4.3 exactos;
- invalidar las sesiones vigentes, porque cambian `issuer` y `audience`.

## Decisiones del usuario
- **Alcance 004 + 005 (2026-10-27):** el 005 cubre BACKLOG 7, 9, 1 y 8. El PO sumó lo mínimo de
  BACKLOG 2 (pertenencia a la organización) y de BACKLOG 11 (400 en el login).
- **Después del 005:** features nuevas de a una.
- **Commit y push:** autorizados al aprobarse, sin force.
- **coach-claudio (pm2, puerto 3000):** no se toca; `FRONTEND_PORT=3002`.
- **2026-11-02:** el usuario pidió relanzar al desarrollador para continuar.
- **2026-11-02:** el usuario pidió hacer todos los pendientes de a uno, con commit y push al terminar cada
  uno (ver `docs/features/PLAN-pendientes.md`).

## Pendientes de otros features
- **Acción del usuario:** activar push protection o secret scanning en GitHub.
- **Posible feature futura:** `User.cuit` está en el schema y no tiene migración.

## Línea base de datos
9 / 3 / 72 / 324 / 1483 (User, Organization, Patient, WorkItem y total de `public`, sin `_prisma_migrations`).
