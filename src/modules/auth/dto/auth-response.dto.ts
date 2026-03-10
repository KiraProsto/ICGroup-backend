import { ApiProperty } from '@nestjs/swagger';
import type { Role } from '../../../generated/prisma/enums.js';

export class AuthTokensResponseDto {
  @ApiProperty({ description: 'Short-lived JWT access token (15 min)' })
  accessToken!: string;
}

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ['SUPER_ADMIN', 'CONTENT_MANAGER', 'SALES_MANAGER'] })
  role!: Role;
}

export class LoginResponseDto extends AuthTokensResponseDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class CurrentUserProfileDto extends AuthUserDto {
  @ApiProperty({ example: '2026-03-10T10:00:00.000Z' })
  createdAt!: Date;
}
