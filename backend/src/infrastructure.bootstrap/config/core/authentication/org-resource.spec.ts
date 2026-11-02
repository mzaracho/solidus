/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  foundOr404,
  inOrg,
  inScope,
  optionalId,
  requireId,
  resourceNotFound,
} from './org-resource';

const body = (fn: () => unknown) => {
  try {
    fn();
  } catch (e: any) {
    return e;
  }
  return undefined;
};

describe('org-resource', () => {
  it('requireId: normaliza mayúsculas y espacios', () => {
    const id = randomUUID();
    expect(requireId(` ${id.toUpperCase()} `)).toBe(id);
  });

  it('requireId: no UUID o no string da 404 genérico', () => {
    for (const bad of ['abc', '', 123, null, undefined, {}, ['x']]) {
      const e = body(() => requireId(bad));
      expect(e).toBeInstanceOf(NotFoundException);
      expect(e.getResponse()).toEqual({
        code: 'not-found',
        message: 'Not Found',
      });
    }
  });

  it('optionalId: vacíos dan null', () => {
    expect(optionalId('')).toBeNull();
    expect(optionalId(null)).toBeNull();
    expect(optionalId(undefined)).toBeNull();
    const id = randomUUID();
    expect(optionalId(id)).toBe(id);
    expect(() => optionalId('xx')).toThrow(NotFoundException);
  });

  it('foundOr404: null da 404; el resto pasa; cuerpos idénticos', async () => {
    await expect(foundOr404(Promise.resolve({ a: 1 }))).resolves.toEqual({
      a: 1,
    });
    let err1: any;
    try {
      await foundOr404(Promise.resolve(null));
    } catch (e) {
      err1 = e;
    }
    expect(err1).toBeInstanceOf(NotFoundException);
    expect(err1.getResponse()).toEqual({
      code: 'not-found',
      message: 'Not Found',
    });
    expect(JSON.stringify(err1.getResponse())).toBe(
      JSON.stringify(resourceNotFound().getResponse()),
    );
  });

  it('inScope / inOrg arman el where', () => {
    const a = randomUUID();
    const b = randomUUID();
    const scope: any = { orgIds: [a, b] };
    expect(inScope(scope)).toEqual({ organizationId: { in: [a, b] } });
    expect(inOrg(a)).toEqual({ organizationId: a });
  });
});
