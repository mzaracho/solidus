import { ConfigService } from '@nestjs/config';
import { getLoginRateLimitOptions } from './login-rate-limit-config';

const cfg = (values: Record<string, unknown>) =>
  ({ get: (k: string) => values[k] }) as unknown as ConfigService;

describe('getLoginRateLimitOptions', () => {
  it('usa los valores por defecto si faltan o están vacías', () => {
    const expected = { ipLimit: 20, userLimit: 5, windowMs: 900_000 };
    expect(getLoginRateLimitOptions(cfg({}))).toEqual(expected);
    expect(
      getLoginRateLimitOptions(
        cfg({
          LOGIN_RATE_LIMIT_IP: '',
          LOGIN_RATE_LIMIT_USER: '  ',
          LOGIN_RATE_LIMIT_WINDOW: '',
        }),
      ),
    ).toEqual(expected);
  });

  it('acepta valores válidos (la ventana va en segundos)', () => {
    expect(
      getLoginRateLimitOptions(
        cfg({
          LOGIN_RATE_LIMIT_IP: '50',
          LOGIN_RATE_LIMIT_USER: ' 3 ',
          LOGIN_RATE_LIMIT_WINDOW: '60',
        }),
      ),
    ).toEqual({ ipLimit: 50, userLimit: 3, windowMs: 60_000 });
  });

  it.each([
    ['LOGIN_RATE_LIMIT_IP', '0'],
    ['LOGIN_RATE_LIMIT_IP', '-1'],
    ['LOGIN_RATE_LIMIT_IP', '2.5'],
    ['LOGIN_RATE_LIMIT_IP', 'abc'],
    ['LOGIN_RATE_LIMIT_IP', '5abc'],
    ['LOGIN_RATE_LIMIT_IP', '1e3'],
    ['LOGIN_RATE_LIMIT_IP', '999999999'],
    ['LOGIN_RATE_LIMIT_USER', '0'],
    ['LOGIN_RATE_LIMIT_USER', 'x'],
    ['LOGIN_RATE_LIMIT_WINDOW', '0'],
    ['LOGIN_RATE_LIMIT_WINDOW', '86401'],
    ['LOGIN_RATE_LIMIT_WINDOW', '15m'],
    ['LOGIN_RATE_LIMIT_WINDOW', {}],
  ])(
    '%s=%p impide arrancar con un mensaje claro que no incluye el valor',
    (name, value) => {
      let message = '';
      try {
        getLoginRateLimitOptions(cfg({ [name]: value }));
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain(name);
      if (typeof value === 'string') {
        expect(message).not.toContain(`"${value}"`);
      }
    },
  );

  describe('coherencia entre límites', () => {
    it('avisa si LOGIN_RATE_LIMIT_USER supera a LOGIN_RATE_LIMIT_IP, sin imprimir valores', () => {
      const warn = jest.fn<void, [string]>();
      const opts = getLoginRateLimitOptions(
        cfg({ LOGIN_RATE_LIMIT_IP: '3', LOGIN_RATE_LIMIT_USER: '777' }),
        warn,
      );
      expect(opts.userLimit).toBe(777); // no rechaza el arranque
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = warn.mock.calls[0][0];
      expect(msg).toContain('LOGIN_RATE_LIMIT_USER');
      expect(msg).toContain('LOGIN_RATE_LIMIT_IP');
      expect(msg).not.toContain('777');
    });

    it('no avisa con los defaults ni con USER <= IP', () => {
      const warn = jest.fn<void, [string]>();
      getLoginRateLimitOptions(cfg({}), warn);
      getLoginRateLimitOptions(
        cfg({ LOGIN_RATE_LIMIT_IP: '5', LOGIN_RATE_LIMIT_USER: '5' }),
        warn,
      );
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
