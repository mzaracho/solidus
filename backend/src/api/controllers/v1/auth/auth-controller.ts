import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@src/infrastructure.bootstrap/config/providers/auth-guard-provider';
import { BaseController } from '@src/api/controllers/base/base-controller';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { Public } from '@src/infrastructure.bootstrap/config/core/authentication/public-decorator';
import { LoginQuery } from '@src/application/features/auth/login-query-handler';
import { LoginResponseDto } from '@src/application/features/auth/dtos/login-response-dto';
import { LogoutCommand } from '@src/application/features/auth/logout-command-handler';

@ApiTags('Auth')
@UseGuards(AuthGuard)
@Controller('v1/auth')
export class AuthController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'User Login', description: 'User Login' })
  @ApiResponse({ status: 200, description: 'User logged in successfully' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() body: LoginQuery): Promise<LoginResponseDto> {
    return this.dispatcher.dispatch(body);
  }

  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: 'User Logout', description: 'User Logout' })
  @ApiResponse({ status: 200, description: 'User logged out successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(): Promise<void> {
    return this.dispatcher.dispatch(new LogoutCommand());
  }
}
