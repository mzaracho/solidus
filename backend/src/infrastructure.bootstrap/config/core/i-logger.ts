import { Request } from 'express';

export const ILogger = Symbol.for('ILogger');
export interface ILogger {
  logInfo(message: string): void;
  logInfo(message: string, req?: Request): void;

  logDebug(message: string): void;
  logDebug(message: string, req?: Request): void;

  logError(message: string, stack?: string): void;
  logError(message: string, stack?: string, req?: Request): void;

  logWarning(message: string): void;
  logWarning(message: string, req?: Request): void;
}
