import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IRequest } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request';
import { IRequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/interfaces/i-request-handler';
import { RequestHandler } from '@src/infrastructure.bootstrap/config/core/cqrs/request-handler-decorator';
import { PrismaService } from '@src/infrastructure/Prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  IsOptionalNotNull,
  IsPercentage,
} from '@src/infrastructure.bootstrap/config/core/validation/dto-validators';
import { ADMISSION_NO_COADMISOR_BEHAVIOR } from '@src/domain/features/organization/org-settings';
import type { AdmissionNoCoAdmisorBehavior } from '@src/domain/features/organization/org-settings';

/**
 * Claves de Organization.settings que acepta la API: las 2 que guarda la UI (alertsDays, emailNotifs) y las 5
 * de OrgSettings. Cualquier otra clave responde 400.
 */
export class OrgSettingsDto {
  @ApiPropertyOptional({
    description: 'Días de alerta (0 a 3650)',
    type: Number,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  alertsDays?: number;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  emailNotifs?: boolean;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  privatePayerName?: string;

  @ApiPropertyOptional({ description: 'Porcentaje (0 a 100)', type: Number })
  @IsOptional()
  @IsPercentage()
  proModePrivatePatientPct?: number;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  defaultServiceType?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  defaultEventRole?: string;

  @ApiPropertyOptional({ enum: Object.values(ADMISSION_NO_COADMISOR_BEHAVIOR) })
  @IsOptional()
  @IsEnum(ADMISSION_NO_COADMISOR_BEHAVIOR)
  admisionNoCoAdmisorBehavior?: AdmissionNoCoAdmisorBehavior;
}

const SETTINGS_KEYS = [
  'alertsDays',
  'emailNotifs',
  'privatePayerName',
  'proModePrivatePatientPct',
  'defaultServiceType',
  'defaultEventRole',
  'admisionNoCoAdmisorBehavior',
] as const;

export class UpdateOrganizationCommand implements IRequest<boolean> {
  /** Lo asigna el controlador desde @CurrentOrgId(); el cliente no lo manda (400). */
  declare id: string;

  @ApiPropertyOptional({ description: 'Name', type: String })
  @IsOptionalNotNull()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: 'CUIT', type: String })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cuit?: string;

  @ApiPropertyOptional({ description: 'Address', type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ description: 'Settings JSON', type: OrgSettingsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OrgSettingsDto)
  settings?: OrgSettingsDto;
}

@Injectable()
@RequestHandler(UpdateOrganizationCommand)
export class UpdateOrganizationCommandHandler implements IRequestHandler<
  UpdateOrganizationCommand,
  boolean
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: UpdateOrganizationCommand): Promise<boolean> {
    // cuit y address viven en sus propias columnas. El JSON `settings` se reemplaza completo y solo con las
    // claves declaradas en OrgSettingsDto (las ausentes no se guardan).
    const finalSettings: Record<string, unknown> = {};
    for (const key of SETTINGS_KEYS) {
      const value = command.settings?.[key];
      if (value !== undefined) finalSettings[key] = value;
    }

    await this.prisma.organization.update({
      where: { id: command.id },
      data: {
        name: command.name,
        cuit: command.cuit,
        address: command.address,
        settings: finalSettings as any,
      },
    });
    return true;
  }
}
