import { Provider } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AxiosFilter } from '@src/infrastructure.bootstrap/filters/axios-filter';
import { GlobalFilter } from '@src/infrastructure.bootstrap/filters/global-filter';
import { HttpFilter } from '@src/infrastructure.bootstrap/filters/http-filter';

export const GlobalFilterProvider: Provider = {
  provide: APP_FILTER,
  useClass: GlobalFilter,
};
export const AxiosFilterProvider: Provider = {
  provide: APP_FILTER,
  useClass: AxiosFilter,
};
export const HttpFilterProvider: Provider = {
  provide: APP_FILTER,
  useClass: HttpFilter,
};
