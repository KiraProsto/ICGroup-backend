import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Role } from '../../../generated/prisma/enums.js';

export class UserResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: 'alice@example.com' })
  email!: string;

  @ApiProperty({ enum: ['SUPER_ADMIN', 'CONTENT_MANAGER', 'SALES_MANAGER'] })
  role!: Role;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt!: string;

  @ApiPropertyOptional({ example: '2026-02-01T00:00:00.000Z', nullable: true })
  deletedAt!: string | null;
}
