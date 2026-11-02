import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

type RawField = { obj: Record<string, unknown>; key: string };

// El @Transform devuelve el valor crudo del body y anula la conversión implícita del ValidationPipe
// global (que convertiría 123 o {} en string): así los valores que no son string dan 400.
export class LoginRequestDto {
  @ApiProperty({ description: 'Email del usuario', maxLength: 254 })
  @Transform(({ obj, key }: RawField) => obj[key])
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  user!: string;

  @ApiProperty({ description: 'Contraseña', maxLength: 128 })
  @Transform(({ obj, key }: RawField) => obj[key])
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
