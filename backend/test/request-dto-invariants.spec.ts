/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
/**
 * Feature 014, criterio 4: todo @Body() y @Query() de un controlador registrado usa una clase con decoradores de
 * class-validator. Arranca el AppModule real (PrismaService reemplazado, sin base de datos) y recorre los
 * controladores con ModulesContainer, igual que all-routes-auth.spec.ts.
 *
 * Por cada parámetro de body o query:
 *  - sin nombre (`@Body('x')` / `@Query('x')` son tipos inline);
 *  - el tipo es una clase (no Object, String, Number, Boolean ni Array);
 *  - la clase tiene al menos un decorador de class-validator;
 *  - todo campo propio de `new Clase()` tiene decorador (un campo sin decorar que no es `declare` rompe la
 *    whitelist: en bodies daría `property x should not exist` siempre);
 *  - lo mismo para las clases anidadas (@ValidateNested).
 */
import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { getMetadataStorage } from 'class-validator';
import { AppModule } from '@src/infrastructure.bootstrap/modules/app-module';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';

type ParamRef = {
  route: string;
  kind: 'body' | 'query';
  named: boolean;
  type: unknown;
};

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
};

const join = (...parts: string[]) =>
  '/' +
  parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

// Rutas con @Body()/@Query() que pueden usar un tipo sin decoradores de class-validator, con su justificación.
// Vacía: cada entrada nueva necesita una razón. El test verifica que toda entrada siga existiendo.
const INLINE_ALLOWLIST: Record<string, string> = {};

const validations = (cls: any) =>
  getMetadataStorage().getTargetValidationMetadatas(cls, '', true, false);

const nestedClasses = (cls: any): any[] => {
  const result: any[] = [];
  for (const meta of validations(cls)) {
    if (meta.type !== 'nestedValidation') continue;
    const sample: any = plainToInstance(cls, {
      [meta.propertyName]: meta.each ? [{}] : {},
    });
    const value = sample[meta.propertyName];
    const inner = Array.isArray(value) ? value[0] : value;
    if (inner && inner.constructor && inner.constructor !== Object) {
      result.push(inner.constructor);
    }
  }
  return result;
};

/** Devuelve los problemas de una clase (y de sus anidadas). */
const problemsOf = (
  cls: any,
  label: string,
  seen = new Set<any>(),
): string[] => {
  if (seen.has(cls)) return [];
  seen.add(cls);
  if (
    typeof cls !== 'function' ||
    [Object, String, Number, Boolean, Array].includes(cls)
  ) {
    return [`${label}: el tipo no es una clase (inline, Record o any)`];
  }
  const metas = validations(cls);
  if (metas.length === 0) {
    return [`${label}: ${cls.name} no tiene decoradores de class-validator`];
  }
  const decorated = new Set(metas.map((m) => m.propertyName));
  const problems: string[] = [];
  for (const key of Object.keys(new cls())) {
    if (!decorated.has(key)) {
      problems.push(
        `${label}: ${cls.name}.${key} es un campo propio sin decorador (usar \`declare\` si lo asigna el controlador)`,
      );
    }
  }
  for (const inner of nestedClasses(cls)) {
    problems.push(...problemsOf(inner, `${label} > ${cls.name}`, seen));
  }
  return problems;
};

describe('014: DTOs de todos los @Body() y @Query() (invariante estático)', () => {
  const refs: ParamRef[] = [];

  beforeAll(async () => {
    process.env.JWT_SECRET = 'k'.repeat(40);
    process.env.NODE_ENV = 'test';
    const prismaMock: any = new Proxy(
      {},
      { get: (_t, prop) => (prop === 'then' ? undefined : () => undefined) },
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();
    const container = moduleRef.get(ModulesContainer);
    for (const mod of container.values()) {
      for (const wrapper of mod.controllers.values()) {
        const ctrl = wrapper.metatype as any;
        if (!ctrl) continue;
        const base: string = Reflect.getMetadata(PATH_METADATA, ctrl) ?? '';
        for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
          if (name === 'constructor') continue;
          const handler = ctrl.prototype[name];
          if (typeof handler !== 'function') continue;
          const methodId = Reflect.getMetadata(METHOD_METADATA, handler);
          if (methodId === undefined) continue;
          const sub: string = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
          const route = `${METHOD_NAMES[methodId] ?? 'GET'} ${join(base, sub)}`;
          const args =
            Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, name) ?? {};
          const types =
            Reflect.getMetadata('design:paramtypes', ctrl.prototype, name) ??
            [];
          for (const [key, value] of Object.entries<any>(args)) {
            const [typeStr] = key.split(':');
            const paramtype = Number(typeStr) as RouteParamtypes;
            if (
              paramtype !== RouteParamtypes.BODY &&
              paramtype !== RouteParamtypes.QUERY
            )
              continue;
            refs.push({
              route,
              kind: paramtype === RouteParamtypes.BODY ? 'body' : 'query',
              named: value.data !== undefined,
              type: types[value.index],
            });
          }
        }
      }
    }
    await moduleRef.close();
  });

  it('enumera todas las rutas con body o query (un refactor que deje de enumerarlas no da falso verde)', () => {
    expect(refs.filter((r) => r.kind === 'body')).toHaveLength(20);
    expect(refs.filter((r) => r.kind === 'query')).toHaveLength(8);
  });

  it('ningún @Body() ni @Query() usa un tipo inline o sin class-validator (salvo la lista blanca)', () => {
    const problems: string[] = [];
    for (const ref of refs) {
      const label = `${ref.route} (${ref.kind})`;
      if (ref.route in INLINE_ALLOWLIST) continue;
      if (ref.named) {
        problems.push(`${label}: parámetro con nombre (tipo inline)`);
        continue;
      }
      problems.push(...problemsOf(ref.type, label));
    }
    expect(problems).toEqual([]);
  });

  it('la lista blanca no acumula entradas obsoletas', () => {
    const routes = new Set(refs.map((r) => r.route));
    for (const key of Object.keys(INLINE_ALLOWLIST)) {
      expect(routes.has(key)).toBe(true);
    }
  });
});
