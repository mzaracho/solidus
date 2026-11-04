/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { BadRequestException } from '@nestjs/common';
import { validateFeeRuleSplits } from './fee-rule-splits';

const ok = (splits: unknown) =>
  expect(() => validateFeeRuleSplits(splits)).not.toThrow();
const bad = (splits: unknown) => {
  try {
    validateFeeRuleSplits(splits);
  } catch (e: any) {
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.getResponse().message).toBe('La distribución de honorarios no es válida.');
    return;
  }
  throw new Error('no lanzó');
};

describe('validateFeeRuleSplits', () => {
  it('acepta lo que genera la UI (PayerRulesManager)', () => {
    ok([
      { role: 'PROFESSIONAL', percentage: 70, beneficiaryType: 'PROFESSIONAL' },
      { role: 'ORGANIZATION', percentage: 30, beneficiaryType: 'ORGANIZATION' },
    ]);
    ok([
      {
        role: 'PROFESSIONAL',
        percentage: 100,
        beneficiaryType: 'PROFESSIONAL',
      },
      { role: 'ORGANIZATION', percentage: 0, beneficiaryType: 'ORGANIZATION' },
    ]);
    ok([
      {
        role: 'PROFESSIONAL',
        percentage: 66.7,
        beneficiaryType: 'PROFESSIONAL',
      },
      {
        role: 'ORGANIZATION',
        percentage: 33.3,
        beneficiaryType: 'ORGANIZATION',
      },
    ]);
  });

  it('acepta la forma del motor (beneficiary/type/value)', () => {
    ok([
      { beneficiary: 'PROFESSIONAL', type: 'PERCENTAGE', value: 60 },
      { beneficiary: 'ORG', type: 'FIXED', value: 500, roleLabel: 'Fee' },
    ]);
  });

  it('rechaza lo que no es un arreglo no vacío de hasta 20 elementos', () => {
    for (const v of [
      undefined,
      null,
      {},
      'x',
      5,
      [],
      { professional: 70, org: 30 },
    ]) {
      bad(v);
    }
    bad(
      Array.from({ length: 21 }, () => ({
        percentage: 1,
        beneficiaryType: 'ORG',
      })),
    );
  });

  it('rechaza porcentajes negativos, mayores a 100, no finitos o no numéricos', () => {
    for (const percentage of [-1, 101, Infinity, NaN, '70', null, undefined]) {
      bad([{ role: 'P', percentage, beneficiaryType: 'PROFESSIONAL' }]);
    }
  });

  it('rechaza una suma de porcentajes mayor a 100', () => {
    bad([
      { role: 'P', percentage: 80, beneficiaryType: 'PROFESSIONAL' },
      { role: 'O', percentage: 30, beneficiaryType: 'ORGANIZATION' },
    ]);
    bad([
      { beneficiary: 'PROFESSIONAL', type: 'PERCENTAGE', value: 90 },
      { role: 'O', percentage: 20, beneficiaryType: 'ORG' },
    ]);
  });

  it('rechaza beneficiarios fuera del enum o con ids', () => {
    bad([{ role: 'P', percentage: 10, beneficiaryType: 'ADMIN' }]);
    bad([{ role: 'P', percentage: 10 }]);
    bad([{ beneficiary: 'OTHER', type: 'PERCENTAGE', value: 10 }]);
    bad([
      {
        role: 'P',
        percentage: 10,
        beneficiaryType: 'PROFESSIONAL',
        beneficiaryId: 'x',
      },
    ]);
    bad([
      {
        beneficiary: 'PROFESSIONAL',
        type: 'PERCENTAGE',
        value: 10,
        professionalId: 'x',
      },
    ]);
  });

  it('rechaza FIXED negativo o gigante, tipos desconocidos y claves ajenas', () => {
    bad([{ beneficiary: 'ORG', type: 'FIXED', value: -1 }]);
    bad([{ beneficiary: 'ORG', type: 'FIXED', value: 1e12 }]);
    bad([{ beneficiary: 'ORG', type: 'PERCENTAGE', value: 101 }]);
    bad([{ beneficiary: 'ORG', type: 'OTHER', value: 1 }]);
    bad([{ beneficiary: 'ORG', type: 'FIXED', value: '5' }]);
    bad([{ beneficiary: 'ORG', type: 'FIXED', value: 5, extra: true }]);
    bad(['x']);
    bad([null]);
    bad([[1]]);
  });
});
