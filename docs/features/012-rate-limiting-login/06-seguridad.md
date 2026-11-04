# 012 — Rate limiting del login: revisión de seguridad

Alcance: `auth-controller.ts`, `login-rate-limiter.ts`, `login-rate-limit-config.ts`, `cors-config.ts`, frontend (`data.ts`, `LoginForm.tsx`, `session.ts`, `constants.ts`), `.env.example`, tests y docs.
Verificación: `npx tsc --noEmit` backend sin errores; `npx jest` 35 suites / 604 tests en verde. Sin dependencias nuevas (no aplica `npm audit`).

## Resumen
Sin hallazgos críticos ni altos. El diseño es sólido: el conteo es sincrónico y ocurre al llegar (antes de bcrypt y de la base), por lo que las ráfagas concurrentes no lo saltean (Node es monohilo y `consume` no tiene `await`). Los puntos débiles son IPv6, Docker/NAT y la ventana fija, todos de severidad media o menor.

## Hallazgos

### Media

**M-1. IPv6: rotación de direcciones dentro de un /64 esquiva ambos límites.** `auth-controller.ts:49`, `login-rate-limiter.ts:63-64`.
Cada dirección completa tiene sus propios contadores. Un atacante con un /64 (2^64 direcciones) tiene 20 intentos por IP y 5 por usuario por cada dirección: el límite deja de existir. Aplica solo si el backend es alcanzable por IPv6 (por defecto escucha en 127.0.0.1, así que hoy el riesgo es latente).
Recomendación: normalizar IPv6 a prefijo /64 en `normalizeIp` (clave `ip:<prefijo>`), con test. No es obligatorio para aprobar este feature, pero conviene hacerlo antes de exponer el servicio (`BIND_ADDRESS` no loopback o producción) o registrarlo en el BACKLOG.

**M-2. Docker/NAT: todos los clientes comparten una IP, y un solo atacante puede bloquear el login de todos.** `auth-controller.ts:49`.
Con Docker Desktop (y con cualquier NAT o proxy futuro), `socket.remoteAddress` suele ser la IP del gateway del bridge, no la del cliente. Consecuencias:
- 20 peticiones al login agotan el límite por IP de todos los usuarios durante 15 min.
- 5 intentos con el email de la víctima bloquean ese email para todos (la clave IP+usuario es en la práctica solo "usuario").
Tras un proxy sin `trust proxy` pasa lo mismo. Hoy el acceso es solo desde loopback, por eso es media y no alta. La documentación (04) ya anota lo del proxy, pero no el caso Docker.
Recomendación: documentar explícitamente en COMANDOS/RIESGOS que en modo Docker la IP vista es la del gateway; si el servicio se expone, configurar `trust proxy` con la lista exacta de proxies de confianza y leer `req.ip`. Mientras tanto, `LOGIN_RATE_LIMIT_IP` puede subirse.

**M-3. Descarte del más antiguo permite reiniciar contadores propios (y ajenos) llenando el almacén.** `login-rate-limiter.ts:129-136`.
Con 10.000 entradas vivas, `bump` descarta por orden de inserción, sin considerar si la entrada está bloqueando. Con IPv4 único es impracticable (máximo 21 entradas por IP y ventana), pero con rotación IPv6 (M-1) o muchas IPs un atacante crea ~5.000 pares IP/usuario, expulsa los contadores más viejos (incluido su propio contador ya al límite y los de otras IPs) y recupera intentos. Un atacante legítimo ya lo logra rotando IP en IPv6, así que el aporte marginal es menor; con M-1 corregido, queda poco práctico.
Recomendación: al llenarse, preferir descartar entradas con `count` bajo y/o con `resetAt` más cercano, o rechazar con 429 nuevas claves (fail closed) en lugar de borrar contadores activos; mantener el tope como defensa de memoria.

### Baja

**B-1. Ventana fija: ráfaga doble en el borde.** `login-rate-limiter.ts:67-83`.
Se pueden hacer 5 intentos al final de una ventana y 5 al inicio de la siguiente (10 por usuario y 40 por IP en segundos). Efecto limitado: la tasa sostenida sigue siendo 5 cada 15 min por IP+usuario. Aceptable para el alcance; si se quisiera suavizar, ventana deslizante o contador con backoff.

