import { applyDecorators } from '@nestjs/common';
import {
  IsDateString,
  IsNumber,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_MONEY_AMOUNT } from '@src/domain/constants/app.constants';

/** Valor ausente: undefined, null o '' (el frontend manda '' en los selects vacíos). */
const isPresent = (value: unknown) =>
  value !== undefined && value !== null && value !== '';

/**
 * Campo opcional pero NO nulable (columna Prisma sin `?`): undefined se omite; `null` y cualquier otro valor
 * pasan por los validadores de tipo que lo acompañan (null falla ahí: 400 en lugar de un 500 de Prisma).
 */
export const IsOptionalNotNull = () => ValidateIf((_o, v) => v !== undefined);

/**
 * Id de entidad (UUID). Mismo criterio que UUID_REGEX / requireId: cualquier hex 8-4-4-4-12, sin exigir
 * versión RFC ('all' rechazaría ids de seeds locales).
 */
export const IsEntityId = () => applyDecorators(IsUUID('loose'));

/** Id de entidad opcional: undefined, null y '' cuentan como ausente (como optionalId). */
export const IsOptionalEntityId = () =>
  applyDecorators(
    ValidateIf((_o, v) => isPresent(v)),
    IsUUID('loose'),
  );

/** Fecha ISO estricta opcional ('' y null cuentan como ausente; rechaza 2026-02-30). */
export const IsOptionalDateString = () =>
  applyDecorators(
    ValidateIf((_o, v) => isPresent(v)),
    IsDateString({ strict: true }),
  );

/**
 * Monto compatible con Decimal(10,2): finito, de 0 al máximo representable. Sin maxDecimalPlaces: el front
 * calcula en coma flotante y Postgres redondea a 2 decimales al guardar.
 */
export const IsMoney = () =>
  applyDecorators(
    IsNumber({ allowNaN: false, allowInfinity: false }),
    Min(0),
    Max(MAX_MONEY_AMOUNT),
  );

/** Porcentaje finito de 0 a 100. */
export const IsPercentage = () =>
  applyDecorators(
    IsNumber({ allowNaN: false, allowInfinity: false }),
    Min(0),
    Max(100),
  );
