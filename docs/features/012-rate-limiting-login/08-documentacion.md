# 012 — Rate limiting del login: documentación

## Qué cambió en el código (base de lo documentado)
Fuentes: `04-implementacion.md` (con vuelta 1), `05-revision.md`, `06-seguridad.md`, `07-testing.md`.
- Límites en memoria con ventana fija: 5 intentos por IP + usuario y 20 por IP en 900 s; 429 `too-many-requests` con
  `Retry-After`; variables opcionales `LOGIN_RATE_LIMIT_IP`, `LOGIN_RATE_LIMIT_USER` y `LOGIN_RATE_LIMIT_WINDOW`.
- IPv6 agrupada por /64, tope de 10.000 claves sin desalojar entradas vivas, warning al arrancar si USER > IP.
- `Retry-After` expuesto por CORS; el frontend muestra el mensaje y los minutos.
- Suite backend: 35 suites / 616 tests.

## Archivos modificados
- `docs/auditoria/COMANDOS.md`: nueva sección "Rate limiting del login (feature 012)" (variables, defaults, rangos,
  formato, validación al arrancar, warning, `dev.ps1` no las propaga y Docker usa los defaults, 429 y `Retry-After`,
  los logins exitosos también cuentan para el límite por IP, IPv6 por /64, reinicio vacía los contadores); línea de
  `backend/.env` en la sección 3; fila nueva en "Errores comunes"; conteo de Jest a 35 suites / 616 tests.
- `.claude/CLAUDE.md` (solo la guía): una entrada en Comandos sobre las variables; la regla 4 ya no lista el rate
  limiting como pendiente (se remite a sus residuales); Jest a 35 suites.
- `docs/auditoria/BACKLOG.md`: #11 pasa a RESUELTO (features 005 y 012); sección nueva "Candidatos surgidos del feature 012".
- `docs/auditoria/RIESGOS.md` (local, ignorado por git): M-4 del 005 resuelto; sección de residuales del 012.
- `docs/features/012-rate-limiting-login/04-implementacion.md`: nota del documentador que corrige la frase
  "impracticable" sobre superar las 10.000 claves vivas (remite a N-1 de `06-seguridad.md`).
- `docs/features/012-rate-limiting-login/08-documentacion.md`: este archivo.

No se tocaron código, `.env`, `backend/.env` ni `.claude/settings*.json`. No se hizo commit ni push.

## Números nuevos de BACKLOG
- **56**: `trust proxy` e IP real detrás de Docker/NAT/proxy (M-2 de seguridad; relacionado con #19).
- **57**: almacén lleno (N-1 de seguridad): `Logger.warn` limitado, tope configurable o almacén compartido; incluye N1 del
  revisor (IPv6 mapeada en hexadecimal).
- **58**: bajos (borde de ventana fija, sin límite por usuario independiente de la IP, máximos configurables altos).

## Notas
- `README.md` y `docs/` fuera de `auditoria/` no mencionan el login ni sus límites: no se tocaron. No hay CHANGELOG en el repo.
- Los `.env.example` ya traían las variables comentadas (lo hizo el desarrollador); no se modificaron.
