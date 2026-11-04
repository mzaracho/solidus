import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import {
  OrgScope,
  roleIn,
} from '@src/infrastructure.bootstrap/config/core/cqrs/request-context';
import { resourceNotFound } from '@src/infrastructure.bootstrap/config/core/authentication/org-resource';

/**
 * Lectura de un paciente por id (resumen, deuda). Con membresia en la organizacion del paciente (ADMIN o
 * MEMBER) alcanza el filtro de organizacion que ya aplica el handler. Con vinculo solo de Professional
 * (sin membresia), el paciente tiene que ser alguien que el usuario atendio (atencion propia o como
 * participante) o, si tiene permiso de carga en esa organizacion, cualquiera de ella (en linea con la
 * lista de pacientes en vista pro). Lo demas da el mismo 404 generico que un paciente de otra organizacion.
 *
 * Devuelve a que atenciones se acota la lectura: `null` para un miembro (ve las del paciente en su
 * organizacion, como siempre) y, sin membresia, los ids de SUS Professional (aun con permiso de carga:
 * montos, pagador y servicio de otros profesionales no se exponen).
 */
export async function assertPatientReadable(
  prisma: PrismaService,
  scope: OrgScope,
  patient: { id: string; organizationId: string },
): Promise<string[] | null> {
  if (roleIn(scope, patient.organizationId) !== null) return null;

  const own = await prisma.professional.findMany({
    where: {
      userId: scope.userId,
      organizationId: patient.organizationId,
      status: 'ACTIVE',
      deletedAt: null,
    },
    select: { id: true, canLoadActivities: true },
  });
  if (own.length === 0) throw resourceNotFound();
  const ids = own.map((p) => p.id);
  if (own.some((p) => p.canLoadActivities)) return ids;
  const attended = await prisma.workItem.findFirst({
    where: {
      patientId: patient.id,
      OR: [
        { professionalId: { in: ids } },
        { participants: { some: { professionalId: { in: ids } } } },
      ],
    },
    select: { id: true },
  });
  if (!attended) throw resourceNotFound();
  return ids;
}

/** Filtro de WorkItem: atenciones propias o donde el usuario participa (lectura de quien no es miembro). */
export function ownProfessionalsFilter(ids: string[]) {
  return {
    OR: [
      { professionalId: { in: ids } },
      { participants: { some: { professionalId: { in: ids } } } },
    ],
  };
}
