import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  ArticleCardType,
  ArticleType,
  ContentStatus,
} from '../../../generated/prisma/enums.js';

// ─── Card response ────────────────────────────────────────────────────────────

export class CardResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440010' })
  id!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  articleId!: string;

  @ApiProperty({
    enum: ['TEXT', 'QUOTE', 'PUBLICATION', 'IMAGE', 'VIDEO'],
    example: 'TEXT',
  })
  type!: ArticleCardType;

  @ApiProperty({ example: 0 })
  order!: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  data!: Record<string, unknown>;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt!: string;
}

// ─── News article summary (list / create response) ────────────────────────────

export class NewsSummaryResponseDto {
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

  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  status!: ContentStatus;

  @ApiPropertyOptional({ example: '2021-10-05T00:00:00.000Z', nullable: true })
  publishedAt!: string | null;

  @ApiPropertyOptional({ example: 'https://example.com/cover.jpg', nullable: true })
  coverImage!: string | null;

  @ApiPropertyOptional({ example: 'Краткий анонс...', nullable: true })
  excerptTitle!: string | null;

  @ApiProperty({ example: 500 })
  publicationIndex!: number;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440002' })
  authorId!: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt!: string;
}

// ─── Full news article (findOne / publish / archive response) ─────────────────

export class NewsResponseDto extends NewsSummaryResponseDto {
  @ApiPropertyOptional({ nullable: true, example: 'Краткий анонс публикации' })
  excerpt!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'https://example.com/excerpt.jpg' })
  excerptImage!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'https://example.com/cover.jpg' })
  coverImageFull!: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  socialMeta!: Record<string, unknown> | null;

  @ApiProperty()
  rssGoogleNews!: boolean;

  @ApiProperty()
  rssYandexDzen!: boolean;

  @ApiProperty()
  rssYandexNews!: boolean;

  @ApiProperty()
  rssDefault!: boolean;

  @ApiPropertyOptional({ nullable: true })
  adBannerCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  adBannerImage!: string | null;

  @ApiProperty({ type: [CardResponseDto] })
  cards!: CardResponseDto[];
}

// ─── Preview response (read-only; bodyHtml compiled on-the-fly) ───────────────

export class NewsPreviewResponseDto extends NewsResponseDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Pre-rendered HTML of all cards (generated on-the-fly for preview)',
  })
  bodyHtml!: string | null;
}
