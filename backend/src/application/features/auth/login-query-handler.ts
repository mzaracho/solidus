import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { LoginResponseDto } from './dtos/login-response-dto';
import { isProfessionalMode, ROLE_CODE } from '@src/domain/constants/app.constants';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';

type UserWithRelations = Prisma.UserGetPayload<{
  include: {
    userRoles: {
      include: {
        role: true;
      };
    };
    memberships: true;
  };
}>;

// Hash ficticio (se genera una vez, de forma perezosa) para igualar el tiempo de respuesta
// cuando el usuario no existe: así no se puede enumerar usuarios midiendo la latencia.
let dummyHash: Promise<string> | null = null;
const getDummyHash = (): Promise<string> => {
  dummyHash ??= bcrypt.hash(randomBytes(16).toString('hex'), 10);
  return dummyHash;
};

const invalidCredentials = () =>
  new UnauthorizedException({
    code: 'unauthorized',
    message: 'Unauthorized',
  });

export class LoginQuery implements IRequest {
  constructor(
    readonly user: string,
    readonly password: string,
  ) { }
}

@Injectable()
@RequestHandler(LoginQuery)
export class LoginQueryHandler implements IRequestHandler<
  LoginQuery,
  LoginResponseDto
> {
  // Manual injection might be tricky depending on how Dispatcher works,
  // but usually Handlers are registered in Module providers.
  // If Dispatcher instantiates them, we need to check Dispatcher logic.
  // Assuming Dispatcher resolves from ModuleRef or similar.
  // Ideally Handlers should be Injectable.

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) { }

  public async execute(query: LoginQuery): Promise<LoginResponseDto> {
    if (!query.user || !query.password) {
      throw new BadRequestException('User and password are required');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: query.user },
      include: {
        userRoles: {
          include: {
            role: true,
          },
        },
        memberships: true,
      },
    });

    // Un usuario dado de baja se trata como inexistente: mismo camino, mismo 401 y mismo costo.
    if (!user || user.deletedAt !== null || !user.passwordHash) {
      await bcrypt.compare(query.password, await getDummyHash());
      throw invalidCredentials();
    }

    const isMatch = await bcrypt.compare(query.password, user.passwordHash);
    if (!isMatch) {
      throw invalidCredentials();
    }

    // Map roles to simple objects
    const userTyped = user as unknown as UserWithRelations;

    const roles = userTyped.userRoles.map((ur) => ({
      code: ur.role.code,
      name: ur.role.name,
    }));

    // Extract Org Role (MVP: Take first membership)
    const orgRole =
      userTyped.memberships.length > 0 ? userTyped.memberships[0].role : null;

    // [FIX] Extract Organization ID for Frontend Headers
    let organizationId =
      userTyped.memberships.length > 0 ? userTyped.memberships[0].organizationId : null;

    // [NEW] Fetch Professional Profile if exists
    let professionalId: string | null = null;
    if (organizationId) {
      const pro = await this.prisma.professional.findFirst({
        where: {
          userId: user.id,
          organizationId: organizationId,
          deletedAt: null,
          status: 'ACTIVE',
        },
      });
      if (pro) professionalId = pro.id;
    } else {
      const pro = await this.prisma.professional.findFirst({
        where: { userId: user.id, deletedAt: null, status: 'ACTIVE' },
      });
      if (pro) {
        professionalId = pro.id;
        organizationId = pro.organizationId;
      }
    }

    const roleCodes = roles.map((r) => r.code);
    const payload = {
      sub: user.id,
      name: user.name,
      email: user.email,
      roles: roles,
      orgRole: orgRole,
      organizationId: organizationId,
      professionalId: professionalId,
    };

    const initialRole = roleCodes.length > 0 ? roleCodes[0] : ROLE_CODE.ADMIN;
    const type = isProfessionalMode(initialRole) ? 'pro' : 'org';

    return {
      id: user.id,
      type: type,
      name: user.name,
      email: user.email,
      settings: { theme: 'light', notifications: true },
      roles: roles,
      orgRole: orgRole,
      professionalId: professionalId, // Added to Response
      token: this.jwtService.sign(payload),
    };
  }
}
