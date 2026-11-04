import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Sin conversión implícita en el ValidationPipe global (feature 014): un valor que no es string da 400.
export class LoginRequestDto {
  @ApiProperty({ description: 'Email del usuario', maxLength: 254 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  user!: string;

  @ApiProperty({ description: 'Contraseña', maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
