import { Controller, Put, Body, Inject } from '@nestjs/common';
import { UpdateProfileCommand } from '@src/application/features/config/commands/update-profile-command';
import { IDispatcher } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-dispatcher';
import { BaseController } from '../../base/base-controller';

@Controller('profile')
export class ProfileController extends BaseController {
  constructor(@Inject(IDispatcher) private readonly dispatcher: IDispatcher) {
    super();
  }

  @Put()
  updateProfile(@Body() command: UpdateProfileCommand) {
    return this.dispatcher.dispatch(command);
  }
}
