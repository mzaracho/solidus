import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';

export class LogoutCommand implements IRequest<void> {
  constructor() {}
}

export class LogoutCommandHandler implements IRequestHandler<
  LogoutCommand,
  void
> {
  public async execute(command: LogoutCommand): Promise<void> {
    return;
  }
}
