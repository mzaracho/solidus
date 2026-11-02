import { Injectable } from '@nestjs/common';
import { ILogger } from './i-logger';
import { Request } from 'express';
import { Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isString } from './type-guards';
import { getRuntimeEnv } from '../app/runtime-env';

@Injectable({ scope: Scope.DEFAULT })
export class Logger implements ILogger {
  private readonly debugEnabled: boolean;

  constructor(config: ConfigService) {
    const enviroment = config.get('NODE_ENV');
    const appName = config.get('APP_NAME');
    if (!isString(enviroment) || !isString(appName)) {
      throw new Error('APP_NAME or NODE_ENV is not a string');
    }
    // Falla cerrado: sin NODE_ENV reconocible se asume producción (sin debug).
    this.debugEnabled = getRuntimeEnv(config) !== 'production';
  }

  logInfo(message: string): void;
  logInfo(message: string, req?: Request): void {
    console.log(message);
  }

  logDebug(message: string): void;
  logDebug(message: string, req?: Request): void {
    if (!this.debugEnabled) return;
    console.log(message);
  }

  logError(message: string, stack?: string): void;
  logError(message: string, stack?: string, req?: Request): void {
    console.error(message);
  }

  logWarning(message: string): void;
  logWarning(message: string, req?: Request): void {
    console.warn(message);
  }
}
