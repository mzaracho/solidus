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
    expect(e.getResponse().message).toBe(
      'La distribución de honorarios no es válida.',
    );
    return;
  }
  throw new Error('no lanzó');
};

describe('validateFeeRuleSplits (forma única del motor)', () => {
  it('acepta la forma del motor (beneficiary/type/value)', () => {
    ok([
      { beneficiary: 'PROFESSIONAL', type: 'PERCENTAGE', value: 60 },
      { beneficiary: 'ORG', type: 'FIXED', value: 500, roleLabel: 'Fee' },
    ]);
    ok([
      {
        beneficiary: 'PROFESSIONAL',
        type: 'PERCENTAGE',
        value: 66.7,
        roleLabel: 'Pro',
      },
      { beneficiary: 'ORG', type: 'PERCENTAGE', value: 33.3, roleLabel: 'Org' },
    ]);
    ok([{ beneficiary: 'ORG', type: 'FIXED', value: 12.34 }]);
  });

  it('rechaza la forma vieja de la UI (role/percentage/beneficiaryType)', () => {
    bad([
      { role: 'PROFESSIONAL', percentage: 70, beneficiaryType: 'PROFESSIONAL' },
      { role: 'ORGANIZATION', percentage: 30, beneficiaryType: 'ORGANIZATION' },
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
        beneficiary: 'ORG',
        type: 'PERCENTAGE',
        value: 1,
      })),
    );
  });

  it('rechaza porcentajes negativos, mayores a 100, no finitos o no numéricos', () => {
    for (const value of [-1, 101, Infinity, NaN, '70', null, undefined]) {
      bad([{ beneficiary: 'PROFESSIONAL', type: 'PERCENTAGE', value }]);
    }
  });

  it('rechaza una suma de porcentajes mayor a 100', () => {
    bad([
      { beneficiary: 'PROFESSIONAL', type: 'PERCENTAGE', value: 80 },
      { beneficiary: 'ORG', type: 'PERCENTAGE', value: 30 },
    ]);
  });

  it('rechaza beneficiarios fuera del enum o con ids', () => {
    bad([{ beneficiary: 'OTHER', type: 'PERCENTAGE', value: 10 }]);
    bad([{ beneficiary: 'ORGANIZATION', type: 'PERCENTAGE', value: 10 }]);
    bad([
      {
        beneficiary: 'PROFESSIONAL',
        type: 'PERCENTAGE',
        value: 10,
        professionalId: 'x',
      },
    ]);
  });

  it('rechaza FIXED negativo, gigante o con más de 2 decimales, tipos desconocidos y claves ajenas', () => {
    bad([{ beneficiary: 'ORG', type: 'FIXED', value: -1 }]);
    bad([{ beneficiary: 'ORG', type: 'FIXED', value: 1e12 }]);
    bad([{ beneficiary: 'ORG', type: 'FIXED', value: 10.123 }]);
    bad([{ beneficiary: 'ORG', type: 'PERCENTAGE', value: 101 }]);
    bad([{ beneficiary: 'ORG', type: 'OTHER', value: 1 }]);
    bad([{ beneficiary: 'ORG', type: 'FIXED', value: '5' }]);
    bad([{ beneficiary: 'ORG', type: 'FIXED', value: 5, extra: true }]);
    bad(['x']);
    bad([null]);
    bad([[1]]);
  });
});