**B-2. Fuerza bruta distribuida por usuario.** No hay límite por usuario independiente de la IP (por spec: "Fuera de alcance: bloqueo de cuenta"). Un atacante con muchas IPs prueba 5 contraseñas por IP y por usuario. Mitigación fuera del feature (captcha/bloqueo de cuenta, 2FA); dejar en BACKLOG.

**B-3. Denegación dirigida detrás de una misma IP.** Un usuario malicioso de la misma NAT (clínica) puede bloquear a un colega con 5 intentos con su email desde esa IP, o agotar el límite por IP (20) para todos. Desde otra IP no afecta a la víctima: la clave es IP+usuario, verificado en `consume`. Riesgo ya aceptado en la spec; las variables permiten subir los límites.

**B-4. Amplificación de CPU con el almacén lleno.** `makeRoom` llama a `sweep()` completo (O(10.000)) en cada inserción cuando está lleno de entradas vivas. Con peticiones desde muchas IPs, cada una cuesta ~10k iteraciones. Impacto bajo; recomendación: no barrer en `makeRoom` si el último barrido fue hace menos de 1 s.

### Informativa

- **I-1. Normalización del usuario.** `trim().toLowerCase()` es más agresivo que el login real (`findUnique({email})` es exacto), así que las variantes de mayúsculas/espacios comparten contador y no hay bypass. Variantes Unicode/homoglifos o `+alias` son otros emails para la base: no autentican como la víctima, y solo sirven para consumir el límite por IP (20). Sin acción; si se quiere, usar `normalize('NFKC')` por coherencia.
- **I-2. Sin enumeración.** El 429 se decide antes de la base y de bcrypt, con cuerpo idéntico exista o no el usuario (test existente = inexistente). `Retry-After` difiere según el límite activo, pero depende solo de los contadores del propio atacante, no revela si el usuario existe.
- **I-3. Reinicio tras éxito.** `recordSuccess` borra solo la clave IP+usuario; el contador de IP sigue. Un atacante con una cuenta propia no puede reiniciar el contador de otra combinación.
- **I-4. IP.** Se usa `req.socket.remoteAddress` sin `X-Forwarded-For` (con test); `::ffff:` normalizado; ausencia da `'unknown'` (todas las sin IP comparten bucket, correcto fail-closed).
- **I-5. Configuración.** Validación estricta (`^\d+$`, rangos, mensaje sin valor). Los máximos (100.000 IP, 10.000 usuario) permiten debilitar el límite por error; son opcionales y solo de operador. Considerar advertir en el log si se superan 100.
- **I-6. Errores.** El 429 incluye `details: JSON.stringify(exception)` por el filtro (`http-filter.ts:16`), igual que el 401; no filtra datos sensibles aquí y lo trata el feature 013.
- **I-7. CORS.** `exposedHeaders: ['Retry-After']` es correcto y mínimo; sin credenciales ni comodines.
- **I-8. Frontend.** Texto en constantes, `Retry-After` validado (`^\d{1,6}$`, 1 a 86400), mensaje sin datos sensibles, ni se guarda ni se loguea nada.
- **I-9. Secretos y datos reales.** Tests y docs usan emails ficticios `*.test` / `example.test` y contraseñas falsas; los `.env.example` solo traen defaults comentados. Sin secretos.
- **I-10. Multi-instancia / reinicio.** Contadores en memoria: un reinicio del proceso los vacía y varias instancias no los comparten. Documentado en código y spec.

## Respuestas a lo pedido
1. Eficacia: conteo al llegar, atómico; ráfagas cubiertas; reinicio por éxito acotado; borde de ventana (B-1); IPv6 (M-1).
2. Enumeración: no hay diferencia observable de cuerpo ni de tiempo (I-2).
3. IP: correcta para conexión directa; agrupar IPv6 por /64 es recomendable pero fuera de lo estrictamente bloqueante (M-1); Docker (M-2).
4. Memoria: tope y barrido correctos; el desalojo es manipulable solo con muchas IPs (M-3).
5. Denegación dirigida: solo afecta IP+usuario del atacante, salvo NAT/Docker (B-3, M-2).
6-9. Ver I-5, I-7, I-8, I-9.

