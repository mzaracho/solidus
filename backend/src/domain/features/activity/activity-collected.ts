import { PaymentStatus, Prisma } from '@prisma/client';

/**
 * "Cobrada" (017, decisión del usuario): `paymentStatus = PAID` CON `paymentDate`. Es la misma condición que la
 * salvaguarda del borrado de atenciones. Una sola definición: el front la recibe ya calculada (`isCollected`).
 */
export const isCollected = (w: {
  paymentStatus: PaymentStatus;
  paymentDate: Date | null;
}): boolean => w.paymentStatus === PaymentStatus.PAID && w.paymentDate !== null;

/** Fragmento de `where`: la atención NO está cobrada (lo que acepta una escritura condicional). */
export const NOT_COLLECTED_WHERE = {
  NOT: { paymentStatus: PaymentStatus.PAID, paymentDate: { not: null } },
} satisfies Prisma.WorkItemWhereInput;
