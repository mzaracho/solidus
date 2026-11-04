import { NestFactory } from '@nestjs/core';
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
import { getListenHost } from './config/app/listen-config';
import {
  assertTlsVerificationEnabled,
  getRuntimeEnv,
} from './config/app/runtime-env';
import { createAccessLogMiddleware } from './config/app/access-log';

export async function bootstrap() {
  assertTlsVerificationEnabled();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  app.useGlobalInterceptors(
    new LoggingInterceptor({
      debugEnabled: getRuntimeEnv(config) !== 'production',
    }),
  );
  // Antes del body parser: ve también los 413/400 del parser y los rechazos de los guards.
  app.use(createAccessLogMiddleware());
  configureBodyParser(app, config);
  configureGlobalPrefix(app);
  configurePipes(app);
  configureNestInternalLogger(app, config);
  configureCors(app, config);
  configureSwagger(app, config);

  await app.listen(config.get('PORT') ?? 8080, getListenHost(config));
}
