import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BaseController } from '@src/api/controllers/base/base-controller';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { Public } from '@src/infrastructure.bootstrap/config/core/authentication/public-decorator';
import { OrgOptional } from '@src/infrastructure.bootstrap/config/core/authentication/org-optional-decorator';
import {
  LoginQuery,
  LoginResult,
} from '@src/application/features/auth/login-query-handler';
import { LoginRequestDto } from '@src/application/features/auth/dtos/login-request.dto';
import { LoginResponseDto } from '@src/application/features/auth/dtos/login-response-dto';
import { LoginRateLimiter } from '@src/infrastructure/features/auth/services/login-rate-limiter';
import { LogoutCommand } from '@src/application/features/auth/logout-command-handler';
import {
  AUTH_COOKIE_NAME,
  buildSessionCookieOptions,
  getAllowedOrigins,
  isAllowedOrigin,
  resolveCookieSecure,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from '@src/infrastructure.bootstrap/config/app/auth-cookie-config';
import { AUTH_ERROR_CODE } from '@src/infrastructure.bootstrap/config/core/authentication/auth-context';

@ApiTags('Auth')
@Controller('v1/auth')
export class AuthController extends BaseController {
  constructor(
    @Inject(IDispatcher) private readonly dispatcher: IDispatcher,
    private readonly loginRateLimiter: LoginRateLimiter,
    private readonly config: ConfigService,
  ) {
    super();
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'User Login', description: 'User Login' })
  @ApiResponse({
    status: 201,
    description:
      'User logged in successfully. The session JWT is set in the HttpOnly cookie solidus_session and is not part of the body.',
  })
  @ApiResponse({ status: 400, description: 'Missing or invalid fields' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Origin not allowed' })
  @ApiResponse({
    status: 429,
    description: 'Too many attempts (header Retry-After en segundos)',
  })
  async login(
    @Body() body: LoginRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    // Login CSRF: un Origin presente y fuera de la lista blanca se rechaza antes de contar el intento.
    // Sin Origin (smoke, curl) se deja pasar: un formulario de otro sitio siempre lo manda.
    const origin = req.headers.origin;
    let validatedOrigin: string | null = null;
    if (origin !== undefined) {
      if (!isAllowedOrigin(origin, getAllowedOrigins(this.config))) {
        throw new ForbiddenException({
          code: AUTH_ERROR_CODE.FORBIDDEN,
          message: 'Forbidden',
        });
      }
      validatedOrigin = origin;
    }
    // IP de la conexión: nunca X-Forwarded-For (no hay proxy ni `trust proxy`; ver 012).
    const ip = req.socket?.remoteAddress ?? '';
    // Antes de consultar la base o evaluar la contraseña; misma respuesta exista o no el usuario.
    const decision = this.loginRateLimiter.consume(ip, body.user);
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new HttpException(
        {
          code: 'too-many-requests',
          message:
            'Demasiados intentos. Esperá unos minutos antes de volver a intentar.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const result = await this.dispatcher.dispatch<LoginQuery, LoginResult>(
      new LoginQuery(body.user, body.password),
    );
    this.loginRateLimiter.recordSuccess(ip, body.user);
    // El JWT viaja solo en la cookie HttpOnly; el cuerpo no lo incluye.
    res.cookie(
      AUTH_COOKIE_NAME,
      result.token,
      buildSessionCookieOptions({
        secure: resolveCookieSecure(this.config, validatedOrigin),
        maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS,
      }),
    );
    return result.response;
  }

  @OrgOptional()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: 'User Logout',
    description: 'Borra la cookie de sesión HttpOnly (Max-Age=0).',
  })
  @ApiResponse({ status: 204, description: 'Session cookie cleared' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'CSRF check failed' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.dispatcher.dispatch(new LogoutCommand());
    // Mismos atributos que al emitirla (Path, HttpOnly, SameSite y Secure) con Max-Age=0.
    // No se usa res.clearCookie: Express 4.22 desaconseja pasarle maxAge.
    const origin = req.headers.origin;
    const validatedOrigin = isAllowedOrigin(
      origin,
      getAllowedOrigins(this.config),
    )
      ? (origin as string)
      : null;
    res.cookie(
      AUTH_COOKIE_NAME,
      '',
      buildSessionCookieOptions({
        secure: resolveCookieSecure(this.config, validatedOrigin),
        maxAgeSeconds: 0,
      }),
    );
  }
}
