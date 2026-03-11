import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../../../generated/prisma/enums.js';

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: Role, example: Role.SALES_MANAGER })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * If provided, replaces the user's password (hashed with Argon2id).
   * Min 8 chars; max 72 to avoid Argon2 processing very long inputs.
   */
  @ApiPropertyOptional({ example: 'N3wP@ssword!', minLength: 8, maxLength: 72 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}
