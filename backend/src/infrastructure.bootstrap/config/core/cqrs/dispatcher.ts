import { Logger } from '@nestjs/common';
import { IDispatcher } from './interfaces/i-dispatcher';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { Reflector } from '@nestjs/core';
import { IRequest } from './interfaces/i-request';
import { REQUEST_HANDLER_METADATA_KEY } from './constant';

export class Dispatcher implements IDispatcher {
  constructor(
    private readonly request: Request,
    private readonly moduleRef: ModuleRef,
    private readonly reflector: Reflector,
  ) {}

  async dispatch<TRequest extends IRequest<TResult>, TResult>(
    request: TRequest,
  ): Promise<TResult> {
    const contextId = ContextIdFactory.getByRequest(this.request);

    const requestType = request.constructor;
    const handlerType = this.reflector.get(
      REQUEST_HANDLER_METADATA_KEY,
      requestType,
    );

    if (!handlerType) {
      new Logger(Dispatcher.name).error(
        `Handler not found for ${requestType.name}`,
      );
      throw new Error(`Handler not found for ${requestType.name}`);
    }

    const handler = await this.moduleRef.resolve(handlerType, contextId);
    return handler.execute(request);
  }
}
