import { InternalServerErrorException } from '@nestjs/common';
import { normalizeSplitDefinitions } from './split-definition';

describe('normalizeSplitDefinitions', () => {
  it('normaliza la forma vieja de la UI a la del motor', () => {
    expect(
      normalizeSplitDefinitions([
        { role: 'Pro', percentage: 70, beneficiaryType: 'PROFESSIONAL' },
        { role: 'Org', percentage: 30, beneficiaryType: 'ORGANIZATION' },
        { role: 'Org2', percentage: 0, beneficiaryType: 'ORG' },
      ]),
    ).toEqual([
      {
        beneficiary: 'PROFESSIONAL',
        type: 'PERCENTAGE',
        value: 70,
        roleLabel: 'Pro',
      },
      { beneficiary: 'ORG', type: 'PERCENTAGE', value: 30, roleLabel: 'Org' },
      { beneficiary: 'ORG', type: 'PERCENTAGE', value: 0, roleLabel: 'Org2' },
    ]);
  });

  it('deja igual la forma del motor', () => {
    const engine = [
      {
        beneficiary: 'PROFESSIONAL',
        type: 'PERCENTAGE',
        value: 60,
        roleLabel: 'A',
      },
      { beneficiary: 'ORG', type: 'FIXED', value: 500, roleLabel: undefined },
    ];
    expect(normalizeSplitDefinitions(engine)).toEqual(engine);
  });

  it('un JSON que no es ninguna de las dos formas: 500 controlado', () => {
    for (const bad of [
      null,
      {},
      'x',
      [null],
      [{}],
      [{ percentage: 'x', beneficiaryType: 'ORG' }],
      [{ beneficiary: 'OTHER', type: 'PERCENTAGE', value: 1 }],
      [{ beneficiary: 'ORG', type: 'FIXED', value: NaN }],
    ]) {
      expect(() => normalizeSplitDefinitions(bad)).toThrow(
        InternalServerErrorException,
      );
    }
  });
});
