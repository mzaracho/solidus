import { ConfigService } from '@nestjs/config';
import { DEFAULT_LISTEN_HOST, getListenHost } from './listen-config';

const configWith = (value?: unknown) =>
  ({ get: () => value }) as unknown as ConfigService;

describe('getListenHost', () => {
  it('el default es 127.0.0.1 (falla cerrado: sin LISTEN_HOST no se expone en la red)', () => {
    expect(DEFAULT_LISTEN_HOST).toBe('127.0.0.1');
  });

  it.each([undefined, null, '', '   ', 123])(
    'devuelve 127.0.0.1 si LISTEN_HOST es %p',
    (v) => {
      expect(getListenHost(configWith(v))).toBe('127.0.0.1');
    },
  );

  it('devuelve el valor configurado (el contenedor fija 0.0.0.0 de forma explícita)', () => {
    expect(getListenHost(configWith('127.0.0.1'))).toBe('127.0.0.1');
    expect(getListenHost(configWith('0.0.0.0'))).toBe('0.0.0.0');
  });

  it('recorta espacios alrededor del valor', () => {
    expect(getListenHost(configWith(' ::1 '))).toBe('::1');
  });

  it('lee la clave LISTEN_HOST', () => {
    const get = jest.fn().mockReturnValue('127.0.0.1');
    getListenHost({ get } as unknown as ConfigService);
    expect(get).toHaveBeenCalledWith('LISTEN_HOST');
  });
});
