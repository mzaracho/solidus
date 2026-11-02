import { IRequest } from './i-request';
import { RequestContext } from '../request-context';

export interface IRequestHandler<TRequest extends IRequest<TResult>, TResult> {
  execute(command: TRequest, context: RequestContext): Promise<TResult>;
}
