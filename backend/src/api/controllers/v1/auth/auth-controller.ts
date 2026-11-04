import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BaseController } from '@src/api/controllers/base/base-controller';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { Public } from '@src/infrastructure.bootstrap/config/core/authentication/public-decorator';
import { OrgOptional } from '@src/infrastructure.bootstrap/config/core/authentication/org-optional-decorator';
import { LoginQuery } from '@src/application/features/auth/login-query-handler';
import { LoginRequestDto } from '@src/application/features/auth/dtos/login-request.dto';
import { LoginResponseDto } from '@src/application/features/auth/dtos/login-response-dto';
import { LoginRateLimiter } from '@src/infrastructure/features/auth/services/login-rate-limiter';
import { LogoutCommand } from '@src/application/features/auth/logout-command-handler';

@ApiTags('Auth')
@Controller('v1/auth')
export class AuthController extends BaseController {
  constructor(
    @Inject(IDispatcher) private readonly dispatcher: IDispatcher,
    private readonly loginRateLimiter: LoginRateLimiter,
  ) {
    super();
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'User Login', description: 'User Login' })
  @ApiResponse({ status: 201, description: 'User logged in successfully' })
  @ApiResponse({ status: 400, description: 'Missing or invalid fields' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({
    status: 429,
    description: 'Too many attempts (header Retry-After en segundos)',
  })
  async login(
    @Body() body: LoginRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
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
    const result = await this.dispatcher.dispatch<LoginQuery, LoginResponseDto>(
      new LoginQuery(body.user, body.password),
    );
    this.loginRateLimiter.recordSuccess(ip, body.user);
    return result;
  }

  @OrgOptional()
  @Post('logout')
  @ApiOperation({ summary: 'User Logout', description: 'User Logout' })
  @ApiResponse({ status: 200, description: 'User logged out successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(): Promise<void> {
    return this.dispatcher.dispatch(new LogoutCommand());
  }
}
