/**
 * Limitador de intentos del login (feature 012). Ventana fija, en memoria del proceso.
 *
 * - Por IP: máximo `ipLimit` intentos por ventana.
 * - Por IP + usuario normalizado: máximo `userLimit` intentos NO exitosos por ventana. El intento se
 *   cuenta al llegar (antes de evaluar la contraseña), así las peticiones concurrentes tampoco lo
 *   saltean; un login exitoso borra el contador de esa combinación.
 *
 * Una sola instancia del backend: con varias instancias cada una tendría su propio contador y habría
 * que pasar a un almacén compartido (fuera de alcance, ver 01-spec.md).
 * No usa timers: la limpieza ocurre al consumir (barrido periódico perezoso y tope de entradas).
 */
export interface LoginRateLimitOptions {
  /** Intentos máximos por IP en la ventana. */
  ipLimit: number;
  /** Intentos fallidos máximos por IP + usuario en la ventana. */
  userLimit: number;
  /** Duración de la ventana en milisegundos. */
  windowMs: number;
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

interface Entry {
  count: number;
  resetAt: number;
}

/** Tope de entradas: acota la memoria aun con muchas IPs distintas. */
export const MAX_RATE_LIMIT_ENTRIES = 10_000;
/** Cada cuánto, como mucho, se barren las entradas vencidas. */
export const SWEEP_INTERVAL_MS = 60_000;
/** Con el almacén lleno, mínimo entre dos barridos completos (evita O(n) por cada intento). */
export const FULL_SWEEP_INTERVAL_MS = 1_000;
/** Retry-After máximo (segundos) cuando se rechaza por almacén lleno. */
const FULL_STORE_RETRY_SECONDS = 60;

/** Pasa un IPv6 textual a sus 8 grupos de 16 bits; null si no es válido. */
function parseIpv6Groups(address: string): number[] | null {
  let text = address.split('%')[0]; // zone id (fe80::1%eth0)
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    text =
      text.slice(0, v4.index) +
      ((o[0] << 8) | o[1]).toString(16) +
      ':' +
      ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const parts = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill('0'),
    ...tail,
  ];
  if (parts.length !== 8) return null;
  const groups = parts.map((g) =>
    /^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN,
  );
  return groups.some(Number.isNaN) ? null : groups;
}

export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>();
  private nextSweepAt = 0;
  private nextFullSweepAt = 0;

  constructor(
    private readonly options: LoginRateLimitOptions,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Email en minúsculas y sin espacios (misma combinación aunque cambie el formato). */
  static normalizeUser(user: string): string {
    return user.trim().toLowerCase();
  }

  /**
   * Clave de IP para los contadores.
   * - IPv4 e IPv4 mapeada (`::ffff:1.2.3.4`): la dirección completa.
   * - IPv6: se agrupa por prefijo /64 (un atacante con un /64 tiene 2^64 direcciones y rotarlas
   *   esquivaría el límite).
   * - IP ausente o ilegible: cubo único `'unknown'`, A PROPÓSITO (falla cerrado): si el socket no
   *   informa dirección, todas esas peticiones comparten contador y se bloquean juntas.
   */
  static normalizeIp(ip: string | undefined | null): string {
    if (!ip) return 'unknown';
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
    if (mapped) return mapped[1];
    if (!ip.includes(':')) return ip;
    const groups = parseIpv6Groups(ip);
    if (!groups) return 'unknown';
    return `${groups
      .slice(0, 4)
      .map((g) => g.toString(16))
      .join(':')}::/64`;
  }

  /**
   * Registra un intento. Si ya se superó algún límite devuelve el rechazo (con los segundos hasta que
   * venza la ventana que bloquea) y NO cuenta el intento.
   */
  consume(ip: string, user: string): RateLimitDecision {
    const now = this.now();
    this.sweepIfDue(now);
    const ipKey = `ip:${LoginRateLimiter.normalizeIp(ip)}`;
    const userKey = `u:${LoginRateLimiter.normalizeIp(ip)}|${LoginRateLimiter.normalizeUser(user)}`;

    const ipEntry = this.live(ipKey, now);
    const userEntry = this.live(userKey, now);
    const blocked: Entry[] = [];
    if (ipEntry && ipEntry.count >= this.options.ipLimit) blocked.push(ipEntry);
    if (userEntry && userEntry.count >= this.options.userLimit) {
      blocked.push(userEntry);
    }
    if (blocked.length > 0) {
      const resetAt = Math.max(...blocked.map((e) => e.resetAt));
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      };
    }

    // Lugar para las claves nuevas ANTES de contar nada. Nunca se desaloja una entrada viva (podría
    // estar bloqueando): si no hay lugar tras barrer las vencidas, se rechaza la clave nueva (fail-closed).
    const needed = (ipEntry ? 0 : 1) + (userEntry ? 0 : 1);
    if (needed > 0 && !this.hasRoom(needed, now)) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.min(
            FULL_STORE_RETRY_SECONDS,
            Math.ceil(this.options.windowMs / 1000),
          ),
        ),
      };
    }

    this.bump(ipKey, ipEntry, now);
    this.bump(userKey, userEntry, now);
    return { allowed: true };
  }

  /** Login exitoso: reinicia el contador de la combinación IP + usuario (el de la IP sigue). */
  recordSuccess(ip: string, user: string): void {
    this.entries.delete(
      `u:${LoginRateLimiter.normalizeIp(ip)}|${LoginRateLimiter.normalizeUser(user)}`,
    );
  }

  /** Vacía el almacén (tests). */
  reset(): void {
    this.entries.clear();
    this.nextSweepAt = 0;
    this.nextFullSweepAt = 0;
  }

  /** Cantidad de entradas guardadas (tests). */
  get size(): number {
    return this.entries.size;
  }

  /** Elimina las entradas vencidas. */
  sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
    this.nextSweepAt = now + SWEEP_INTERVAL_MS;
  }

  private sweepIfDue(now: number): void {
    if (now >= this.nextSweepAt) this.sweep();
  }

  private live(key: string, now: number): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.resetAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** ¿Caben `needed` claves nuevas? Con el almacén lleno barre vencidas, como mucho cada FULL_SWEEP_INTERVAL_MS. */
  private hasRoom(needed: number, now: number): boolean {
    if (this.entries.size + needed <= MAX_RATE_LIMIT_ENTRIES) return true;
    if (now >= this.nextFullSweepAt) {
      this.sweep();
      this.nextFullSweepAt = now + FULL_SWEEP_INTERVAL_MS;
    }
    return this.entries.size + needed <= MAX_RATE_LIMIT_ENTRIES;
  }

  private bump(key: string, entry: Entry | undefined, now: number): void {
    if (entry) {
      entry.count += 1;
      return;
    }
    this.entries.set(key, { count: 1, resetAt: now + this.options.windowMs });
  }
}
