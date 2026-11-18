import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  distributeByPercentages,
  minMoney,
  money,
  nonNegative,
  percentOf,
  roundMoney,
  sameMoney,
  sumMoney,
  toJsonNumber,
} from './money';

const strs = (xs: Prisma.Decimal[]) => xs.map((x) => x.toFixed(2));

describe('money', () => {
  it('money: null y undefined valen 0; acepta string, number y Decimal', () => {
    expect(money(null).toString()).toBe('0');
    expect(money(undefined).toString()).toBe('0');
    expect(money('12.50').toString()).toBe('12.5');
    expect(money(new Prisma.Decimal('3.1')).toString()).toBe('3.1');
  });

  it('money: un number no finito o un texto inválido dan 500 genérico', () => {
    expect(() => money(NaN)).toThrow(InternalServerErrorException);
    expect(() => money(Infinity)).toThrow(InternalServerErrorException);
    expect(() => money('abc')).toThrow(InternalServerErrorException);
  });

  it('roundMoney: HALF_UP a 2 decimales (1.005 -> 1.01)', () => {
    expect(roundMoney(1.005).toString()).toBe('1.01');
    expect(roundMoney('2.675').toString()).toBe('2.68');
    expect(roundMoney('2.674').toString()).toBe('2.67');
  });

  it('sumMoney: 0.1 + 0.2 = 0.3 exacto', () => {
    expect(sumMoney([0.1, 0.2]).toString()).toBe('0.3');
    expect(sumMoney([]).toString()).toBe('0');
    expect(toJsonNumber(sumMoney([0.1, 0.2]))).toBe(0.3);
  });

  it('percentOf: redondea el resultado al centavo', () => {
    expect(percentOf(1234.56, 10).toString()).toBe('123.46');
    expect(percentOf(100, 33.33).toString()).toBe('33.33');
    expect(percentOf(0, 50).toString()).toBe('0');
  });

  it('nonNegative y minMoney', () => {
    expect(nonNegative(-5).toString()).toBe('0');
    expect(nonNegative(5).toString()).toBe('5');
    expect(minMoney(3, 5).toString()).toBe('3');
    expect(minMoney(7, 5).toString()).toBe('5');
  });

  it('sameMoney: igualdad al centavo (100 == 100.00)', () => {
    expect(sameMoney(100, '100.00')).toBe(true);
    expect(sameMoney(12500, 12500.001)).toBe(true);
    expect(sameMoney(12500, 12500.01)).toBe(false);
  });

  it('toJsonNumber devuelve number', () => {
    expect(typeof toJsonNumber(new Prisma.Decimal('12.30'))).toBe('number');
    expect(toJsonNumber('12.30')).toBe(12.3);
  });
});

describe('distributeByPercentages', () => {
  it('100 en 3 partes iguales: 33.34 / 33.33 / 33.33', () => {
    const third = 100 / 3;
    expect(strs(distributeByPercentages(100, [third, third, third]))).toEqual([
      '33.34',
      '33.33',
      '33.33',
    ]);
  });

  it('0.05 al 50/50: 0.03 y 0.02', () => {
    expect(strs(distributeByPercentages(0.05, [50, 50]))).toEqual([
      '0.03',
      '0.02',
    ]);
  });

  it('0.1 + 0.2 como bruto 0.30 al 50/50 suma 0.30', () => {
    const r = distributeByPercentages(sumMoney([0.1, 0.2]), [50, 50]);
    expect(sumMoney(r).toString()).toBe('0.3');
  });

  it('1234.56 al 33.33/33.33/33.34 suma 1234.56', () => {
    const r = distributeByPercentages(1234.56, [33.33, 33.33, 33.34]);
    expect(sumMoney(r).toString()).toBe('1234.56');
  });

  it('33.33 x 3 sobre 100: objetivo 99.99 (queda 0.01 de resto afuera)', () => {
    const r = distributeByPercentages(100, [33.33, 33.33, 33.33]);
    expect(strs(r)).toEqual(['33.33', '33.33', '33.33']);
  });

  it('desempate por el orden de entrada', () => {
    // 0.01 en 3 partes: un solo centavo, que se lleva el primero.
    const t = 100 / 3;
    expect(strs(distributeByPercentages(0.01, [t, t, t]))).toEqual([
      '0.01',
      '0.00',
      '0.00',
    ]);
  });

  it('lista vacía', () => {
    expect(distributeByPercentages(100, [])).toEqual([]);
  });

  it('500 casos generados: Σ = T, a menos de 0.01 del exacto y ninguno negativo', () => {
    let seed = 987654321;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 500; i++) {
      const total = new Prisma.Decimal(Math.round(rnd() * 10_000_000)).div(100);
      const n = 1 + Math.floor(rnd() * 5);
      const raw = Array.from({ length: n }, () => rnd() + 0.01);
      const sum = raw.reduce((a, b) => a + b, 0);
      const pcts = raw.map((r) =>
        new Prisma.Decimal((r / sum) * 100).toDecimalPlaces(2),
      );
      const out = distributeByPercentages(total, pcts);
      const sumPct = sumMoney(pcts);
      expect(
        sumMoney(out).equals(total.mul(sumPct).div(100).toDecimalPlaces(2)),
      ).toBe(true);
      out.forEach((o, k) => {
        expect(o.isNegative()).toBe(false);
        const exact = total.mul(pcts[k]).div(100);
        expect(o.sub(exact).abs().lessThan('0.01')).toBe(true);
      });
    }
  });
});
