import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ContentStatus, SectionType } from '../../../generated/prisma/enums.js';

export class PageSectionResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({
    enum: ['HERO', 'FEATURE_GRID', 'TESTIMONIALS', 'CTA', 'TEXT', 'GALLERY'],
    example: 'HERO',
  })
  type!: SectionType;

  @ApiProperty({ example: 0 })
  order!: number;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { title: 'Welcome' } })
  data!: Record<string, unknown>;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt!: string;
}

/** Summary shape returned by list and create endpoints (no sections). */
export class PageSummaryResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: 'shareholders', description: 'URL-safe page identifier' })
  slug!: string;

  @ApiProperty({ example: 'Акционерам и инвесторам', description: 'Human-readable page title' })
  name!: string;

  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], example: 'DRAFT' })
  status!: ContentStatus;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z', nullable: true })
  publishedAt!: string | null;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  createdById!: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt!: string;
}

/** Full page shape including sections — returned by findOne, upsert, publish, archive. */
export class PageResponseDto extends PageSummaryResponseDto {
  @ApiProperty({ type: [PageSectionResponseDto] })
  sections!: PageSectionResponseDto[];
}
