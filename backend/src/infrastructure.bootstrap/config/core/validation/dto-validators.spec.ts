import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MAX_MONEY_AMOUNT } from '@src/domain/constants/app.constants';
import {
  IsEntityId,
  IsMoney,
  IsOptionalDateString,
  IsOptionalEntityId,
  IsPercentage,
} from './dto-validators';

class Sample {
  @IsEntityId() id?: string;
  @IsOptionalEntityId() optionalId?: string | null;
  @IsOptionalDateString() day?: string | null;
  @IsMoney() amount?: number;
  @IsPercentage() pct?: number;
}

const UUID = '3f2b8c1e-0a4d-4b7e-9c11-5d6e7f8a9b0c';

const errorsFor = (plain: Record<string, unknown>) =>
  validateSync(plainToInstance(Sample, plain), {
    skipUndefinedProperties: true,
  })
    .map((e) => e.property)
    .sort();

describe('dto-validators', () => {
  it('IsEntityId acepta UUID en minúsculas, mayúsculas y ids sueltos de seed; rechaza el resto', () => {
    expect(errorsFor({ id: UUID })).toEqual([]);
    expect(errorsFor({ id: UUID.toUpperCase() })).toEqual([]);
    expect(errorsFor({ id: '11111111-1111-1111-1111-111111111111' })).toEqual(
      [],
    );
    for (const bad of ['x', '', 5, null, {}, ['a'], `${UUID}0`]) {
      expect(errorsFor({ id: bad })).toEqual(['id']);
    }
  });

  it('IsOptionalEntityId trata undefined, null y "" como ausente y valida el resto', () => {
    for (const ok of [undefined, null, '', UUID]) {
      expect(errorsFor({ optionalId: ok })).toEqual([]);
    }
    for (const bad of ['x', 5, {}, ' ']) {
      expect(errorsFor({ optionalId: bad })).toEqual(['optionalId']);
    }
  });

  it('IsOptionalDateString acepta ausente, ISO estricto y rechaza fechas imposibles o con otro formato', () => {
    for (const ok of [
      undefined,
      null,
      '',
      '2026-02-28',
      '2026-02-28T10:00:00.000Z',
    ]) {
      expect(errorsFor({ day: ok })).toEqual([]);
    }
    for (const bad of ['2026-02-30', '31/12/2026', 'ayer', 5]) {
      expect(errorsFor({ day: bad })).toEqual(['day']);
    }
  });

  it('IsMoney: número finito de 0 al tope de Decimal(10,2), sin exigir 2 decimales', () => {
    for (const ok of [0, 10, 0.1 * 3, MAX_MONEY_AMOUNT]) {
      expect(errorsFor({ amount: ok })).toEqual([]);
    }
    for (const bad of [
      -0.01,
      MAX_MONEY_AMOUNT + 1,
      NaN,
      Infinity,
      '100',
      null,
      {},
    ]) {
      expect(errorsFor({ amount: bad })).toEqual(['amount']);
    }
  });

  it('IsPercentage: número finito de 0 a 100', () => {
    for (const ok of [0, 33.3, 100]) expect(errorsFor({ pct: ok })).toEqual([]);
    for (const bad of [-1, 100.01, NaN, '80']) {
      expect(errorsFor({ pct: bad })).toEqual(['pct']);
    }
  });
});
