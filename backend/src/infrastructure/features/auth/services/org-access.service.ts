import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../Prisma/prisma.service';
import { OrgRoleValue } from '@src/infrastructure.bootstrap/config/core/authentication/auth-context';

export interface OrgAccessResult {
  allowed: boolean;
  /** Rol de la membresía; null si no hay membresía (vínculo solo de Professional). */
  memberRole: OrgRoleValue | null;
}

/**
 * Consulta de pertenencia a una organización: membresía (OrganizationMember) o
 * Professional ACTIVE y no eliminado. Sin cache entre requests, para que las bajas
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
          { members: { some: { userId } } },
          {
            professionals: {
              some: { userId, deletedAt: null, status: 'ACTIVE' },
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
}
