import { IRequest } from './i-request';

export interface IRequestHandler<TRequest extends IRequest<TResult>, TResult> {
  execute(command: TRequest): Promise<TResult>;
}
