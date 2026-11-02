/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'crypto';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  jwtModuleAsyncOptions,
} from '../config/app/jwt-config';
import { Public } from '../config/core/authentication/public-decorator';
import { AuthenticationGuard } from './authentication-guard';

// Secreto ficticio armado en ejecución: no se lee ningún .env.
const SECRET = 'k'.repeat(40);

const b64 = (value: object | string) =>
  Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(value),
  ).toString('base64url');

const forge = (
  header: object,
  payload: object,
  alg: 'sha256' | 'sha512' | null,
  secret = SECRET,
) => {
  const head = b64(header);
  const body = b64(payload);
  const signature = alg
    ? createHmac(alg, secret).update(`${head}.${body}`).digest('base64url')
    : '';
  return `${head}.${body}.${signature}`;
};

class PublicHandlerController {
  @Public()
  open() {
    return 'ok';
  }
  closed() {
    return 'ok';
  }
}

@Public()
class PublicClassController {
  anything() {
    return 'ok';
  }
}

const makeContext = (
  headers: Record<string, unknown>,
  target: { handler: () => unknown; cls: new () => unknown } = {
    handler: PublicHandlerController.prototype.closed,
    cls: PublicHandlerController,
  },
) => {
  const request: any = { headers: { ...headers } };
  const context = {
    getHandler: () => target.handler,
    getClass: () => target.cls,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
};

describe('AuthenticationGuard', () => {
  let jwt: JwtService;
  let guard: AuthenticationGuard;
  const userId = randomUUID();
  const findUnique = jest.fn();

  beforeEach(() => {
    findUnique.mockReset();
    findUnique.mockResolvedValue({ id: userId, deletedAt: null });
  });

  beforeAll(() => {
    const options = (jwtModuleAsyncOptions().useFactory as any)({
      get: () => SECRET,
    });
    jwt = new JwtService(options);
    guard = new AuthenticationGuard(new Reflector(), jwt, {
      user: { findUnique },
    } as any);
  });

  const validClaims = () => {
    const now = Math.floor(Date.now() / 1000);
    return {
      sub: userId,
      iat: now,
      exp: now + 600,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
    };
  };

  const expect401 = async (headers: Record<string, unknown>) => {
    const { context } = makeContext(headers);
    let error: any;
    try {
      await guard.canActivate(context);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toEqual({
      code: 'unauthorized',
      message: 'Unauthorized',
    });
    const text = JSON.stringify(error.getResponse()).toLowerCase();
    for (const word of ['jwt', 'signature', 'expired']) {
      expect(text).not.toContain(word);
    }
    const auth = headers.authorization;
    if (typeof auth === 'string' && auth.length > 10) {
      expect(text).not.toContain(auth.slice(-12).toLowerCase());
    }
  };

  it('sin header Authorization da 401', async () => {
    await expect401({});
  });

  it('header que no es string da 401', async () => {
    await expect401({ authorization: ['Bearer a.b.c'] });
  });

  it('sin esquema Bearer da 401', async () => {
    const token = jwt.sign({ sub: userId });
    await expect401({ authorization: token });
    await expect401({ authorization: `Basic ${token}` });
  });

  it('token de dos partes da 401', async () => {
    await expect401({ authorization: 'Bearer abc.def' });
  });

  it('header de más de 4096 caracteres da 401', async () => {
    await expect401({ authorization: `Bearer ${'a'.repeat(4100)}.b.c` });
  });

  it('firma con otro secreto da 401', async () => {
    const token = forge(
      { alg: 'HS256', typ: 'JWT' },
      validClaims(),
      'sha256',
      'otro-secreto-ficticio-'.repeat(2),
    );
    await expect401({ authorization: `Bearer ${token}` });
  });

  it('token expirado da 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = forge(
      { alg: 'HS256', typ: 'JWT' },
      { ...validClaims(), iat: now - 7200, exp: now - 3600 },
      'sha256',
    );
    await expect401({ authorization: `Bearer ${token}` });
  });

  it('alg none da 401', async () => {
    const token = forge({ alg: 'none', typ: 'JWT' }, validClaims(), null);
    await expect401({ authorization: `Bearer ${token}` });
  });

  it('HS512 con el secreto correcto da 401', async () => {
    const token = forge({ alg: 'HS512', typ: 'JWT' }, validClaims(), 'sha512');
    await expect401({ authorization: `Bearer ${token}` });
  });

  it('sin iss da 401', async () => {
    const { iss, ...claims } = validClaims();
    void iss;
    const token = forge({ alg: 'HS256', typ: 'JWT' }, claims, 'sha256');
    await expect401({ authorization: `Bearer ${token}` });
  });

  it('aud distinto da 401', async () => {
    const token = forge(
      { alg: 'HS256', typ: 'JWT' },
      { ...validClaims(), aud: 'otro' },
      'sha256',
    );
    await expect401({ authorization: `Bearer ${token}` });
  });

  it('sub que no es UUID da 401', async () => {
    const token = forge(
      { alg: 'HS256', typ: 'JWT' },
      { ...validClaims(), sub: 'no-es-uuid' },
      'sha256',
    );
    await expect401({ authorization: `Bearer ${token}` });
  });

  it('sin exp da 401', async () => {
    const { exp, ...claims } = validClaims();
    void exp;
    const token = forge({ alg: 'HS256', typ: 'JWT' }, claims, 'sha256');
    await expect401({ authorization: `Bearer ${token}` });
  });

  it('ruta @Public en el handler pasa sin token', async () => {
    const { context } = makeContext(
      {},
      {
        handler: PublicHandlerController.prototype.open,
        cls: PublicHandlerController,
      },
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('ruta @Public en la clase pasa sin token', async () => {
    const { context } = makeContext(
      {},
      {
        handler: PublicClassController.prototype.anything,
        cls: PublicClassController,
      },
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('token válido de un usuario dado de baja da 401 genérico', async () => {
    findUnique.mockResolvedValue({ id: userId, deletedAt: new Date() });
    await expect401({ authorization: `Bearer ${jwt.sign({ sub: userId })}` });
  });

  it('token válido de un usuario inexistente da 401 genérico', async () => {
    findUnique.mockResolvedValue(null);
    await expect401({ authorization: `Bearer ${jwt.sign({ sub: userId })}` });
  });

  it('consulta por clave primaria con select mínimo, en cada request (sin cache)', async () => {
    const token = jwt.sign({ sub: userId });
    for (let i = 0; i < 2; i++) {
      const { context } = makeContext({ authorization: `Bearer ${token}` });
      await guard.canActivate(context);
    }
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });
  });

  it('un token inválido no llega a la base', async () => {
    await expect401({ authorization: 'Bearer abc.def.ghi' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('token válido deja request.auth y pisa x-user-id con sub', async () => {
    const token = jwt.sign({ sub: userId, name: 'Ficticio' });
    const { context, request } = makeContext({
      authorization: `Bearer ${token}`,
      'x-user-id': randomUUID(),
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.auth.userId).toBe(userId);
    expect(request.auth.claims.sub).toBe(userId);
    expect(request.headers['x-user-id']).toBe(userId);
  });

  it('acepta "bearer" en minúsculas', async () => {
    const token = jwt.sign({ sub: userId });
    const { context } = makeContext({ authorization: `bearer ${token}` });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
