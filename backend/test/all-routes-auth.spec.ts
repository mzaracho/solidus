/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
/**
 * QA (criterios 2, 3, 7 y 20): arranca el AppModule REAL (todos los controladores registrados) con
 * PrismaService reemplazado por un mock (sin base de datos, sin escrituras) y recorre TODAS las rutas.
 *  - Sin token: 401 en toda ruta salvo las @Public.
 *  - Con token válido y una organización a la que no pertenece: 403 en toda ruta salvo @Public y @OrgOptional.
 *  - Las únicas rutas @Public son login y salud; las únicas @OrgOptional son logout y pro/memberships.
 */
import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '@src/infrastructure.bootstrap/modules/app-module';
import { configureGlobalPrefix } from '@src/infrastructure.bootstrap/config/app/global-prefix-config';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { ORG_OPTIONAL_KEY } from '@src/infrastructure.bootstrap/config/core/authentication/org-optional-decorator';
import { PUBLIC_KEY } from '@src/infrastructure.bootstrap/config/core/authentication/public-decorator';

type Route = {
  method: string;
  path: string;
  isPublic: boolean;
  isOrgOptional: boolean;
  label: string;
};

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
};

const join = (...parts: string[]) =>
  '/' +
  parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

describe('Todas las rutas del AppModule real (sin base de datos)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const routes: Route[] = [];

  beforeAll(async () => {
    process.env.JWT_SECRET = 'k'.repeat(40);
    process.env.NODE_ENV = 'test';
    // Prisma mock: toda consulta devuelve "nada" (sin membresía, sin filas).
    const prismaMock: any = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'then') return undefined;
          if (prop === '$transaction')
            return async (fn: any) =>
              typeof fn === 'function' ? fn(prismaMock) : [];
          return new Proxy(() => undefined, {
            get: () => async () => null,
            apply: async () => null,
          });
        },
      },
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();
    app = moduleRef.createNestApplication();
    configureGlobalPrefix(app);
    await app.init();
    jwt = moduleRef.get(JwtService);

    const prefix = 'api';
    const container = moduleRef.get(ModulesContainer);
    const seen = new Set<string>();
    for (const mod of container.values()) {
      for (const wrapper of mod.controllers.values()) {
        const ctrl = wrapper.metatype as any;
        if (!ctrl) continue;
        const base: string = Reflect.getMetadata(PATH_METADATA, ctrl) ?? '';
        const proto = ctrl.prototype;
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name === 'constructor') continue;
          const handler = proto[name];
          if (typeof handler !== 'function') continue;
          const methodId = Reflect.getMetadata(METHOD_METADATA, handler);
          if (methodId === undefined) continue;
          const sub: string = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
          const isHealth = base.replace(/^\/+/, '').startsWith('health');
          const full = isHealth ? join(base, sub) : join(prefix, base, sub);
          const method = METHOD_NAMES[methodId] ?? 'get';
          const key = `${method} ${full}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const meta = (k: string) =>
            Boolean(Reflect.getMetadata(k, handler)) ||
            Boolean(Reflect.getMetadata(k, ctrl));
          routes.push({
            method,
            path: full.replace(/:[A-Za-z]+/g, () => randomUUID()),
            isPublic: meta(PUBLIC_KEY),
            isOrgOptional: meta(ORG_OPTIONAL_KEY),
            label: key.toUpperCase(),
          });
        }
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('descubre un número razonable de rutas', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it('las únicas rutas @Public son login y salud', () => {
    const pub = routes
      .filter((r) => r.isPublic)
      .map((r) => r.label)
      .sort();
    expect(pub).toEqual(['GET /HEALTH/LIVENESS', 'POST /API/V1/AUTH/LOGIN']);
  });

  it('las únicas rutas @OrgOptional son logout y pro/memberships', () => {
    const opt = routes
      .filter((r) => r.isOrgOptional)
      .map((r) => r.label)
      .sort();
    expect(opt).toEqual([
      'GET /API/PRO/MEMBERSHIPS',
      'POST /API/V1/AUTH/LOGOUT',
    ]);
  });

  it('sin token: 401 en TODA ruta no pública (y sin detalles del error)', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic)) {
      const res = await (request(app.getHttpServer()) as any)
        [r.method](r.path)
        .send({});
      if (
        res.status !== 401 ||
        /jwt|signature|expired|malformed/i.test(res.text)
      ) {
        bad.push(`${r.label} -> ${res.status}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('con token válido pero organización ajena (sin membresía): 403 en TODA ruta no pública ni @OrgOptional', async () => {
    const token = jwt.sign({ sub: randomUUID() });
    const bad: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic && !x.isOrgOptional)) {
      const res = await (request(app.getHttpServer()) as any)
        [r.method](r.path)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', randomUUID())
        .send({});
      if (res.status !== 403) bad.push(`${r.label} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('con token válido y SIN organización: 403 en TODA ruta no pública ni @OrgOptional', async () => {
    const token = jwt.sign({ sub: randomUUID() });
    const bad: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic && !x.isOrgOptional)) {
      const res = await (request(app.getHttpServer()) as any)
        [r.method](r.path)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      if (res.status !== 403) bad.push(`${r.label} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('un x-org-id que no es UUID (slug) da 403 en las rutas con organización', async () => {
    const token = jwt.sign({ sub: randomUUID() });
    const res = await request(app.getHttpServer())
      .get('/api/org')
      .set('Authorization', `Bearer ${token}`)
      .set('x-org-id', 'psico-lsa');
    expect(res.status).toBe(403);
  });
});
