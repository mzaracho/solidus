/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { errorOf } from '../../../../test/helpers/scope';
import { FeeResolutionService } from './fee-resolution.service';

const PRO = 'pro-1';

interface Setup {
  orgType?: 'CLINIC' | 'SOLO_PRACTICE';
  rules?: any[];
  payer?: any;
  professional?: any;
}

const build = (s: Setup = {}) => {
  const prisma: any = {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ type: s.orgType ?? 'CLINIC' }),
    },
    feeRule: { findMany: jest.fn().mockResolvedValue(s.rules ?? []) },
    payer: { findUnique: jest.fn().mockResolvedValue(s.payer ?? null) },
    professional: {
      findUnique: jest.fn().mockResolvedValue(s.professional ?? null),
    },
  };
  return new FeeResolutionService(prisma);
};

const ctx = (grossAmount: any, extra: any = {}): any => ({
  organizationId: 'org-1',
  payerId: 'payer-1',
  professionalId: PRO,
  professionalCategory: null,
  eventRole: 'TITULAR',
  serviceType: 'Sesión',
  grossAmount,
  ...extra,
});

const rule = (splits: any, extra: any = {}) => ({
  id: randomUUID(),
  payerId: null,
  professionalCategory: null,
  serviceType: null,
  conditionProfessionalRole: null,
  validFrom: new Date('2020-01-01'),
  splits,
  ...extra,
});

/** Resumen comparable: [tipo, beneficiario, monto como string, etiqueta]. */
const summary = (rows: any[]) =>
  rows.map((r) => [
    r.beneficiaryType,
    r.beneficiaryId,
    String(r.amount),
    r.roleLabel,
  ]);

const engine = (
  beneficiary: string,
  type: string,
  value: number,
  roleLabel?: string,
) => ({
  beneficiary,
  type,
  value,
  roleLabel,
});

