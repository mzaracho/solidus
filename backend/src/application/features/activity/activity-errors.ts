import { BadRequestException, ConflictException } from '@nestjs/common';
import { API_ERROR_CODE } from '@src/infrastructure.bootstrap/filters/error-contract';

/** 409: monto o pagador de una atención cobrada (017). Texto exacto del diseño de UX. */
export const ACTIVITY_ALREADY_COLLECTED_MESSAGE =
  'Esta atención ya está cobrada: el monto y el pagador no se pueden modificar. No se guardó ningún cambio.';

export const activityAlreadyCollected = () =>
  new ConflictException({
    code: API_ERROR_CODE.ACTIVITY_ALREADY_COLLECTED,
    message: ACTIVITY_ALREADY_COLLECTED_MESSAGE,
  });

/** 400: dejar una atención en PAID sin fecha de pago (criterio 16). */
export const paymentDateRequired = () =>
  new BadRequestException({
    code: API_ERROR_CODE.PAYMENT_DATE_REQUIRED,
    message:
      'Para marcar la atención como pagada tenés que indicar la fecha de pago.',
  });

export const amountBelowCardSurcharge = () =>
  new BadRequestException({
    code: API_ERROR_CODE.BAD_REQUEST,
    message:
      'El monto no puede ser menor que el recargo por tarjeta de la atención.',
  });
