import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { Injectable } from '@nestjs/common';
import { UpdateProfileDto } from '../Dtos/update-profile.dto';

export class UpdateProfileCommand
  extends UpdateProfileDto
  implements IRequest<any> {
  // DTO already has properties
}

@RequestHandler(UpdateProfileCommand)
@Injectable()
export class UpdateProfileCommandHandler implements IRequestHandler<
  UpdateProfileCommand,
  any
> {
  async execute(command: UpdateProfileCommand): Promise<any> {
    // Mock update
    return { success: true, ...command };
  }
}
