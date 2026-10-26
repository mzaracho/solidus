import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';

@Injectable()
export class AxiosLoggerInterceptor implements OnModuleInit {
  constructor(
    private readonly configuration: ConfigService,
    private readonly httpService?: HttpService,
  ) {}

  onModuleInit() {
    this.httpService?.axiosRef.interceptors.request.use((config) => {
      if (
        (
          this.configuration.get('LOG_OUTGOING_REQUESTS') || ''
        ).toUpperCase() !== 'TRUE'
      ) {
        return config;
      }

      const methodColor = '\x1b[36m';
      const urlColor = '\x1b[33m';
      const dataColor = '\x1b[32m';
      const paramsColor = '\x1b[35m';
      const resetColor = '\x1b[0m';
      console.log(
        '[OUTGOING REQUEST]',
        `${methodColor}[${config.method?.toUpperCase()}]${resetColor}`,
        `${urlColor}${config.baseURL}/${config.url}${resetColor}`,
        config.params
          ? `[PARAMS]: ${paramsColor}${JSON.stringify(config.params, null, 2)}${resetColor}`
          : '[PARAMS]: No Params',
        config.data
          ? `[DATA]: ${dataColor}${JSON.stringify(config.data, null, 2)}${resetColor}`
          : '[DATA]: No Data',
      );
      return config;
    });
  }
}
