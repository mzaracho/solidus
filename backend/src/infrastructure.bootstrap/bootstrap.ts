import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { AppModule } from './modules/app-module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { configureBodyParser } from './config/app/body-parser-config';
import { configureGlobalPrefix } from './config/app/global-prefix-config';
import { configurePipes } from './config/app/pipes-config';
import { configureCors } from './config/app/cors-config';
import { configureSwagger } from './config/app/swagger-config';
import { configureNestInternalLogger } from './config/app/logger-config';

export async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useGlobalInterceptors(new LoggingInterceptor());
  const config = app.get(ConfigService);
  configureBodyParser(app, config);
  configureGlobalPrefix(app);
  configurePipes(app);
  configureNestInternalLogger(app, config);
  configureSwagger(app);
  configureCors(app, config);

  await app.listen(config.get('PORT') ?? 8080, '0.0.0.0');
}
