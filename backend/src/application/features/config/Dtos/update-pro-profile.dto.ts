import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptionalNotNull } from '@src/infrastructure.bootstrap/config/core/validation/dto-validators';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body de PUT pro/profile. Acepta '' (el formulario deja campos vacíos). */
export class UpdateProProfileDto {
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cuit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;
}
