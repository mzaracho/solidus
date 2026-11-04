import {
  FULL_SWEEP_INTERVAL_MS,
  LoginRateLimiter,
  MAX_RATE_LIMIT_ENTRIES,
  SWEEP_INTERVAL_MS,
} from './login-rate-limiter';

const WINDOW = 15 * 60 * 1000;

describe('LoginRateLimiter', () => {
  let t: number;
  let limiter: LoginRateLimiter;
  const make = (ipLimit = 20, userLimit = 5) =>
    new LoginRateLimiter({ ipLimit, userLimit, windowMs: WINDOW }, () => t);

  beforeEach(() => {
    t = 1_000_000;
    limiter = make();
  });

  it('permite 5 intentos por IP+usuario y bloquea el sexto con Retry-After', () => {
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume('1.1.1.1', 'a@x.test').allowed).toBe(true);
    }
    expect(limiter.consume('1.1.1.1', 'a@x.test')).toEqual({
      allowed: false,
      retryAfterSeconds: 900,
    });
    t += 100_000;
    expect(limiter.consume('1.1.1.1', 'a@x.test')).toEqual({
      allowed: false,
      retryAfterSeconds: 800,
    });
  });

  it('otro usuario desde la misma IP sigue permitido hasta el límite por IP (20)', () => {
    for (let i = 0; i < 5; i++) limiter.consume('1.1.1.1', 'a@x.test');
    for (let i = 0; i < 15; i++) {
      expect(limiter.consume('1.1.1.1', `u${i}@x.test`).allowed).toBe(true);
    }
    expect(limiter.consume('1.1.1.1', 'nuevo@x.test').allowed).toBe(false);
  });

  it('otra IP no comparte los contadores', () => {
    for (let i = 0; i < 5; i++) limiter.consume('1.1.1.1', 'a@x.test');
    expect(limiter.consume('2.2.2.2', 'a@x.test').allowed).toBe(true);
  });

  it('normaliza el usuario (mayúsculas y espacios) y la IP mapeada a IPv4', () => {
    for (let i = 0; i < 5; i++) limiter.consume('::ffff:1.1.1.1', ' A@X.test ');
    expect(limiter.consume('1.1.1.1', 'a@x.test').allowed).toBe(false);
  });

  it('un login exitoso reinicia la combinación pero no el contador de la IP', () => {
    for (let i = 0; i < 4; i++) limiter.consume('1.1.1.1', 'a@x.test');
    limiter.recordSuccess('1.1.1.1', 'a@x.test');
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume('1.1.1.1', 'a@x.test').allowed).toBe(true);
    }
    expect(limiter.consume('1.1.1.1', 'a@x.test').allowed).toBe(false);

    // La IP sigue contando: 4 + 5 = 9 intentos con límite 9.
    const ipOnly = make(9, 5);
    for (let i = 0; i < 4; i++) ipOnly.consume('1.1.1.1', 'a@x.test');
    ipOnly.recordSuccess('1.1.1.1', 'a@x.test');
    for (let i = 0; i < 5; i++) ipOnly.consume('1.1.1.1', 'a@x.test');
    expect(ipOnly.consume('1.1.1.1', 'b@x.test').allowed).toBe(false);
  });

  it('un intento rechazado no cuenta ni extiende la ventana', () => {
    for (let i = 0; i < 5; i++) limiter.consume('1.1.1.1', 'a@x.test');
    t += 10 * 60 * 1000;
    expect(limiter.consume('1.1.1.1', 'a@x.test').allowed).toBe(false);
    t += 5 * 60 * 1000;
    expect(limiter.consume('1.1.1.1', 'a@x.test').allowed).toBe(true);
  });

  it('vence la ventana con el reloj simulado', () => {
    for (let i = 0; i < 5; i++) limiter.consume('1.1.1.1', 'a@x.test');
    t += WINDOW - 1;
    expect(limiter.consume('1.1.1.1', 'a@x.test').allowed).toBe(false);
    t += 1;
    expect(limiter.consume('1.1.1.1', 'a@x.test').allowed).toBe(true);
  });

  it('el límite por IP también vence con la ventana', () => {
    const l = make(2, 5);
    l.consume('1.1.1.1', 'a@x.test');
    l.consume('1.1.1.1', 'b@x.test');
    expect(l.consume('1.1.1.1', 'c@x.test').allowed).toBe(false);
    t += WINDOW;
    expect(l.consume('1.1.1.1', 'c@x.test').allowed).toBe(true);
  });

  it('limpia las entradas vencidas (barrido periódico)', () => {
    for (let i = 0; i < 10; i++) limiter.consume(`9.9.9.${i}`, 'a@x.test');
    expect(limiter.size).toBe(20);
    t += WINDOW + SWEEP_INTERVAL_MS;
    limiter.consume('8.8.8.8', 'z@x.test');
    expect(limiter.size).toBe(2);
  });

  it('sweep() elimina solo lo vencido', () => {
    limiter.consume('1.1.1.1', 'a@x.test');
    t += WINDOW / 2;
    limiter.consume('2.2.2.2', 'a@x.test');
    t += WINDOW / 2;
    limiter.sweep();
    expect(limiter.size).toBe(2);
  });

  describe('IP', () => {
    it('IPv6 de un mismo /64 comparte contador (límite por usuario)', () => {
      const base = '2001:db8:1:2';
      const addrs = [
        `${base}::1`,
        `${base}:aaaa:bbbb:cccc:dddd`,
        `${base}:0:0:0:ffff`,
        `2001:0DB8:0001:0002:1234:5678:9abc:def0`,
        `${base}::1%eth0`,
      ];
      for (const a of addrs)
        expect(limiter.consume(a, 'a@x.test').allowed).toBe(true);
      expect(limiter.consume(`${base}:9::9`, 'a@x.test').allowed).toBe(false);
    });

    it('IPv6 de un mismo /64 comparte el límite por IP (rotar direcciones no lo esquiva)', () => {
      const l = make(3, 5);
      for (let i = 1; i <= 3; i++)
        l.consume(`2001:db8:1:2::${i}`, `u${i}@x.test`);
      expect(l.consume('2001:db8:1:2::99', 'otro@x.test').allowed).toBe(false);
    });

    it('dos /64 distintos no comparten contadores', () => {
      for (let i = 0; i < 5; i++)
        limiter.consume('2001:db8:1:2::1', 'a@x.test');
      expect(limiter.consume('2001:db8:1:2::1', 'a@x.test').allowed).toBe(
        false,
      );
      expect(limiter.consume('2001:db8:1:3::1', 'a@x.test').allowed).toBe(true);
      expect(limiter.consume('2001:db8:2:2::1', 'a@x.test').allowed).toBe(true);
    });

    it('IPv4 e IPv4 mapeada siguen por dirección completa', () => {
      expect(LoginRateLimiter.normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
      expect(LoginRateLimiter.normalizeIp('::FFFF:10.0.0.1')).toBe('10.0.0.1');
      for (let i = 0; i < 5; i++) limiter.consume('10.0.0.1', 'a@x.test');
      expect(limiter.consume('10.0.0.2', 'a@x.test').allowed).toBe(true);
    });

    it('normalizeIp de IPv6: forma comprimida y expandida dan la misma clave', () => {
      const key = '2001:db8:0:0::/64';
      expect(LoginRateLimiter.normalizeIp('2001:db8::1')).toBe(key);
      expect(
        LoginRateLimiter.normalizeIp('2001:0db8:0000:0000:0000:0000:0000:0001'),
      ).toBe(key);
      expect(LoginRateLimiter.normalizeIp('::1')).toBe('0:0:0:0::/64');
    });

    it('IP ausente o ilegible: cubo único "unknown" (falla cerrado, a propósito)', () => {
      expect(LoginRateLimiter.normalizeIp(undefined)).toBe('unknown');
      expect(LoginRateLimiter.normalizeIp(null)).toBe('unknown');
      expect(LoginRateLimiter.normalizeIp('')).toBe('unknown');
      expect(LoginRateLimiter.normalizeIp('1:2:3:zz::1')).toBe('unknown');
      const l = make(3, 5);
      expect(l.consume('', 'a@x.test').allowed).toBe(true);
      expect(l.consume('', 'b@x.test').allowed).toBe(true);
      expect(l.consume('', 'c@x.test').allowed).toBe(true);
      expect(l.consume('', 'd@x.test').allowed).toBe(false);
      expect(l.consume('1.1.1.1', 'd@x.test').allowed).toBe(true);
    });
  });

  describe('tope de entradas', () => {
    const fill = (l: LoginRateLimiter, from: number, pairs: number) => {
      for (let i = from; i < from + pairs; i++) {
        l.consume(`10.0.${i >> 8}.${i & 255}`, 'a');
      }
    };
    const PAIRS = MAX_RATE_LIMIT_ENTRIES / 2;

    it('nunca supera el tope y rechaza claves nuevas con 429 cuando está lleno de vivas', () => {
      const big = make(1_000_000, 1_000_000);
      fill(big, 0, PAIRS);
      expect(big.size).toBe(MAX_RATE_LIMIT_ENTRIES);
      const r = big.consume('172.16.0.1', 'nuevo');
      expect(r.allowed).toBe(false);
      expect(r).toMatchObject({ retryAfterSeconds: 60 });
      expect(big.size).toBe(MAX_RATE_LIMIT_ENTRIES);
    });

    it('no desaloja una entrada bloqueante al llenarse', () => {
      const l = make(1_000_000, 2);
      l.consume('1.1.1.1', 'victima');
      l.consume('1.1.1.1', 'victima'); // userLimit alcanzado: bloquea
      expect(l.consume('1.1.1.1', 'victima').allowed).toBe(false);
      fill(l, 0, PAIRS + 100);
      // Aun con el almacén saturado por otros, el bloqueo de la víctima sigue vigente.
      expect(l.consume('1.1.1.1', 'victima').allowed).toBe(false);
      expect(l.size).toBeLessThanOrEqual(MAX_RATE_LIMIT_ENTRIES);
    });

    it('las claves ya existentes siguen funcionando con el almacén lleno', () => {
      const big = make(1_000_000, 1_000_000);
      fill(big, 0, PAIRS);
      expect(big.consume('10.0.0.0', 'a').allowed).toBe(true);
    });

    it('al vencer las entradas vuelve a haber lugar', () => {
      const big = make(1_000_000, 1_000_000);
      fill(big, 0, PAIRS);
      expect(big.consume('172.16.0.1', 'nuevo').allowed).toBe(false);
      t += WINDOW;
      expect(big.consume('172.16.0.1', 'nuevo').allowed).toBe(true);
    });

    it('con el almacén lleno no barre en cada inserción (como mucho cada FULL_SWEEP_INTERVAL_MS)', () => {
      const big = make(1_000_000, 1_000_000);
      fill(big, 0, PAIRS);
      big.consume('172.15.0.1', 'primero'); // primer rechazo: barre una vez
      const sweep = jest.spyOn(big, 'sweep');
      for (let i = 0; i < 50; i++) big.consume(`172.16.0.${i}`, 'nuevo');
      expect(sweep).toHaveBeenCalledTimes(0); // el último barrido fue hace menos de 1 s
      t += FULL_SWEEP_INTERVAL_MS;
      for (let i = 0; i < 50; i++) big.consume(`172.17.0.${i}`, 'nuevo');
      expect(sweep).toHaveBeenCalledTimes(1);
    });
  });

  it('reset() vacía el almacén', () => {
    limiter.consume('1.1.1.1', 'a@x.test');
    limiter.reset();
    expect(limiter.size).toBe(0);
  });
});
