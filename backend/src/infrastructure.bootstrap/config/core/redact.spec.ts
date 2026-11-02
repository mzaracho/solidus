/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { redactSensitive, REDACTED, safeStringify } from './redact';

describe('redactSensitive', () => {
  it('redacta claves sensibles a cualquier nivel y dentro de arrays, sin distinguir mayúsculas', () => {
    const input = {
      user: 'a@example.test',
      password: 'p1',
      nested: { a: { b: [{ accessToken: 'x', ok: 1 }] } },
      secret: 'y',
      JWT: 'z',
      Authorization: 'Bearer q',
      cookie: 'c',
      'x-api-key': 'k',
      apiKey: 'k2',
      newPassword: 'n',
      passwordHash: 'h',
      idToken: 'i',
    };
    const out = redactSensitive(input) as any;
    expect(out.user).toBe('a@example.test');
    expect(out.nested.a.b[0].accessToken).toBe(REDACTED);
    expect(out.nested.a.b[0].ok).toBe(1);
    for (const key of [
      'password',
      'secret',
      'JWT',
      'Authorization',
      'cookie',
      'x-api-key',
      'apiKey',
      'newPassword',
      'passwordHash',
      'idToken',
    ]) {
      expect(out[key]).toBe(REDACTED);
    }
  });

  it('no muta el original', () => {
    const input = { password: 'p', list: [{ token: 't' }] };
    redactSensitive(input);
    expect(input.password).toBe('p');
    expect(input.list[0].token).toBe('t');
  });

  it('soporta ciclos', () => {
    const a: any = { name: 'a' };
    a.self = a;
    const out = redactSensitive(a) as any;
    expect(out.self).toBe('[Circular]');
  });

  it('corta en la profundidad máxima', () => {
    let deep: any = { leaf: 1 };
    for (let i = 0; i < 12; i++) deep = { child: deep };
    expect(JSON.stringify(redactSensitive(deep))).toContain('[MaxDepth]');
  });

  it('deja pasar primitivos, null y undefined', () => {
    expect(redactSensitive('texto')).toBe('texto');
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeUndefined();
    expect(redactSensitive(3)).toBe(3);
  });
});

describe('safeStringify', () => {
  it('serializa redactado', () => {
    expect(safeStringify({ password: 'p', a: 1 })).toBe(
      JSON.stringify({ password: REDACTED, a: 1 }),
    );
  });

  it('no lanza con valores no serializables', () => {
    expect(safeStringify({ n: BigInt(1) })).toBe('[unserializable]');
  });
});
