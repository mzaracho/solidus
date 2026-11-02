/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { ConfigService } from '@nestjs/config';
import {
  getRuntimeEnv,
  isProduction,
  shouldEnableSwagger,
} from './runtime-env';

const cfg = (value?: unknown) =>
  ({ get: () => value }) as unknown as ConfigService;

describe('getRuntimeEnv', () => {
  it.each([
    ['development', 'development'],
    ['test', 'test'],
    [' Development ', 'development'],
    ['TEST', 'test'],
    ['production', 'production'],
    ['staging', 'production'],
    ['', 'production'],
    [undefined, 'production'],
    [123, 'production'],
  ])('NODE_ENV=%p da %p (falla cerrado)', (raw, expected) => {
    expect(getRuntimeEnv(cfg(raw))).toBe(expected);
  });

  it('isProduction y shouldEnableSwagger siguen al entorno', () => {
    expect(isProduction(cfg('production'))).toBe(true);
    expect(shouldEnableSwagger(cfg('production'))).toBe(false);
    expect(shouldEnableSwagger(cfg(undefined))).toBe(false);
    expect(shouldEnableSwagger(cfg('development'))).toBe(true);
    expect(shouldEnableSwagger(cfg('test'))).toBe(true);
  });
});