describe('FeeResolutionService.calculateSplits', () => {
  it('organización inexistente: 500 controlado, sin el id en el mensaje', async () => {
    const organizationId = randomUUID();
    const prisma: any = {
      organization: { findUnique: jest.fn().mockResolvedValue(null) },
      feeRule: { findMany: jest.fn() },
    };
    const service = new FeeResolutionService(prisma);
    const e = await errorOf(() =>
      service.calculateSplits({
        organizationId,
        payerId: randomUUID(),
        amount: 100,
      } as any),
    );
    expect(e).toBeInstanceOf(InternalServerErrorException);
    expect((e as Error).message).not.toContain(organizationId);
    expect(prisma.feeRule.findMany).not.toHaveBeenCalled();
  });

  describe('regresión (criterio 6): reglas existentes', () => {
    it('regla 70/30 (forma del motor)', async () => {
      const s = build({
        rules: [
          rule([
            engine('PROFESSIONAL', 'PERCENTAGE', 70, 'Pro'),
            engine('ORG', 'PERCENTAGE', 30, 'Org'),
          ]),
        ],
      });
      const r = await s.calculateSplits(ctx(1000));
      expect(summary(r)).toEqual([
        ['PROFESSIONAL', PRO, '700', 'Pro'],
        ['ORG', null, '300', 'Org'],
      ]);
    });

    it('regla 70 % con resto a la organización', async () => {
      const s = build({
        rules: [rule([engine('PROFESSIONAL', 'PERCENTAGE', 70, 'Pro')])],
      });
      const r = await s.calculateSplits(ctx(1000));
      expect(summary(r)).toEqual([
        ['PROFESSIONAL', PRO, '700', 'Pro'],
        ['ORG', null, '300', 'Remainder'],
      ]);
    });

    it('33.33 x 3 sobre 100: tres de 33.33 y resto 0.01', async () => {
      const s = build({
        rules: [
          rule(
            [1, 2, 3].map(() =>
              engine('PROFESSIONAL', 'PERCENTAGE', 33.33, 'x'),
            ),
          ),
        ],
      });
      const r = await s.calculateSplits(ctx(100));
      expect(r.map((x) => String(x.amount))).toEqual([
        '33.33',
        '33.33',
        '33.33',
        '0.01',
      ]);
    });

    it('FIXED dentro del bruto', async () => {
      const s = build({
        rules: [rule([engine('PROFESSIONAL', 'FIXED', 400, 'Fijo')])],
      });
      const r = await s.calculateSplits(ctx(1000));
      expect(summary(r)).toEqual([
        ['PROFESSIONAL', PRO, '400', 'Fijo'],
        ['ORG', null, '600', 'Remainder'],
      ]);
    });

    it('retención 10 % sobre 1234.56 (sin regla)', async () => {
      const s = build({ payer: { name: 'OSDE', retentionPercentage: 10 } });
      const r = await s.calculateSplits(ctx(1234.56));
      expect(summary(r)).toEqual([
        ['ORG', null, '123.46', 'Retención OSDE (10%)'],
        ['PROFESSIONAL', PRO, '1111.1', 'Honorario Profesional'],
      ]);
    });

    it('SOLO_PRACTICE sin retención: 100 % al profesional', async () => {
      const s = build({
        orgType: 'SOLO_PRACTICE',
        payer: { name: 'P', retentionPercentage: 0 },
      });
      const r = await s.calculateSplits(ctx(500));
      expect(summary(r)).toEqual([
        ['PROFESSIONAL', PRO, '500', 'Honorario (Solo Practice)'],
      ]);
    });

    it('CLINIC con categoría 60 %', async () => {
      const s = build({
        payer: { name: 'P', retentionPercentage: null },
        professional: { category: { name: 'Senior', percentage: 60 } },
      });
      const r = await s.calculateSplits(ctx(1000));
      expect(summary(r)).toEqual([
        ['PROFESSIONAL', PRO, '600', 'Honorario (Senior - 60%)'],
        ['ORG', null, '400', 'Comisión Organización (40%)'],
      ]);
    });

    it('sin regla ni categoría: 100 % a la organización', async () => {
      const s = build({
        payer: { name: 'P', retentionPercentage: null },
        professional: { category: null },
      });
      const r = await s.calculateSplits(ctx(750));
      expect(summary(r)).toEqual([['ORG', null, '750', 'Default (No Rule)']]);
    });

    it('sin regla aplicable (la "all" no llega al motor): usa la retención del pagador', async () => {
      const s = build({
        payer: { name: 'OSDE', retentionPercentage: 20 },
        rules: [],
      });
      const r = await s.calculateSplits(ctx(100));
      expect(r.map((x) => String(x.amount))).toEqual(['20', '80']);
    });

    it('prioridad: en CLINIC la regla con categoría pesa más que la del pagador', async () => {
      const byPayer = rule(
        [engine('PROFESSIONAL', 'PERCENTAGE', 10, 'payer')],
        { payerId: 'payer-1' },
      );
      const byCategory = rule(
        [engine('PROFESSIONAL', 'PERCENTAGE', 20, 'cat')],
        {
          professionalCategory: 'Senior',
        },
      );
      const s = build({ rules: [byPayer, byCategory] });
      const r = await s.calculateSplits(
        ctx(100, { professionalCategory: 'Senior' }),
      );
      expect(r[0].roleLabel).toBe('cat');
    });

    it('prioridad: en SOLO_PRACTICE pesa el pagador; empate por validFrom más reciente', async () => {
      const byPayer = rule(
        [engine('PROFESSIONAL', 'PERCENTAGE', 10, 'payer')],
        { payerId: 'payer-1' },
      );
      const old = rule([engine('PROFESSIONAL', 'PERCENTAGE', 50, 'old')]);
      const recent = rule(
        [engine('PROFESSIONAL', 'PERCENTAGE', 60, 'recent')],
        {
          validFrom: new Date('2024-01-01'),
        },
      );
      let s = build({
        orgType: 'SOLO_PRACTICE',
        rules: [old, byPayer, recent],
      });
      expect((await s.calculateSplits(ctx(100)))[0].roleLabel).toBe('payer');
      s = build({ orgType: 'SOLO_PRACTICE', rules: [old, recent] });
      expect((await s.calculateSplits(ctx(100)))[0].roleLabel).toBe('recent');
    });

    it('prioridad: ADMISION da peso al rol de la condición', async () => {
      const byRole = rule([engine('PROFESSIONAL', 'PERCENTAGE', 5, 'rol')], {
        conditionProfessionalRole: 'TITULAR',
      });
      const byPayer = rule(
        [engine('PROFESSIONAL', 'PERCENTAGE', 90, 'payer')],
        { payerId: 'payer-1' },
      );
      const s = build({ rules: [byPayer, byRole] });
      const r = await s.calculateSplits(
        ctx(100, { serviceType: 'ADMISION inicial' }),
      );
      expect(r[0].roleLabel).toBe('rol');
    });
  });

  describe('centavos y tope (criterios 3 y 7)', () => {
    const amounts = async (splits: any[], gross: any) =>
      (await build({ rules: [rule(splits)] }).calculateSplits(ctx(gross))).map(
        (x) => String(x.amount),
      );

    it('0.05 al 50/50: 0.03 y 0.02 (suma el bruto)', async () => {
      const r = await amounts(
        [
          engine('PROFESSIONAL', 'PERCENTAGE', 50),
          engine('ORG', 'PERCENTAGE', 50),
        ],
        0.05,
      );
      expect(r).toEqual(['0.03', '0.02']);
    });

    it('1234.56 al 33.33/33.33/33.34 suma exacto', async () => {
      const rows = await build({
        rules: [
          rule([
            engine('PROFESSIONAL', 'PERCENTAGE', 33.33),
            engine('ORG', 'PERCENTAGE', 33.33),
            engine('ORG', 'PERCENTAGE', 33.34),
          ]),
        ],
      }).calculateSplits(ctx(1234.56));
      const cents = rows.reduce(
        (a, r) => a + Math.round(Number(r.amount) * 100),
        0,
      );
      expect(cents).toBe(123456);
    });

    it('FIXED 0.1 + FIXED 0.2 sobre 0.30: suma exacta, sin resto', async () => {
      const r = await amounts(
        [engine('PROFESSIONAL', 'FIXED', 0.1), engine('ORG', 'FIXED', 0.2)],
        0.3,
      );
      expect(r).toEqual(['0.1', '0.2']);
    });

    it('FIXED mayor que el bruto se limita al bruto', async () => {
      expect(
        await amounts([engine('PROFESSIONAL', 'FIXED', 1500)], 1000),
      ).toEqual(['1000']);
    });

    it('dos FIXED que juntos superan el bruto: 600 + 400', async () => {
      expect(
        await amounts(
          [engine('PROFESSIONAL', 'FIXED', 600), engine('ORG', 'FIXED', 600)],
          1000,
        ),
      ).toEqual(['600', '400']);
    });

    it('FIXED 300 y después 100 %: 300 + 700', async () => {
      expect(
        await amounts(
          [
            engine('ORG', 'FIXED', 300),
            engine('PROFESSIONAL', 'PERCENTAGE', 100),
          ],
          1000,
        ),
      ).toEqual(['300', '700']);
    });

    it('un monto acotado a 0 conserva la fila con 0', async () => {
      expect(
        await amounts(
          [
            engine('ORG', 'FIXED', 1000),
            engine('PROFESSIONAL', 'PERCENTAGE', 50),
          ],
          1000,
        ),
      ).toEqual(['1000', '0']);
    });

    it('nunca asigna más que el bruto y la suma de porcentajes es exacta (valores generados)', async () => {
      let seed = 12345;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      for (let i = 0; i < 300; i++) {
        const gross = Math.round(rnd() * 1_000_000) / 100;
        const n = 1 + Math.floor(rnd() * 4);
        const defs: any[] = [];
        let left = 100;
        for (let k = 0; k < n; k++) {
          if (rnd() < 0.3) {
            defs.push(
              engine('ORG', 'FIXED', Math.round(rnd() * 200_000) / 100),
            );
          } else {
            const p = Math.round(rnd() * left * 100) / 100;
            left -= p;
            defs.push(engine('PROFESSIONAL', 'PERCENTAGE', p));
          }
        }
        const rows = await build({ rules: [rule(defs)] }).calculateSplits(
          ctx(gross),
        );
        const cents = rows.reduce(
          (a, r) => a + Math.round(Number(r.amount) * 100),
          0,
        );
        expect(cents).toBeLessThanOrEqual(Math.round(gross * 100));
        rows.forEach((r) => expect(Number(r.amount)).toBeGreaterThanOrEqual(0));
      }
    });
  });

  describe('forma única de splits (criterio 5)', () => {
    it('una regla en la forma vieja de la UI 70/30 da lo mismo que la del motor', async () => {
      const ui = [
        { role: 'Pro', percentage: 70, beneficiaryType: 'PROFESSIONAL' },
        { role: 'Org', percentage: 30, beneficiaryType: 'ORGANIZATION' },
      ];
      const r = await build({ rules: [rule(ui)] }).calculateSplits(ctx(1000));
      expect(summary(r)).toEqual([
        ['PROFESSIONAL', PRO, '700', 'Pro'],
        ['ORG', null, '300', 'Org'],
      ]);
    });

    it('un JSON que no es ninguna de las dos formas: 500 controlado', async () => {
      const e = await errorOf(() =>
        build({ rules: [rule([{ foo: 'bar' }])] }).calculateSplits(ctx(100)),
      );
      expect(e).toBeInstanceOf(InternalServerErrorException);
    });
  });
});
