import { Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AxiosLoggerInterceptor } from '@src/infrastructure.bootstrap/filters/axios-logger-interceptor';

export const AxiosInterceptor: Provider = {
  provide: APP_INTERCEPTOR,
  useClass: AxiosLoggerInterceptor,
};
