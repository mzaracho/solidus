import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Helper único de aritmética de dinero (feature 017, #17). Todo cálculo de montos pasa por acá, sobre
 * `Prisma.Decimal`; la única salida a `number` es `toJsonNumber()`, solo para respuestas que ya devolvían
 * `number`. `money-invariants.spec.ts` vigila que los caminos de dinero no usen `number`.
 */
export type Money = Prisma.Decimal;
export type MoneyInput = Prisma.Decimal | number | string | null | undefined;

const Decimal = Prisma.Decimal;
const CENT = new Decimal('0.01');
const HUNDRED = new Decimal(100);
const HALF_UP = Decimal.ROUND_HALF_UP;

export const ZERO: Money = new Decimal(0);

/** null/undefined -> 0. Un number tiene que ser finito: si no, 500 genérico (estado que no debería ocurrir). */
export function money(value: MoneyInput): Money {
  if (value === null || value === undefined) return new Decimal(0);
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new InternalServerErrorException('Monto no válido en un cálculo');
  }
  try {
    return new Decimal(value);
  } catch {
    throw new InternalServerErrorException('Monto no válido en un cálculo');
  }
}

/** 2 decimales, ROUND_HALF_UP (igual que Postgres al guardar numeric(10,2) con montos >= 0). */
export function roundMoney(value: MoneyInput): Money {
  return money(value).toDecimalPlaces(2, HALF_UP);
}

export function sumMoney(values: Iterable<MoneyInput>): Money {
  let acc: Money = new Decimal(0);
  for (const v of values) acc = acc.add(money(v));
  return acc;
}

/** round(base * pct / 100). */
export function percentOf(base: MoneyInput, pct: MoneyInput): Money {
  return roundMoney(money(base).mul(money(pct)).div(HUNDRED));
}

/** round(part / whole * 100) a entero (0 si whole <= 0); para porcentajes de presentación. */
export function wholePercent(part: MoneyInput, whole: MoneyInput): Money {
  const w = money(whole);
  if (!w.greaterThan(0)) return new Decimal(0);
  return money(part).div(w).mul(HUNDRED).toDecimalPlaces(0, HALF_UP);
}

/** max(0, value). */
export function nonNegative(value: MoneyInput): Money {
  const v = money(value);
  return v.isNegative() ? new Decimal(0) : v;
}

/** min(a, b). */
export function minMoney(a: MoneyInput, b: MoneyInput): Money {
  const x = money(a);
  const y = money(b);
  return x.lessThanOrEqualTo(y) ? x : y;
}

/** Igualdad al centavo (12500 == 12500.00 == 12500.001). */
export function sameMoney(a: MoneyInput, b: MoneyInput): boolean {
  return roundMoney(a).equals(roundMoney(b));
}

/**
 * Reparto por porcentajes al centavo. El objetivo es `T = round(total * Σp / 100)` (si Σp = 100, `T = total`).
 * Cada monto es su piso a 2 decimales y los centavos que faltan para llegar a `T` van de a uno a los de mayor
 * resto; el desempate es el orden de entrada. Resultado: `Σ = T` exacto, cada monto a menos de un centavo de su
 * valor exacto y el cálculo es reproducible.
 */
export function distributeByPercentages(
  total: MoneyInput,
  percentages: readonly MoneyInput[],
): Money[] {
  const gross = roundMoney(total);
  const pcts = percentages.map((p) => money(p));
  if (pcts.length === 0) return [];
  const target = roundMoney(gross.mul(sumMoney(pcts)).div(HUNDRED));
  const exact = pcts.map((p) => gross.mul(p).div(HUNDRED));
  const floors = exact.map((e) => e.toDecimalPlaces(2, Decimal.ROUND_DOWN));
  const remainders = exact.map((e, i) => e.sub(floors[i]));
  let missing = target
    .sub(sumMoney(floors))
    .div(CENT)
    .toDecimalPlaces(0, HALF_UP)
    .toNumber();
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const c = b.r.comparedTo(a.r);
      return c !== 0 ? c : a.i - b.i;
    })
    .map((x) => x.i);
  const out = floors.slice();
  let cursor = 0;
  while (missing > 0) {
    const idx = order[cursor % order.length];
    out[idx] = out[idx].add(CENT);
    missing -= 1;
    cursor += 1;
  }
  return out;
}

/** ÚNICA salida a number, solo para respuestas que ya devolvían number (criterio 2). */
export function toJsonNumber(value: MoneyInput): number {
  return money(value).toNumber();
}
