/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { parseRequestedMode, resolveViewMode, ViewLinks } from './view-mode';
import { ViewModeValue } from './auth-context';

describe('parseRequestedMode', () => {
  it.each([undefined, null, '', '   '])('ausente (%p) -> null', (v) => {
    expect(parseRequestedMode(v, undefined)).toBeNull();
    expect(parseRequestedMode(undefined, v)).toBeNull();
    expect(parseRequestedMode(v, v)).toBeNull();
  });

  it.each([
    ['org', 'org'],
    ['ORG', 'org'],
    ['organization', 'org'],
    ['ORGANIZATION', 'org'],
    ['pro', 'pro'],
    ['PRO', 'pro'],
    ['professional', 'pro'],
    ['PROFESSIONAL', 'pro'],
    ['  Pro ', 'pro'],
  ])('%p se normaliza a %p (header y query)', (raw, expected) => {
    expect(parseRequestedMode(raw, undefined)).toBe(expected);
    expect(parseRequestedMode(undefined, raw)).toBe(expected);
    expect(parseRequestedMode(raw, raw)).toBe(expected);
  });

  it('header y query equivalentes en distinto formato: ok', () => {
    expect(parseRequestedMode('pro', 'PROFESSIONAL')).toBe('pro');
    expect(parseRequestedMode('org', 'ORGANIZATION')).toBe('org');
  });

  const invalid = { code: 'invalid-mode', message: 'Bad Request' };
  const expect400 = (fn: () => unknown) => {
    try {
      fn();
    } catch (e: any) {
      expect(e.getStatus()).toBe(400);
      expect(e.getResponse()).toEqual(invalid);
      return;
    }
    throw new Error('no lanzó');
  };

  it('header y query distintos: 400 invalid-mode', () => {
    expect400(() => parseRequestedMode('pro', 'ORGANIZATION'));
    expect400(() => parseRequestedMode('org', 'PROFESSIONAL'));
  });

  it('arreglo en header o query: 400', () => {
    expect400(() => parseRequestedMode(['org', 'pro'], undefined));
    expect400(() => parseRequestedMode(undefined, ['a', 'b']));
    expect400(() => parseRequestedMode(undefined, ['org']));
  });

  it('valor desconocido, objeto o número: 400', () => {
    expect400(() => parseRequestedMode('xyz', undefined));
    expect400(() => parseRequestedMode(undefined, 'xyz'));
    expect400(() => parseRequestedMode(undefined, { a: 1 }));
    expect400(() => parseRequestedMode(1, undefined));
  });
});

describe('resolveViewMode: matriz del diseño (§4.2)', () => {
  const links = (
    role: 'ADMIN' | 'MEMBER' | null,
    hasProfessional: boolean,
    soloPracticeAdmin = false,
  ): ViewLinks => ({ role, hasProfessional, soloPracticeAdmin });

  type Res = ViewModeValue | null;
  // [perfil, vínculos, pide org (común, financiera), pide pro (c, f), sin pedido (c, f)]
  const matrix: Array<[string, ViewLinks, Res, Res, Res, Res, Res, Res]> = [
    ['ADMIN', links('ADMIN', false), 'org', 'org', null, null, 'org', 'org'],
    ['MEMBER', links('MEMBER', false), 'org', null, null, null, 'org', null],
    [
      'solo Professional',
      links(null, true),
      null,
      null,
      'pro',
      'pro',
      'pro',
      'pro',
    ],
    [
      'ADMIN + Professional',
      links('ADMIN', true),
      'org',
      'org',
      'pro',
      'pro',
      'org',
      'org',
    ],
    [
      'MEMBER + Professional',
      links('MEMBER', true),
      'org',
      null,
      'pro',
      'pro',
      'org',
      'pro',
    ],
    [
      'MEMBER de X con Professional solo en otra organización',
      links('MEMBER', true),
      'org',
      null,
      'pro',
      'pro',
      'org',
      'pro',
    ],
    [
      'ADMIN de SOLO_PRACTICE sin Professional',
      links('ADMIN', false, true),
      'org',
      'org',
      'pro',
      'pro',
      'org',
      'org',
    ],
    ['ninguno', links(null, false), null, null, null, null, null, null],
  ];

  it.each(matrix)('%s', (_n, l, orgC, orgF, proC, proF, noneC, noneF) => {
    const fin = { orgRole: 'ADMIN' as const };
    expect(resolveViewMode('org', l)).toBe(orgC);
    expect(resolveViewMode('org', l, fin)).toBe(orgF);
    expect(resolveViewMode('pro', l)).toBe(proC);
    expect(resolveViewMode('pro', l, fin)).toBe(proF);
    expect(resolveViewMode(null, l)).toBe(noneC);
    expect(resolveViewMode(null, l, fin)).toBe(noneF);
  });

  it('la excepción SOLO_PRACTICE no aplica a un MEMBER sin Professional', () => {
    expect(resolveViewMode('pro', links('MEMBER', false))).toBeNull();
  });
});
