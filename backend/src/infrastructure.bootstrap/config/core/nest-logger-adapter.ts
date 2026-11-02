import { LoggerService } from '@nestjs/common';
import { ILogger } from './i-logger';
import { ConfigService } from '@nestjs/config';
import { Logger } from './logger';
import { isString } from './type-guards';
import { safeStringify } from './redact';

const toText = (message: unknown): string =>
  isString(message) ? message : safeStringify(message);

export class NestLoggerAdapter implements LoggerService {
  private readonly logger: ILogger;

  constructor(config: ConfigService) {
    this.logger = new Logger(config);
  }

  log(message: any, ...optionalParams: any[]) {
    this.logger.logInfo(toText(message));
  }
  error(message: any, ...optionalParams: any[]) {
    this.logger.logError(toText(message));
  }
  warn(message: any, ...optionalParams: any[]) {
    this.logger.logWarning(toText(message));
  }
  debug?(message: any, ...optionalParams: any[]) {
    this.logger.logDebug(toText(message));
  }
  verbose?(message: any, ...optionalParams: any[]) {
    this.logger.logDebug(toText(message));
  }
}
