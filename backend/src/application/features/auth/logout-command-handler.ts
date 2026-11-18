import { Injectable } from '@nestjs/common';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';

export class LogoutCommand implements IRequest<void> {}

/**
 * Sin revocación del JWT (fuera de alcance del 018): el borrado de la cookie lo hace el controlador.
 * Es el punto de extensión para una futura revocación de sesiones.
 */
@Injectable()
@RequestHandler(LogoutCommand)
export class LogoutCommandHandler implements IRequestHandler<
  LogoutCommand,
  void
> {
  public execute(): Promise<void> {
    return Promise.resolve();
  }
}
