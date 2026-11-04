import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../Prisma/prisma.service';
import {
  OrgRoleValue,
  OwnProfessional,
} from '@src/infrastructure.bootstrap/config/core/authentication/auth-context';
import { OrgType } from '@prisma/client';

export interface OrgAccessResult {
  allowed: boolean;
  /** Rol de la membresía; null si no hay membresía (vínculo solo de Professional). */
  memberRole: OrgRoleValue | null;
}

/**
 * Consulta de pertenencia a una organización: membresía (OrganizationMember) o
 * Professional ACTIVE y no eliminado, siempre que el usuario no esté dado de baja. Sin cache entre requests, para que las bajas
 * se apliquen de inmediato.
 */
@Injectable()
export class OrgAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getAccess(userId: string, orgId: string): Promise<OrgAccessResult> {
    const org = await this.prisma.organization.findFirst({
      where: {
        id: orgId,
        OR: [
          { members: { some: { userId, user: { deletedAt: null } } } },
          {
            professionals: {
              some: {
                userId,
                deletedAt: null,
                status: 'ACTIVE',
                user: { deletedAt: null },
              },
            },
          },
        ],
      },
      select: {
        members: { where: { userId }, select: { role: true }, take: 1 },
      },
    });
    if (!org) return { allowed: false, memberRole: null };
    return {
      allowed: true,
      memberRole: (org.members[0]?.role as OrgRoleValue | undefined) ?? null,
    };
  }

  /**
   * Professional del usuario con vínculo activo (ACTIVE, no eliminado, usuario no dado de baja), en cualquier
   * organización. Es la misma regla de getAccess, y la base de la vista pro (009).
   */
  async getActiveProfessionals(userId: string): Promise<OwnProfessional[]> {
    const rows = await this.prisma.professional.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        deletedAt: null,
        user: { deletedAt: null },
      },
      select: { id: true, organizationId: true, canLoadActivities: true },
    });
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      canLoadActivities: r.canLoadActivities,
    }));
  }

  /** Tipo de la organización (solo para la excepción SOLO_PRACTICE del modo efectivo). */
  async getOrgType(orgId: string): Promise<OrgType | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { type: true },
    });
    return org?.type ?? null;
  }
}
