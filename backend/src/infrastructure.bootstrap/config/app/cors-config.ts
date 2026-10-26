import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const configureCors = (app: INestApplication, config: ConfigService) => {
  const originJson = config.get('CORS_ORIGIN');
  const methodsJson = config.get('CORS_METHODS');

  app.enableCors({
    origin: true, // Allow all (Reflects origin) - Temporary Debug
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    credentials: true,
  });
};
