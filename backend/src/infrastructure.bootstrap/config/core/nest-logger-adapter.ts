import { LoggerService, LogLevel } from '@nestjs/common';
import { ILogger } from './i-logger';
import { ConfigService } from '@nestjs/config';
import { Logger } from './logger';

export class NestLoggerAdapter implements LoggerService {
  private readonly logger: ILogger;

  constructor(config: ConfigService) {
    this.logger = new Logger(config);
  }

  log(message: any, ...optionalParams: any[]) {
    this.logger.logInfo(message);
  }
  error(message: any, ...optionalParams: any[]) {
    this.logger.logError(message);
  }
  warn(message: any, ...optionalParams: any[]) {
    this.logger.logWarning(message);
  }
  debug?(message: any, ...optionalParams: any[]) {
    this.logger.logDebug(message);
  }
}
