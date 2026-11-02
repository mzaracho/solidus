import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { shouldEnableSwagger } from './runtime-env';

export const SWAGGER_PATH = 'docs';

/** Swagger solo se monta fuera de producción, en /docs. */
export const configureSwagger = (
  app: INestApplication,
  appConfig: ConfigService,
) => {
  if (!shouldEnableSwagger(appConfig)) return;
  const config = new DocumentBuilder()
    .setTitle('Solidus API')
    .setDescription('Solidus API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document);
};
