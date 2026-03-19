import { ApiProperty } from '@nestjs/swagger';
import type { SectionType } from '../../../generated/prisma/enums.js';

// ─── Public page section ──────────────────────────────────────────────────────

export class PublicPageSectionDto {
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
}

// ─── Public page ──────────────────────────────────────────────────────────────

export class PublicPageDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: 'shareholders', description: 'URL-safe page identifier' })
  slug!: string;

  @ApiProperty({ example: 'Акционерам и инвесторам', description: 'Human-readable page title' })
  name!: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  publishedAt!: string;

  @ApiProperty({ type: [PublicPageSectionDto] })
  sections!: PublicPageSectionDto[];
}
