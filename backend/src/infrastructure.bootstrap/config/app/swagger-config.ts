import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const configureSwagger = (app: INestApplication) => {
  const config = new DocumentBuilder()
    .setTitle('Solidus API')
    .setDescription('Solidus API')
    .setVersion('1.0')
    // .addApiKey({type: "apiKey", name: "x-api-key", in: "header"}, "api_key")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('/', app, document);
};
