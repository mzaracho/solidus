/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  Body,
  Controller,
  Get,
  INestApplication,
  Post,
  Query,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import request from 'supertest';
import { configurePipes } from './pipes-config';

// Feature 014: comportamiento del ValidationPipe global con un controlador sonda.

class NestedDto {
  @IsString() a!: string;
}

class SampleBody {
  /** La asigna el controlador (como los `:id` y @CurrentOrgId()): el cliente no puede mandarla. */
  declare id: string;

  @IsString() name!: string;
  @IsOptional() @IsNumber() n?: number;
  @IsOptional() @ValidateNested() @Type(() => NestedDto) nested?: NestedDto;
}

class SampleQuery {
  /** La asigna el controlador. */
  declare userId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @IsString() q?: string;
}

@Controller('probe')
class ProbeController {
  @Post()
  create(@Body() body: SampleBody) {
    body.id = 'asignado-por-el-controlador';
    return {
      isInstance: body instanceof SampleBody,
      nestedIsInstance:
        body.nested === undefined || body.nested instanceof NestedDto,
      keys: Object.keys(body).sort(),
      body,
    };
  }

  @Get()
  list(@Query() query: SampleQuery) {
    query.userId = 'asignado-por-el-controlador';
    return {
      isInstance: query instanceof SampleQuery,
      // con useDefineForClassFields los campos opcionales existen como claves `undefined`: solo cuentan los definidos
      keys: Object.keys(query)
        .filter((k) => (query as any)[k] !== undefined)
        .sort(),
      pageType: typeof query.page,
      query,
    };
  }
}

describe('configurePipes (RequestValidationPipe)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    configurePipes(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/probe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));
  const messages = (res: { body: { message?: unknown } }) =>
    Array.isArray(res.body.message) ? (res.body.message as string[]) : [];

  describe('body (whitelist + forbidNonWhitelisted)', () => {
    it('caso legítimo: 201 y el handler recibe una instancia de la clase solo con las claves declaradas', async () => {
      const res = await post({ name: 'x', n: 5, nested: { a: 'y' } });
      expect(res.status).toBe(201);
      expect(res.body.isInstance).toBe(true);
      expect(res.body.nestedIsInstance).toBe(true);
      expect(res.body.keys).toEqual(['id', 'n', 'name', 'nested']);
    });

    it('campo sobrante: 400 con un mensaje genérico que no refleja la clave enviada (B-1)', async () => {
      const res = await post({ name: 'x', 'clave<script>raro': 1 });
      expect(res.status).toBe(400);
      expect(messages(res)).toEqual([
        'El cuerpo contiene campos no permitidos.',
      ]);
      expect(JSON.stringify(res.body)).not.toContain('raro');
    });

    it('campo sobrante anidado: 400', async () => {
      const res = await post({ name: 'x', nested: { a: 'y', extra: 1 } });
      expect(res.status).toBe(400);
      expect(messages(res)).toEqual([
        'El cuerpo contiene campos no permitidos.',
      ]);
      expect(JSON.stringify(res.body)).not.toContain('extra');
    });

    it('campo `declare` que asigna el controlador: el cliente no lo puede mandar (400)', async () => {
      const res = await post({ name: 'x', id: 'inyectado' });
      expect(res.status).toBe(400);
      expect(messages(res)).toEqual([
        'El cuerpo contiene campos no permitidos.',
      ]);
    });

    it('body que no es un objeto (array, texto, número, null): 400', async () => {
      for (const payload of [[], [{ name: 'x' }], 'texto', 5]) {
        const res = await post(payload);
        expect({ payload, status: res.status }).toEqual({
          payload,
          status: 400,
        });
      }
    });

    it('varios sobrantes y un error de tipo: el sobrante da un solo mensaje genérico y el resto conserva su texto', async () => {
      const res = await post({ name: 5, a1: 1, a2: 2 });
      expect(res.status).toBe(400);
      const list = messages(res);
      expect(
        list.filter((m) => m === 'El cuerpo contiene campos no permitidos.'),
      ).toHaveLength(1);
      expect(list.some((m) => /name must be a string/.test(m))).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/a1|a2/);
    });

    it('body null literal: no llega como null al handler (400 por name faltante, sin 500)', async () => {
      const res = await request(app.getHttpServer())
        .post('/probe')
        .set('Content-Type', 'application/json')
        .send('null');
      expect(res.status).toBe(400);
    });

    it('sin conversión implícita: número, objeto o booleano en un string da 400; "80" en un número también', async () => {
      for (const name of [123, {}, true, ['x']]) {
        const res = await post({ name });
        expect({ name, status: res.status }).toEqual({ name, status: 400 });
      }
      const res = await post({ name: 'x', n: '80' });
      expect(res.status).toBe(400);
    });

    it('los errores no incluyen el valor enviado', async () => {
      const secret = 'valor-secreto-123';
      const res = await post({ name: 5, n: secret, extra: secret });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(secret);
    });
  });

  describe('query (whitelist sin forbidNonWhitelisted)', () => {
    it('lo no declarado se descarta y el handler no lo ve (mode, orgId, organizationId incluidos)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/probe?q=ana&mode=ORGANIZATION&orgId=1&organizationId=2&foo=3',
      );
      expect(res.status).toBe(200);
      expect(res.body.isInstance).toBe(true);
      expect(res.body.keys).toEqual(['q', 'userId']);
    });

    it('un campo `declare` enviado por el cliente se descarta y lo pisa el controlador', async () => {
      const res = await request(app.getHttpServer()).get(
        '/probe?userId=inyectado',
      );
      expect(res.status).toBe(200);
      expect(res.body.query.userId).toBe('asignado-por-el-controlador');
    });

    it('?page=2 con @Type(() => Number) llega como número', async () => {
      const res = await request(app.getHttpServer()).get('/probe?page=2');
      expect(res.status).toBe(200);
      expect(res.body.pageType).toBe('number');
      expect(res.body.query.page).toBe(2);
    });

    it('?page=abc, ?page=0 y ?q[a]=b (objeto en un string): 400', async () => {
      for (const qs of ['page=abc', 'page=0', 'q[a]=b', 'q[]=a']) {
        const res = await request(app.getHttpServer()).get(`/probe?${qs}`);
        expect({ qs, status: res.status }).toEqual({ qs, status: 400 });
      }
    });
  });
});