Veredicto de la primera revisión (historial): APROBADO, sin bloqueantes.

---

## Re-revisión (vuelta 1)

Alcance: `login-rate-limiter.ts` (+ spec) y `login-rate-limit-config.ts`. Verificación: `npx tsc --noEmit` sin errores; `npx jest` 35 suites / 616 tests en verde. Sin dependencias nuevas.

### Estado de lo observado
- **M-1 (IPv6 /64): resuelto.** `normalizeIp` agrupa por /64 con parser propio. Revisado: formas comprimidas (`::`, `1::`, `::1`) y expandidas dan la misma clave; ceros a la izquierda y mayúsculas se normalizan (`parseInt`); zone id (`%eth0`) se descarta; IPv4 incrustada se convierte a dos grupos; `::ffff:a.b.c.d` (cualquier capitalización) se trata como IPv4 completa. Casos malformados (`:::`, dos `::`, grupos de 5 dígitos, octeto > 255, conteo de grupos incorrecto) devuelven `null` y por tanto `'unknown'` (cubo compartido, fail-closed). La dirección sale del `socket.remoteAddress` generado por el kernel, no del atacante: no hay forma de formar direcciones válidas del mismo /64 con claves distintas, ni de que una dirección válida caiga en `'unknown'`. Observación menor: la forma mapeada en hexadecimal o `0:0:0:0:0:ffff:a.b.c.d` no pasa por la rama IPv4 y cae en un único cubo `0:0:0:0::/64`; Node informa la forma con puntos, así que no se da en la práctica.
- **M-3 (tope): resuelto en lo pedido.** `consume` calcula las claves nuevas (0 a 2), verifica lugar antes de contar, barre vencidas y, si no hay lugar, rechaza sin desalojar entradas vivas. Las claves ya existentes siguen contando y bloqueando con el almacén lleno (el chequeo de bloqueo va antes que el de lugar). El rechazo por almacén lleno usa el mismo status y cuerpo que el 429 normal; solo el valor de `Retry-After` puede diferir (constante hasta 60 s vs. tiempo restante real), lo cual no revela nada sensible.
- **B-4: resuelto.** El barrido completo con el almacén lleno corre como mucho una vez por segundo.
- **Config:** el warning (USER > IP) nombra solo las dos variables, sin valores; la validación de rangos sigue sin eco de valores.

### Hallazgos nuevos

**N-1 (MENOR, disponibilidad). La consecuencia declarada es más practicable de lo que dice 04.** `login-rate-limiter.ts:135` y 04 (líneas 105-107).
04 afirma que superar las 10.000 claves vivas es "impracticable con IPv4 de conexión real y /64". El cálculo no cierra: cada IP puede crear hasta 21 claves por ventana (1 de IP + hasta 20 de IP+usuario, usando emails distintos dentro de su límite de 20), de modo que unas ~480 IPv4 llenan el almacén durante 15 min. En IPv6 basta un solo /48 (65.536 /64) con un intento por /64. Efecto: logins de IPs nuevas reciben 429 mientras dure el ataque; los clientes con claves ya vivas y las sesiones JWT existentes no se afectan, y no se debilita ningún límite (no hay bypass, solo denegación). Es el compromiso fail-closed pedido y el atacante necesita infraestructura real, por eso no sube de menor; pero hay que corregir la afirmación y dejarlo registrado.
Remediación (no bloqueante): (1) corregir el texto en 04/spec; (2) registrar el rechazo por almacén lleno con un `Logger.warn` limitado en frecuencia y sin IPs ni emails, para detectarlo; (3) BACKLOG: tope configurable o almacén compartido/expiración más agresiva si se expone el servicio a Internet; (4) mantener M-2 (Docker/NAT) documentado, ya que allí todos comparten una IP y el efecto es otro.

### Consecuencia declarada: evaluación
Aceptable para el estado actual (escucha en loopback por defecto, una instancia): el daño es de disponibilidad temporal y no de confidencialidad ni de integridad. Debe revisarse antes de exponer el servicio fuera de loopback.

### Pendientes sin cambio
M-2 (Docker/NAT), B-1, B-2, B-3 permanecen como en la revisión original y no bloquean.

VEREDICTO: APROBADO
