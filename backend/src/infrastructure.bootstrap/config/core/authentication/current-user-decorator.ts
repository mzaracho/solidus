import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AUTH_ERROR_CODE, AuthenticatedRequest } from './auth-context';

/** Id del usuario autenticado: sale de `sub` del token verificado, nunca de headers. */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.auth?.userId;
    if (!userId) {
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODE.UNAUTHORIZED,
        message: 'Unauthorized',
      });
    }
    return userId;
  },
);
