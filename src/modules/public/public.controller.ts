import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiErrorResponseDto,
  ApiPaginatedResponseDto,
  ApiResponseDto,
} from '../../common/dto/api-response.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { ParseSlugPipe } from '../../common/pipes/parse-slug.pipe.js';
import { PublicService } from './public.service.js';
import { PublicNewsQueryDto } from './dto/public-news-query.dto.js';
import { PublicNewsDetailDto, PublicNewsSummaryDto } from './dto/public-news-response.dto.js';
import { PublicPageDto } from './dto/public-page-response.dto.js';

/**
 * Public portal API — no authentication required.
 * Returns only PUBLISHED content. Responses are Redis-cached (TTL 5 min).
 *
 * Cache is invalidated immediately when content is published via the admin panel.
 */
@ApiTags('public')
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  // ─── GET /public/pages/:type ──────────────────────────────────────────────

  @Get('pages/:type')
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @ApiOperation({
    summary: 'Get a published page by slug. Returns sections ordered by position.',
  })
  @ApiParam({
    name: 'type',
    type: String,
    description: 'URL-safe page slug (e.g. "about", "shareholders")',
    example: 'about',
  })
  @ApiOkResponse({ type: ApiResponseDto(PublicPageDto) })
  @ApiNotFoundResponse({
    type: ApiErrorResponseDto,
    description: 'Page not found or not published',
  })
  findPage(@Param('type', ParseSlugPipe) slug: string): Promise<PublicPageDto> {
    return this.publicService.findPublishedPage(slug);
  }

  // ─── GET /public/news ──────────────────────────────────────────────────────

  @Get('news')
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @ApiOperation({
    summary: 'List published news articles (paginated). Optionally filter by type and rubric.',
  })
  @ApiOkResponse({ type: ApiPaginatedResponseDto(PublicNewsSummaryDto) })
  findNewsList(@Query() query: PublicNewsQueryDto) {
    return this.publicService.findPublishedNewsList(query);
  }

  // ─── GET /public/news/:slug ────────────────────────────────────────────────

  @Get('news/:slug')
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @ApiOperation({
    summary: 'Get a published news article by slug. Includes pre-rendered HTML body.',
  })
  @ApiParam({
    name: 'slug',
    type: String,
    description: 'URL-safe article slug',
    example: 'novosti-kompanii',
  })
  @ApiOkResponse({ type: ApiResponseDto(PublicNewsDetailDto) })
  @ApiNotFoundResponse({
    type: ApiErrorResponseDto,
    description: 'Article not found or not published',
  })
  findNewsBySlug(@Param('slug', ParseSlugPipe) slug: string): Promise<PublicNewsDetailDto> {
    return this.publicService.findPublishedNewsBySlug(slug);
  }
}
