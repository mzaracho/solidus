import { REQUEST_HANDLER_METADATA_KEY } from './constant';
import { IRequest } from './interfaces/i-request';

export const RequestHandler = (requestType: IRequest): ClassDecorator =>
  AddHandlerMetadata(requestType);

const AddHandlerMetadata =
  (requestType: IRequest) => (requestHandlerType: object) => {
    Reflect.defineMetadata(
      REQUEST_HANDLER_METADATA_KEY,
      requestHandlerType,
      requestType,
    );
  };
