import { Injectable } from '@nestjs/common';
import { ILogger } from './i-logger';
import { Request } from 'express';
import { Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isString } from './type-guards';

@Injectable({ scope: Scope.DEFAULT })
export class Logger implements ILogger {
  private readonly logger: Logger;

  constructor(config: ConfigService) {
    const enviroment = config.get('NODE_ENV');
    const appName = config.get('APP_NAME');
    if (!isString(enviroment) || !isString(appName)) {
      throw new Error('APP_NAME or NODE_ENV is not a string');
    }
  }

  logInfo(message: string): void;
  logInfo(message: string, req?: Request): void {
    console.log(message);
  }

  logDebug(message: string): void;
  logDebug(message: string, req?: Request): void {
    console.log(message);
  }

  logError(message: string, stack?: string): void;
  logError(message: string, stack?: string, req?: Request): void {
    console.log(message);
  }

  logWarning(message: string): void;
  logWarning(message: string, req?: Request): void {
    console.log(message);
  }
}
