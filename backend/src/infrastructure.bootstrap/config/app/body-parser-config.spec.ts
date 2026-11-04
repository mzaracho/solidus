import { parseBodySizeLimit } from './body-parser-config';

describe('parseBodySizeLimit', () => {
  it('sin valor (ausente o vacío) usa 1mb', () => {
    expect(parseBodySizeLimit(undefined)).toBe('1mb');
    expect(parseBodySizeLimit('')).toBe('1mb');
    expect(parseBodySizeLimit('   ')).toBe('1mb');
  });

  it.each([
    ['1mb', '1mb'],
    [' 500KB ', '500kb'],
    ['10mb', '10mb'],
    ['2.5mb', '2.5mb'],
    ['2048', '2048'],
    ['1024b', '1024b'],
  ])('acepta %p', (raw, expected) => {
    expect(parseBodySizeLimit(raw)).toBe(expected);
  });

  it.each([
    '50mb',
    '10.1mb',
    '11mb',
    '0',
    '0mb',
    '-1mb',
    'abc',
    '1gb',
    '1 m b',
    'mb',
    '1mb; drop',
    '99999999999999999999',
  ])('rechaza %p con un mensaje claro', (raw) => {
    expect(() => parseBodySizeLimit(raw)).toThrow(/BODY_SIZE_LIMIT/);
  });

  it('rechaza valores que no son texto', () => {
    expect(() => parseBodySizeLimit(5)).toThrow(/BODY_SIZE_LIMIT/);
  });
});
