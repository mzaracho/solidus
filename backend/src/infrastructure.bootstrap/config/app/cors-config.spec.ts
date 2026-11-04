/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { buildCorsOptions, parseCorsOrigins } from './cors-config';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

const cfg = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('parseCorsOrigins', () => {
  it('acepta lista con espacios, coma final y duplicados', () => {
    expect(
      parseCorsOrigins(
        ' http://localhost:3002 , http://127.0.0.1:3002,http://localhost:3002, ',
      ),
    ).toEqual(['http://localhost:3002', 'http://127.0.0.1:3002']);
  });

  it('acepta IPv6 entre corchetes y https', () => {
    expect(
      parseCorsOrigins('https://app.example.test,http://[::1]:3000'),
    ).toEqual(['https://app.example.test', 'http://[::1]:3000']);
  });

  it.each(['', undefined, null, ',', ' , '])('%p da lista vacía', (raw) => {
    expect(parseCorsOrigins(raw)).toEqual([]);
  });

  it.each([
    '*',
    'http://localhost:3000/',
    'http://localhost:3000/path',
    'ftp://localhost:3000',
    'localhost:3000',
    'http://*.example.test',
    'http://a b',
    '["http://localhost:3000"]',
  ])('rechaza %p y nombra la entrada', (bad) => {
    expect(() => parseCorsOrigins(`http://localhost:3000,${bad}`)).toThrow(
      /CORS_ORIGIN contiene un origen inválido/,
    );
  });
});

describe('buildCorsOptions', () => {
  it('en producción sin orígenes lanza', () => {
    expect(() => buildCorsOptions(cfg({ NODE_ENV: 'production' }))).toThrow(
      /CORS_ORIGIN es obligatorio en producción/,
    );
    expect(() =>
      buildCorsOptions(cfg({ NODE_ENV: 'production', CORS_ORIGIN: ' , ' })),
    ).toThrow(/obligatorio/);
    // NODE_ENV ausente se trata como producción
    expect(() => buildCorsOptions(cfg({}))).toThrow(/obligatorio/);
  });

  it('fuera de producción sin orígenes devuelve lista vacía', () => {
    const options = buildCorsOptions(cfg({ NODE_ENV: 'development' }));
    expect(options.origin).toEqual([]);
  });

  it('no usa credenciales ni comodines', () => {
    const options = buildCorsOptions(
      cfg({ NODE_ENV: 'production', CORS_ORIGIN: 'http://localhost:3002' }),
    );
    expect(options.credentials).toBe(false);
    expect(options.origin).toEqual(['http://localhost:3002']);
    expect(options.allowedHeaders).toContain('x-org-id');
    expect(options.allowedHeaders).not.toContain('x-user-id');
    expect(options.maxAge).toBe(600);
  });

  it('expone Retry-After para que el navegador lo lea en el 429 del login', () => {
    const options = buildCorsOptions(
      cfg({ NODE_ENV: 'production', CORS_ORIGIN: 'http://localhost:3002' }),
    );
    expect(options.exposedHeaders).toEqual(['Retry-After']);
  });
});

describe('CORS (integración)', () => {
  let app: INestApplication;

  const start = async (values: Record<string, string | undefined>) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PingController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableCors(buildCorsOptions(cfg(values)));
    await app.init();
  };

  afterEach(async () => {
    await app?.close();
  });

  it('origen permitido recibe ACAO igual al origen y Vary: Origin; sin credenciales', async () => {
    await start({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'http://localhost:3002,http://127.0.0.1:3002',
    });
    const res = await request(app.getHttpServer())
      .get('/ping')
      .set('Origin', 'http://127.0.0.1:3002');
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://127.0.0.1:3002',
    );
    expect(res.headers['vary']).toMatch(/Origin/i);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['access-control-expose-headers']).toBe('Retry-After');
  });

  it('origen no permitido no recibe ACAO', async () => {
    await start({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'http://localhost:3002',
    });
    for (const origin of ['http://evil.example', 'http://localhost:3001']) {
      const res = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('preflight permitido responde 204 con x-org-id y sin Allow-Credentials', async () => {
    await start({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'http://localhost:3002',
    });
    const res = await request(app.getHttpServer())
      .options('/ping')
      .set('Origin', 'http://localhost:3002')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,x-org-id');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:3002',
    );
    expect(res.headers['access-control-allow-headers']).toMatch(/x-org-id/i);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('variable vacía en desarrollo: ningún ACAO', async () => {
    await start({ NODE_ENV: 'development', CORS_ORIGIN: '' });
    const res = await request(app.getHttpServer())
      .get('/ping')
      .set('Origin', 'http://localhost:3002');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
