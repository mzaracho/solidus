import { UseGuards } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import { ApiKeyGuard } from '@src/infrastructure.bootstrap/guards/api-key-guard';

@UseGuards(ApiKeyGuard)
@ApiSecurity('x-api-key')
export abstract class BaseController {}
