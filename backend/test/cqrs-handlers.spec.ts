/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
/**
 * Guardia de handlers CQRS (018, #55): un handler sin @RequestHandler o sin registrar en un módulo
 * responde "Handler not found" en runtime y ni tsc ni Jest lo detectan. Aquí se vigila:
 *  - estático: toda clase `implements IRequestHandler` en src/application lleva @Injectable() y @RequestHandler(;
 *  - dinámico (AppModule real, Prisma mockeado): todo request con handler está registrado y se resuelve;
 *  - todo `new XCommand(` / `new XQuery(` de los controladores tiene su handler.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ModulesContainer, ContextIdFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/infrastructure.bootstrap/modules/app-module';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { REQUEST_HANDLER_METADATA_KEY } from '@src/infrastructure.bootstrap/config/core/cqrs/constant';

const SRC = path.join(__dirname, '..', 'src');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });

const applicationFiles = walk(path.join(SRC, 'application'));
const controllerFiles = walk(path.join(SRC, 'api', 'controllers'));

describe('handlers CQRS (estático)', () => {
  it('toda clase que implementa IRequestHandler tiene @Injectable() y @RequestHandler(', () => {
    const bad: string[] = [];
    let handlers = 0;
    for (const file of applicationFiles) {
      const text = fs.readFileSync(file, 'utf8');
      const re =
        /((?:@[A-Za-z]+\([^)]*\)\s*)*)export class (\w+)\s+implements\s+IRequestHandler\b/g;
      for (const match of text.matchAll(re)) {
        handlers += 1;
        const decorators = match[1];
        if (!/@Injectable\(\)/.test(decorators)) {
          bad.push(`${match[2]}: falta @Injectable()`);
        }
        if (!/@RequestHandler\(/.test(decorators)) {
          bad.push(`${match[2]}: falta @RequestHandler(`);
        }
      }
    }
    expect(handlers).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it('toda clase que implementa IRequestHandler está detectada (ninguna se escapa del patrón)', () => {
    let declared = 0;
    let matched = 0;
    for (const file of applicationFiles) {
      const text = fs.readFileSync(file, 'utf8');
      declared += (text.match(/implements\s+IRequestHandler\b/g) ?? []).length;
      matched += (
        text.match(
          /((?:@[A-Za-z]+\([^)]*\)\s*)*)export class (\w+)\s+implements\s+IRequestHandler\b/g,
        ) ?? []
      ).length;
    }
    expect(matched).toBe(declared);
  });
});

describe('handlers CQRS (AppModule real, Prisma mockeado)', () => {
  let moduleRef: Awaited<
    ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
  >;
  const requestClasses = new Map<string, new (...args: any[]) => unknown>();

  beforeAll(async () => {
    process.env.JWT_SECRET = 'k'.repeat(40);
    process.env.NODE_ENV = 'test';
    const prismaMock: any = new Proxy(
      {},
      {
        get: (_t, prop) => (prop === 'then' ? undefined : () => undefined),
      },
    );
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    for (const file of applicationFiles) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const exported = require(file) as Record<string, unknown>;
      for (const [name, value] of Object.entries(exported)) {
        if (typeof value === 'function') {
          requestClasses.set(name, value as any);
        }
      }
    }
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('cada request con handler lo tiene registrado en un módulo y se resuelve', async () => {
    const registered = new Set<unknown>();
    for (const mod of moduleRef.get(ModulesContainer).values()) {
      for (const wrapper of mod.providers.values()) {
        if (wrapper.metatype) registered.add(wrapper.metatype);
      }
    }
    const withHandler = [...requestClasses.entries()].filter(
      ([, cls]) =>
        Reflect.getMetadata(REQUEST_HANDLER_METADATA_KEY, cls) !== undefined,
    );
    expect(withHandler.length).toBeGreaterThan(20);

    const notRegistered: string[] = [];
    const notResolved: string[] = [];
    for (const [name, cls] of withHandler) {
      const handler = Reflect.getMetadata(REQUEST_HANDLER_METADATA_KEY, cls);
      if (!registered.has(handler)) {
        notRegistered.push(`${name} -> ${(handler as { name: string }).name}`);
        continue;
      }
      try {
        const instance = await moduleRef.resolve(
          handler,
          ContextIdFactory.create(),
          { strict: false },
        );
        if (typeof instance?.execute !== 'function') notResolved.push(name);
      } catch {
        notResolved.push(name);
      }
    }
    expect(notRegistered).toEqual([]);
    expect(notResolved).toEqual([]);
  });

  it('todo `new XCommand(` / `new XQuery(` de los controladores tiene su handler', () => {
    const missing: string[] = [];
    let used = 0;
    for (const file of controllerFiles) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/new\s+(\w+(?:Command|Query))\s*\(/g)) {
        used += 1;
        const cls = requestClasses.get(match[1]);
        if (
          !cls ||
          Reflect.getMetadata(REQUEST_HANDLER_METADATA_KEY, cls) === undefined
        ) {
          missing.push(`${path.basename(file)}: ${match[1]}`);
        }
      }
    }
    expect(used).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});
