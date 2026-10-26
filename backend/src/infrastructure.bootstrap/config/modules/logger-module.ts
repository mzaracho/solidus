import { Module } from '@nestjs/common';
import { ILogger } from '../core/i-logger';
import { Logger } from '../core/logger';

@Module({
  providers: [{ provide: ILogger, useClass: Logger }],
  exports: [ILogger],
})
export class LoggerModule {}
