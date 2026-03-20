import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ArticleType } from '../../../generated/prisma/enums.js';

// ─── Social meta per platform ─────────────────────────────────────────────────

class SocialPlatformMetaDto {
  @ApiPropertyOptional({ example: 'Заголовок для Facebook' })
  @IsString()
  @IsOptional()
  @Length(0, 300)
  title?: string;

  @ApiPropertyOptional({ example: 'Текст для Facebook' })
  @IsString()
  @IsOptional()
  @Length(0, 5000)
  text?: string;

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @IsOptional()
  imageUrl?: string;
}

class SocialMetaDto {
  @ApiPropertyOptional({ type: SocialPlatformMetaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialPlatformMetaDto)
  facebook?: SocialPlatformMetaDto;

  @ApiPropertyOptional({ type: SocialPlatformMetaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialPlatformMetaDto)
  vk?: SocialPlatformMetaDto;

  @ApiPropertyOptional({ type: SocialPlatformMetaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialPlatformMetaDto)
  telegram?: SocialPlatformMetaDto;

  @ApiPropertyOptional({ type: SocialPlatformMetaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialPlatformMetaDto)
  seo?: SocialPlatformMetaDto;
}

// ─── CreateNewsDto ────────────────────────────────────────────────────────────

export class CreateNewsDto {
  @ApiProperty({ example: 'Пандемия ударила по компаниям практически всех отраслей' })
  @IsString()
  @Length(1, 500)
  title!: string;

  /**
   * Optional URL slug. If omitted the service auto-generates one from the title
   * via transliteration + slugification.
   */
  @ApiPropertyOptional({
    example: 'pandemiya-udarila-po-kompaniyam',
    description:
      'URL-safe slug: 1–200 lowercase letters, digits, or hyphens. Auto-generated from title if omitted.',
  })
  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,198}[a-z0-9])?$/, {
    message:
      'slug must start and end with a letter or digit, contain only lowercase letters, digits, or hyphens (1–200 chars)',
  })
  slug?: string;

  @ApiPropertyOptional({
    enum: ArticleType,
    example: ArticleType.NEWS,
    default: ArticleType.NEWS,
  })
  @IsEnum(ArticleType)
  @IsOptional()
  articleType?: ArticleType;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440001',
    description: 'Rubric (section) UUID',
  })
  @IsUUID()
  @IsOptional()
  rubricId?: string;

  @ApiPropertyOptional({ example: '2021-10-05T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  publishedAt?: string;

  // ─── Anons / excerpt block ──────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 'Кризис обнажил уязвимость цифровой экономики' })
  @IsString()
  @IsOptional()
  @Length(0, 500)
  excerptTitle?: string;

  @ApiPropertyOptional({ example: 'Краткое описание для анонсирования публикации...' })
  @IsString()
  @IsOptional()
  @Length(0, 2000)
  excerpt?: string;

  @ApiPropertyOptional({ example: 'https://example.com/excerpt-image.jpg' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @IsOptional()
  excerptImage?: string;

  @ApiPropertyOptional({ example: 'https://example.com/cover.jpg' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @IsOptional()
  coverImage?: string;

  // ─── Author ─────────────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440002',
    description: 'Author user UUID. Defaults to the authenticated actor if omitted.',
  })
  @IsUUID()
  @IsOptional()
  authorId?: string;

  // ─── Social meta ─────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ type: SocialMetaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialMetaDto)
  socialMeta?: SocialMetaDto;

  // ─── RSS toggles ─────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  rssGoogleNews?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  rssYandexDzen?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  rssYandexNews?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  rssDefault?: boolean;

  // ─── Editorial controls ───────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 500, default: 500, minimum: 1, maximum: 9999 })
  @IsInt()
  @Min(1)
  @Max(9999)
  @IsOptional()
  publicationIndex?: number;

  // ─── Advertisement ────────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: '<!-- Ad tag placeholder -->',
    description:
      'Raw ad-tag banner code (e.g. a script snippet supplied by an ad network). ' +
      'MUST be rendered inside a sandboxed iframe — never injected directly into the DOM. ' +
      'Retrieve via GET /:id/ad-banner-code (requires update permission).',
  })
  @IsString()
  @MaxLength(20_000)
  @IsOptional()
  adBannerCode?: string;

  @ApiPropertyOptional({ example: 'https://example.com/ad-banner.jpg' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @IsOptional()
  adBannerImage?: string;
}
