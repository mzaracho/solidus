import {
  ArgumentMetadata,
  BadRequestException,
  INestApplication,
  PipeTransform,
  ValidationPipe,
  ValidationPipeOptions,
} from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/** Mensaje genérico de `forbidNonWhitelisted`: no refleja el nombre de la clave que mandó el cliente. */
export const NON_WHITELISTED_MESSAGE =
  'El cuerpo contiene campos no permitidos.';

/**
 * Aplana los errores de class-validator como el pipe de Nest, pero cambia el mensaje de campo no declarado
 * (constraint `whitelistValidation`) por uno genérico en español. Sin dependencias del valor ni de la clave enviada.
 */
function flattenErrors(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => {
    const own = Object.entries(error.constraints ?? {}).map(([key, message]) =>
      key === 'whitelistValidation'
        ? NON_WHITELISTED_MESSAGE
        : `${prefix}${message}`,
    );
    const children = error.children?.length
      ? flattenErrors(error.children, `${prefix}${error.property}.`)
      : [];
    return [...own, ...children];
  });
}

const baseOptions: ValidationPipeOptions = {
  transform: true,
  // Se descarta lo que el DTO no declara con class-validator (toda propiedad con decorador cuenta).
  whitelist: true,
  // Un body que no es objeto (array, primitivo) o una clase sin metadata de class-validator: 400.
  forbidUnknownValues: true,
  // Sin conversión implícita: un número u objeto en un campo string da 400. Los números de query llevan
  // @Type(() => Number) explícito.
  transformOptions: { enableImplicitConversion: false },
  // Los errores de validación no cargan el objeto ni el valor enviados.
  validationError: { target: false, value: false },
};

/**
 * Validación global de requests (feature 014):
 *  - body: whitelist + forbidNonWhitelisted (un campo no declarado da 400);
 *  - query: whitelist sin forbidNonWhitelisted (lo no declarado se descarta). `mode`, `orgId` y
 *    `organizationId` los leen los guards sobre el request crudo, antes del pipe, y ningún DTO los declara.
 * El resto (`param`, `custom`) no se valida: sus ids se verifican en los handlers (requireId, 404 genérico).
 */
export class RequestValidationPipe implements PipeTransform {
  private readonly strict = new ValidationPipe({
    ...baseOptions,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException([...new Set(flattenErrors(errors))]),
  });
  private readonly lenient = new ValidationPipe({
    ...baseOptions,
    forbidNonWhitelisted: false,
  });

  transform(value: unknown, metadata: ArgumentMetadata) {
    const pipe = metadata.type === 'body' ? this.strict : this.lenient;
    return pipe.transform(value, metadata);
  }
}

export const configurePipes = (app: INestApplication) => {
  app.useGlobalPipes(new RequestValidationPipe());
};
