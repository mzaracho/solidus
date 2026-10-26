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

    console.log(`[Dispatcher] Dispatching request: ${requestType.name}`);
    console.log(`[Dispatcher] Resolved Handler Type: ${handlerType?.name}`);

    if (!handlerType) {
      console.error(
        `[Dispatcher] Handler not found for ${requestType.name}. Metadata key: ${REQUEST_HANDLER_METADATA_KEY}`,
      );
      throw new Error(`Handler not found for ${requestType.name}`);
    }

    const handler = await this.moduleRef.resolve(handlerType, contextId);
    return handler.execute(request);
  }
}
