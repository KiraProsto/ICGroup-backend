import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ArticleType } from '../../../generated/prisma/enums.js';

// ─── Public news summary (list endpoint) ────────────────────────────────────

export class PublicNewsSummaryDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: 'pandemiya-udarila-po-kompaniyam' })
  slug!: string;

  @ApiProperty({ example: 'Пандемия ударила по компаниям практически всех отраслей' })
  title!: string;

  @ApiProperty({ enum: ['NEWS', 'ARTICLE', 'PRESS_RELEASE', 'INTERVIEW', 'ANNOUNCEMENT'] })
  articleType!: ArticleType;

  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440001', nullable: true })
  rubricId!: string | null;

  @ApiProperty({ example: '2021-10-05T00:00:00.000Z' })
  publishedAt!: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/cover.jpg', nullable: true })
  coverImage!: string | null;

  @ApiPropertyOptional({ example: 'Краткий анонс статьи', nullable: true })
  excerptTitle!: string | null;

  @ApiPropertyOptional({ example: 'Текст анонса...', nullable: true })
  excerpt!: string | null;
}

// ─── Public news detail (single article endpoint) ────────────────────────────

export class PublicNewsDetailDto extends PublicNewsSummaryDto {
  @ApiPropertyOptional({ example: 'https://cdn.example.com/excerpt.jpg', nullable: true })
  excerptImage!: string | null;

  @ApiPropertyOptional({
    example: '<p>Текст статьи в HTML...</p>',
    nullable: true,
    description: 'Pre-rendered HTML body compiled from article cards at publish time',
  })
  bodyHtml!: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  socialMeta!: Record<string, unknown> | null;
}
