import { Provider, Scope } from '@nestjs/common';
import { IDispatcher } from './interfaces/i-dispatcher';
import { ModuleRef, Reflector, REQUEST } from '@nestjs/core';
import { Dispatcher } from './dispatcher';

export const DispatcherProvider: Provider = {
  provide: IDispatcher,
  useFactory: (
    request: Request,
    moduleRef: ModuleRef,
    reflector: Reflector,
  ) => {
    return new Dispatcher(request, moduleRef, reflector);
  },
  inject: [REQUEST, ModuleRef, Reflector],
  scope: Scope.DEFAULT,
};
