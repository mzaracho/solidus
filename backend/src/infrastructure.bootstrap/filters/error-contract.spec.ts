import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describeForLog, GENERIC_ERRORS, mapException } from './error-contract';
import { resourceNotFound } from '../config/core/authentication/org-resource';

const keysOf = (e: unknown) => Object.keys(mapException(e).body).sort();

describe('mapException: contrato único { code, errors }', () => {
  it.each([
    ['400 string suelto', new BadRequestException('texto interno')],
    [
      '401',
      new UnauthorizedException({
        code: 'unauthorized',
        message: 'Unauthorized',
      }),
    ],
    ['403', new ForbiddenException('x')],
    ['404', new NotFoundException('Cannot GET /x')],
    ['409', new ConflictException('x')],
    ['500 Nest', new InternalServerErrorException('interno')],
    ['Error', new Error('x')],
    ['string lanzado', 'boom'],
    ['objeto lanzado', { secreto: 'valor' }],
    ['null', null],
  ])('%s: solo code y errors', (_n, e) => {
    expect(keysOf(e)).toEqual(['code', 'errors']);
  });

  describe('400', () => {
    it('ValidationPipe (array): validation-failed con los mensajes', () => {
      const e = new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: ['user must be a string', 'password should not be empty'],
      });
      const m = mapException(e);
      expect(m.status).toBe(400);
      expect(m.internal).toBe(false);
      expect(m.body).toEqual({
        code: 'validation-failed',
        errors: [
          { message: 'user must be a string' },
          { message: 'password should not be empty' },
        ],
      });
    });

    it('tope de 20 mensajes y 200 caracteres; ignora lo que no es string', () => {
      const many = Array.from({ length: 30 }, (_, i) => `campo${i} inválido`);
      const long = new BadRequestException({
        message: ['x'.repeat(500), 42, null, ...many],
      });
      const errors = mapException(long).body.errors;
      expect(errors).toHaveLength(20);
      expect(errors[0].message).toHaveLength(200);
      expect(errors.every((x) => typeof x.message === 'string')).toBe(true);
    });

    it('array vacío: el genérico del 400', () => {
      const m = mapException(new BadRequestException({ message: [] }));
      expect(m.body.code).toBe('validation-failed');
      expect(m.body.errors).toEqual([{ message: GENERIC_ERRORS[400][1] }]);
    });

    it('string suelto: genérico', () => {
      const m = mapException(new BadRequestException('At most 3 roles'));
      expect(m.body).toEqual({
        code: 'bad-request',
        errors: [{ message: GENERIC_ERRORS[400][1] }],
      });
    });

    it('{ code, message }: pasa el mensaje de negocio', () => {
      const m = mapException(
        new BadRequestException({
          code: 'first-load-required',
          message: 'Regla de negocio',
        }),
      );
      expect(m.body).toEqual({
        code: 'first-load-required',
        errors: [{ message: 'Regla de negocio' }],
      });
    });

    it("URIError convertido por Nest ('Failed to decode param'): genérico", () => {
      const m = mapException(
        new BadRequestException("Failed to decode param '%E0%A4%A'"),
      );
      expect(JSON.stringify(m.body)).not.toContain('decode');
    });

    it('mensaje de negocio de más de 300 caracteres: recortado', () => {
      const m = mapException(
        new BadRequestException({
          code: 'bad-request',
          message: 'y'.repeat(900),
        }),
      );
      expect(m.body.errors[0].message).toHaveLength(300);
    });
  });

  describe('401, 403 y 404: siempre genérico', () => {
    it('401 conserva el código y fuerza el mensaje', () => {
      const m = mapException(
        new UnauthorizedException({
          code: 'unauthorized',
          message: 'Unauthorized',
        }),
      );
      expect(m.status).toBe(401);
      expect(m.body).toEqual({
        code: 'unauthorized',
        errors: [{ message: GENERIC_ERRORS[401][1] }],
      });
    });

    it.each(['org-access-denied', 'forbidden', 'invalid-mode'])(
      '403 %s: código conservado y mensaje genérico',
      (code) => {
        const m = mapException(
          new ForbiddenException({ code, message: 'texto específico' }),
        );
        expect(m.body).toEqual({
          code,
          errors: [{ message: GENERIC_ERRORS[403][1] }],
        });
      },
    );

    it('403 sin código: forbidden', () => {
      expect(mapException(new ForbiddenException('x')).body.code).toBe(
        'forbidden',
      );
    });

    it('404 de recurso y de ruta inexistente: bodies idénticos', () => {
      const a = mapException(resourceNotFound());
      const b = mapException(new NotFoundException('Cannot GET /api/x'));
      expect(a.status).toBe(404);
      expect(a.body).toEqual(b.body);
      expect(a.body.code).toBe('not-found');
    });
  });

  describe('409 y 429', () => {
    it('409 explícito pasa el mensaje', () => {
      const m = mapException(
        new ConflictException({ code: 'conflict', message: 'Ya existe.' }),
      );
      expect(m.status).toBe(409);
      expect(m.body).toEqual({
        code: 'conflict',
        errors: [{ message: 'Ya existe.' }],
      });
    });

    it('409 sin código: genérico', () => {
      const m = mapException(new ConflictException('interno'));
      expect(m.body.errors).toEqual([{ message: GENERIC_ERRORS[409][1] }]);
    });

    it('429 explícito (como el del login) pasa intacto', () => {
      const m = mapException(
        new HttpException(
          { code: 'too-many-requests', message: 'Demasiados intentos.' },
          429,
        ),
      );
      expect(m.status).toBe(429);
      expect(m.body).toEqual({
        code: 'too-many-requests',
        errors: [{ message: 'Demasiados intentos.' }],
      });
    });

    it('otro 4xx sin código: request-error', () => {
      const m = mapException(new HttpException('x', 422));
      expect(m.body.code).toBe('request-error');
    });
  });

  describe('5xx', () => {
    it('InternalServerErrorException: genérico e interno', () => {
      const m = mapException(new InternalServerErrorException('texto interno'));
      expect(m.status).toBe(500);
      expect(m.internal).toBe(true);
      expect(m.body).toEqual({
        code: 'unhandled-exception',
        errors: [{ message: GENERIC_ERRORS[500][1] }],
      });
    });

    it('503 conserva el status', () => {
      const m = mapException(new ServiceUnavailableException('x'));
      expect(m.status).toBe(503);
      expect(m.body.code).toBe('unhandled-exception');
    });
  });

  describe('errores que no son HttpException', () => {
    const prismaErrors = (): unknown[] => [
      new Prisma.PrismaClientKnownRequestError(
        'Invalid prisma.user.findUnique() where: valor-where-ficticio',
        {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['valor-meta'] },
        },
      ),
      new Prisma.PrismaClientValidationError('arg valor-where-ficticio', {
        clientVersion: '5.22.0',
      }),
      new Prisma.PrismaClientInitializationError(
        'no se puede conectar valor-where-ficticio',
        '5.22.0',
      ),
    ];

    it.each([0, 1, 2])('Prisma #%i: 500 genérico y log sin valores', (i) => {
      const e = prismaErrors()[i];
      const m = mapException(e);
      expect(m.status).toBe(500);
      expect(m.internal).toBe(true);
      expect(JSON.stringify(m.body)).not.toMatch(
        /prisma|valor-|clientVersion|meta|P2002/i,
      );
      const log = describeForLog(e);
      expect(log).toMatch(/^PrismaClient/);
      expect(log).not.toMatch(
        /valor-where-ficticio|valor-meta|clientVersion|5\.22/,
      );
    });

    it('Prisma conocido: el log lleva el código', () => {
      expect(describeForLog(prismaErrors()[0])).toBe(
        'PrismaClientKnownRequestError prisma=P2002',
      );
    });

    it('error de Prisma detectado por nombre de clase o clientVersion', () => {
      class PrismaClientKnownRequestError extends Error {}
      expect(
        describeForLog(new PrismaClientKnownRequestError('valor-secreto')),
      ).toBe('PrismaClientKnownRequestError');
      expect(
        describeForLog(
          Object.assign(new Error('valor-secreto'), { clientVersion: '1' }),
        ),
      ).not.toContain('valor-secreto');
    });

    it('Error común: 500 genérico', () => {
      const m = mapException(new Error('x'));
      expect(m.status).toBe(500);
      expect(m.body.errors).toEqual([{ message: GENERIC_ERRORS[500][1] }]);
    });

    it('http-errors 4xx con expose: status y genérico, nunca err.message', () => {
      const e = Object.assign(new Error('mensaje interno del parser'), {
        status: 400,
        expose: true,
      });
      const m = mapException(e);
      expect(m.status).toBe(400);
      expect(m.internal).toBe(false);
      expect(JSON.stringify(m.body)).not.toContain('parser');
    });

    it('http-errors con status 500: 500', () => {
      const m = mapException(
        Object.assign(new Error('x'), { status: 500, expose: false }),
      );
      expect(m.status).toBe(500);
      expect(m.internal).toBe(true);
    });

    it('http-errors 4xx sin expose: 500', () => {
      expect(
        mapException(Object.assign(new Error('x'), { status: 400 })).status,
      ).toBe(500);
    });

    it('un objeto hostil (getters que lanzan) no rompe el mapeo', () => {
      const hostile = new Proxy(
        {},
        {
          get() {
            throw new Error('hostil');
          },
        },
      );
      expect(mapException(hostile).status).toBe(500);
      expect(typeof describeForLog(hostile)).toBe('string');
    });
  });
});

describe('describeForLog', () => {
  it('neutraliza controles y separadores de línea del mensaje', () => {
    const out = describeForLog(new Error('a\r\nFAKE linea\u0085\u0000b'));
    expect(out).toBe('Error: a??FAKE?linea??b');
  });

  it('recorta el mensaje a 200 caracteres', () => {
    expect(describeForLog(new Error('z'.repeat(500)))).toHaveLength(
      'Error: '.length + 200,
    );
  });

  it('un valor que no es Error no se serializa', () => {
    expect(describeForLog({ secreto: 'valor' })).toBe('non-error object');
    expect(describeForLog('texto')).toBe('non-error string');
    expect(describeForLog(undefined)).toBe('non-error undefined');
  });
});
