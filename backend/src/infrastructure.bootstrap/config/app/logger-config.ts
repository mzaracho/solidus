import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestLoggerAdapter } from '../core/nest-logger-adapter';

export function configureNestInternalLogger(
  app: INestApplication,
  config: ConfigService,
) {
  app.useLogger(new NestLoggerAdapter(config));
}
