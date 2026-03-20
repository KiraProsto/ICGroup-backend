import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  AuditAction,
  AuditLogStatus,
  AuditResourceType,
} from '../../../generated/prisma/enums.js';

export class AuditLogResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: '2026-03-20T12:00:00.000Z' })
  timestamp!: string;

  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440001', nullable: true })
  actorId!: string | null;

  @ApiPropertyOptional({ example: '192.168.1.1', nullable: true })
  actorIp!: string | null;

  @ApiPropertyOptional({ example: 'Mozilla/5.0', nullable: true })
  actorUserAgent!: string | null;

  @ApiProperty({ enum: ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'PUBLISH', 'ARCHIVE'] })
  action!: AuditAction;

  @ApiProperty({
    enum: ['User', 'Page', 'NewsArticle', 'Company', 'Purchase', 'PageSection', 'Rubric'],
  })
  resourceType!: AuditResourceType;

  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440002', nullable: true })
  resourceId!: string | null;

  @ApiProperty({ enum: ['SUCCESS', 'FAILURE'] })
  status!: AuditLogStatus;
}
