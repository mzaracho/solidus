import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../config/app/jwt-config';
import {
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  getAllowedOrigins,
  isAllowedOrigin,
  readSessionCookie,
} from '../config/app/auth-cookie-config';
import { PUBLIC_KEY } from '../config/core/authentication/public-decorator';
import {
  AUTH_ERROR_CODE,
  AuthenticatedRequest,
  JwtPayload,
  UUID_REGEX,
} from '../config/core/authentication/auth-context';

const MAX_AUTH_HEADER_LENGTH = 4096;
const BEARER_REGEX =
  /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const forbidden = () =>
  new ForbiddenException({
    code: AUTH_ERROR_CODE.FORBIDDEN,
    message: 'Forbidden',
  });

const unauthorized = () =>
  new UnauthorizedException({
    code: AUTH_ERROR_CODE.UNAUTHORIZED,
    message: 'Unauthorized',
  });

/**
 * Guard global (APP_GUARD): toda ruta exige un JWT válido salvo las marcadas con @Public().
 * Verifica firma, expiración, algoritmo, issuer y audience, y que el usuario exista y no esté dado de baja. Cualquier fallo responde 401
 * genérico, sin detalles del error de verificación ni el token.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private readonly logger = new Logger('AuthenticationGuard');

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers?.authorization;
    let token: string;
    let source: 'bearer' | 'cookie';
    if (header !== undefined) {
      // Con Authorization presente tiene que ser un Bearer válido: no se cae a la cookie.
      if (
        typeof header !== 'string' ||
        header.length > MAX_AUTH_HEADER_LENGTH
      ) {
        throw unauthorized();
      }
      const match = BEARER_REGEX.exec(header);
      if (!match) throw unauthorized();
      token = match[1];
      source = 'bearer';
    } else {
      const cookieToken = readSessionCookie(request.headers?.cookie);
      if (cookieToken === null) throw unauthorized();
      token = cookieToken;
      source = 'cookie';
      // Antes de verificar el JWT: un request rechazado no consulta la base.
      this.assertCsrf(request);
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
    } catch {
      throw unauthorized();
    }

    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      !UUID_REGEX.test(payload.sub.toLowerCase()) ||
      typeof payload.exp !== 'number'
    ) {
      throw unauthorized();
    }

    // Baja inmediata: el token no basta, el usuario debe existir y no estar dado de baja.
    // Consulta por clave primaria en cada request, sin cache entre requests.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, deletedAt: true },
    });
    if (!user || user.deletedAt !== null) throw unauthorized();

    request.auth = { userId: payload.sub, claims: payload, source };
    // Defensa en profundidad: quien lea el header obtiene la identidad verificada.
    request.headers['x-user-id'] = payload.sub;
    return true;
  }

  /** CSRF de la cookie: solo escrituras. Header propio (obliga a preflight CORS) y Origin permitido. */
  private assertCsrf(request: AuthenticatedRequest): void {
    if (SAFE_METHODS.has((request.method ?? '').toUpperCase())) return;
    if (request.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
      this.logger.warn('csrf: missing header');
      throw forbidden();
    }
    if (
      !isAllowedOrigin(request.headers.origin, getAllowedOrigins(this.config))
    ) {
      this.logger.warn('csrf: origin not allowed');
      throw forbidden();
    }
  }
}
