import { IRequest } from './i-request';

export const IDispatcher = Symbol.for('IDispatcher');
export interface IDispatcher {
  dispatch<TRequest extends IRequest<TResult>, TResult>(
    request: TRequest,
  ): Promise<TResult>;
}
