import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../config/app/jwt-config';
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

const unauthorized = () =>
  new UnauthorizedException({
    code: AUTH_ERROR_CODE.UNAUTHORIZED,
    message: 'Unauthorized',
  });

/**
 * Guard global (APP_GUARD): toda ruta exige un JWT válido salvo las marcadas con @Public().
 * Verifica firma, expiración, algoritmo, issuer y audience. Cualquier fallo responde 401
 * genérico, sin detalles del error de verificación ni el token.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers?.authorization;
    if (typeof header !== 'string' || header.length > MAX_AUTH_HEADER_LENGTH) {
      throw unauthorized();
    }
    const match = BEARER_REGEX.exec(header);
    if (!match) throw unauthorized();

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(match[1], {
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

    request.auth = { userId: payload.sub, claims: payload };
    // Defensa en profundidad: quien lea el header obtiene la identidad verificada.
    request.headers['x-user-id'] = payload.sub;
    return true;
  }
}
