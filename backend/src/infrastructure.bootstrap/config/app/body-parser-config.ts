import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';

export const configureBodyParser = (
  app: NestExpressApplication,
  config: ConfigService,
) => {
  app.useBodyParser('json', { limit: config.get('BODY_SIZE_LIMIT') ?? '50mb' });
};
