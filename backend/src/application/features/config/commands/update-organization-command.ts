import { ApiProperty } from '@nestjs/swagger';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { Injectable } from '@nestjs/common';

export class UpdateOrganizationCommand implements IRequest<boolean> {
  constructor(
    id: string,
    name: string,
    cuit: string,
    address: string,
    settings: any,
  ) {
    this.id = id;
    this.name = name;
    this.cuit = cuit;
    this.address = address;
    this.settings = settings;
  }

  @ApiProperty({ description: 'Organization ID', type: String })
  id!: string;

  @ApiProperty({ description: 'Name', type: String })
  name!: string;

  @ApiProperty({ description: 'CUIT', type: String })
  cuit!: string;

  @ApiProperty({ description: 'Address', type: String })
  address!: string;

  @ApiProperty({ description: 'Settings JSON', type: Object })
  settings!: any;
}

@Injectable()
@RequestHandler(UpdateOrganizationCommand)
export class UpdateOrganizationCommandHandler implements IRequestHandler<
  UpdateOrganizationCommand,
  boolean
> {
  constructor(private readonly prisma: PrismaService) { }

  async execute(command: UpdateOrganizationCommand): Promise<boolean> {
    // Save cuit and address to their own columns.
    // Clean settings to ensure we don't duplicate data if it was passed in settings JSON.
    const { cuit, address, ...otherSettings } = command.settings || {};
    const finalSettings = {
      ...otherSettings,
      // If there are other specific settings, keep them.
      alertsDays: command.settings?.alertsDays,
      emailNotifs: command.settings?.emailNotifs
    };

    try {
      await this.prisma.organization.update({
        where: { id: command.id },
        data: {
          name: command.name,
          cuit: command.cuit,
          address: command.address,
          settings: finalSettings,
        },
      });
    } catch (error) {
      console.error('Error updating organization:', error);
      throw error;
    }
    return true;
  }
}
