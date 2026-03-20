import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';
import { Role } from '../../../generated/prisma/enums.js';

export class CreateUserDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  email!: string;

  /**
   * Plain-text password — hashed with Argon2id before persistence.
   * Min 8 chars; max 72 to avoid Argon2 processing very long inputs.
   */
  @ApiProperty({ example: 'S3cur3P@ssword!', minLength: 8, maxLength: 72 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ enum: Role, example: Role.CONTENT_MANAGER })
  @IsEnum(Role)
  role!: Role;
}
