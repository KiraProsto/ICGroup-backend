import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ApiArrayResponseDto,
  ApiErrorResponseDto,
  ApiPaginatedResponseDto,
  ApiResponseDto,
} from '../../common/dto/api-response.dto.js';
import { CheckPolicies } from '../casl/decorators/check-policies.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator.js';
import { NewsService } from './news.service.js';
import type { PaginatedResult } from '../../common/interceptors/transform-response.interceptor.js';
import { CreateNewsDto } from './dto/create-news.dto.js';
import { UpdateNewsDto } from './dto/update-news.dto.js';
import { ListNewsQueryDto } from './dto/list-news-query.dto.js';
import { CreateCardDto } from './dto/create-card.dto.js';
import { UpdateCardDto } from './dto/update-card.dto.js';
import { ReorderCardsDto } from './dto/reorder-cards.dto.js';
import { SearchNewsQueryDto } from './dto/search-news-query.dto.js';
import {
  AdBannerCodeResponseDto,
  CardResponseDto,
  NewsPreviewResponseDto,
  NewsResponseDto,
  NewsSearchResultDto,
  NewsSummaryResponseDto,
} from './dto/news-response.dto.js';

/**
 * Manages news articles and their content cards in the admin panel.
 *
 * CASL policy matrix:
 *   GET         /                            → read  NewsArticle  (CM, SM, SA)
 *   POST        /                            → create NewsArticle (CM, SA)
 *   GET         /search                      → read  NewsArticle  (CM, SM, SA) [FTS]
 *   GET         /:id                         → read  NewsArticle  (CM, SM, SA)
 *   PATCH       /:id                         → update NewsArticle (CM, SA)
 *   DELETE      /:id                         → delete NewsArticle (CM, SA)
 *   POST        /:id/publish                 → publish NewsArticle(CM, SA)
 *   POST        /:id/draft                   → update NewsArticle (CM, SA)
 *   POST        /:id/archive                 → archive NewsArticle(CM, SA)
 *   GET         /:id/preview                 → read  NewsArticle  (CM, SM, SA)
 *   GET         /:articleId/cards            → read  NewsArticle  (CM, SM, SA)
 *   POST        /:articleId/cards            → update NewsArticle (CM, SA)
 *   PATCH       /:articleId/cards/:cardId    → update NewsArticle (CM, SA)
 *   DELETE      /:articleId/cards/:cardId    → delete NewsArticle (CM, SA)
 *   PUT         /:articleId/cards/order      → update NewsArticle (CM, SA)
 *
 * All routes sit behind the global JwtAuthGuard + PoliciesGuard.
 */
@ApiTags('admin/content/news')
@ApiBearerAuth('access-token')
@Controller('admin/content/news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  // ─── List ─────────────────────────────────────────────────────────────────

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'NewsArticle'))
  @ApiOperation({
    summary: 'List news articles (paginated). Filter by status, type, rubric, text.',
  })
  @ApiOkResponse({ type: ApiPaginatedResponseDto(NewsSummaryResponseDto) })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  findAll(@Query() query: ListNewsQueryDto) {
    return this.newsService.findAll(query);
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  @Post()
  @CheckPolicies((ability) => ability.can('create', 'NewsArticle'))
  @ApiOperation({ summary: 'Create a new article (starts as DRAFT).' })
  @ApiCreatedResponse({ type: ApiResponseDto(NewsSummaryResponseDto) })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Slug already in use' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  create(
    @Body() dto: CreateNewsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<NewsSummaryResponseDto> {
    return this.newsService.create(dto, actor);
  }

  // ─── FTS search ───────────────────────────────────────────────────────────
  // NOTE: '/search' MUST be declared before '/:id' to prevent NestJS routing
  // from treating the literal 'search' as a UUID path parameter.

  @Get('search')
  @Throttle({ global: { ttl: 60_000, limit: 30 } })
  @CheckPolicies((ability) => ability.can('read', 'NewsArticle'))
  @ApiOperation({
    summary: 'Full-text search over PUBLISHED news articles (tsvector + ts_rank_cd).',
    description:
      'Searches `title` and `body_text` using PostgreSQL Russian FTS. ' +
      'Results are ranked by `ts_rank_cd` (coverage density) descending, then `publication_index` ascending, then `created_at` descending. ' +
      'Only PUBLISHED, non-deleted articles are returned. ' +
      'Supports websearch operators: "exact phrase", -exclude, OR.',
  })
  @ApiOkResponse({ type: ApiPaginatedResponseDto(NewsSearchResultDto) })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  search(@Query() query: SearchNewsQueryDto): Promise<PaginatedResult<NewsSearchResultDto>> {
    return this.newsService.search(query);
  }

  // ─── Find one ─────────────────────────────────────────────────────────────

  @Get(':id')
  @CheckPolicies((ability) => ability.can('read', 'NewsArticle'))
  @ApiOperation({ summary: 'Get a single article with all its cards.' })
  @ApiParam({ name: 'id', description: 'Article UUID' })
  @ApiOkResponse({ type: ApiResponseDto(NewsResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<NewsResponseDto> {
    return this.newsService.findOne(id);
  }

  // ─── Update metadata ──────────────────────────────────────────────────────

  @Patch(':id')
  @CheckPolicies((ability) => ability.can('update', 'NewsArticle'))
  @ApiOperation({ summary: 'Update article metadata (title, anons, social meta, RSS, etc.).' })
  @ApiParam({ name: 'id', description: 'Article UUID' })
  @ApiOkResponse({ type: ApiResponseDto(NewsSummaryResponseDto) })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Slug already in use' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateNewsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<NewsSummaryResponseDto> {
    return this.newsService.update(id, dto, actor);
  }

  // ─── Soft delete ──────────────────────────────────────────────────────────

  @Delete(':id')
  @CheckPolicies((ability) => ability.can('delete', 'NewsArticle'))
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete an article (sets deletedAt; reversible via support).' })
  @ApiParam({ name: 'id', description: 'Article UUID' })
  @ApiNoContentResponse({ description: 'Article soft-deleted' })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  softDelete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.newsService.softDelete(id, actor);
  }

  // ─── Lifecycle: publish ───────────────────────────────────────────────────

  @Post(':id/publish')
  @CheckPolicies((ability) => ability.can('publish', 'NewsArticle'))
  @ApiOperation({
    summary:
      'Publish article (DRAFT/ARCHIVED → PUBLISHED). Triggers dual-write of bodyHtml + bodyText.',
  })
  @ApiParam({ name: 'id', description: 'Article UUID' })
  @ApiOkResponse({ type: ApiResponseDto(NewsResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Already published' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  publish(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<NewsResponseDto> {
    return this.newsService.publish(id, actor);
  }

  // ─── Lifecycle: revert to draft ───────────────────────────────────────────

  @Post(':id/draft')
  @CheckPolicies((ability) => ability.can('update', 'NewsArticle'))
  @ApiOperation({ summary: 'Revert published article back to DRAFT for further editing.' })
  @ApiParam({ name: 'id', description: 'Article UUID' })
  @ApiOkResponse({ type: ApiResponseDto(NewsResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Article is not published' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  revertToDraft(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<NewsResponseDto> {
    return this.newsService.revertToDraft(id, actor);
  }

  // ─── Lifecycle: archive ───────────────────────────────────────────────────

  @Post(':id/archive')
  @CheckPolicies((ability) => ability.can('archive', 'NewsArticle'))
  @ApiOperation({ summary: 'Archive a published article (PUBLISHED → ARCHIVED).' })
  @ApiParam({ name: 'id', description: 'Article UUID' })
  @ApiOkResponse({ type: ApiResponseDto(NewsResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Article is not published' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  archive(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<NewsResponseDto> {
    return this.newsService.archive(id, actor);
  }

  // ─── Preview ──────────────────────────────────────────────────────────────

  @Get(':id/preview')
  @CheckPolicies((ability) => ability.can('read', 'NewsArticle'))
  @ApiOperation({
    summary: 'Preview an article with on-the-fly compiled bodyHtml (works for DRAFT articles).',
  })
  @ApiParam({ name: 'id', description: 'Article UUID' })
  @ApiOkResponse({ type: ApiResponseDto(NewsPreviewResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  preview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<NewsPreviewResponseDto> {
    return this.newsService.getPreview(id);
  }

  // ─── Ad-banner code (restricted read) ────────────────────────────────────

  @Get(':id/ad-banner-code')
  @CheckPolicies((ability) => ability.can('update', 'NewsArticle'))
  @ApiOperation({
    summary:
      'Retrieve the raw ad-banner code snippet for an article. ' +
      'Restricted to CONTENT_MANAGER and SUPER_ADMIN — raw ad-tag HTML is never returned by the standard GET endpoint.',
  })
  @ApiParam({ name: 'id', description: 'Article UUID' })
  @ApiOkResponse({ type: ApiResponseDto(AdBannerCodeResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  getAdBannerCode(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<AdBannerCodeResponseDto> {
    return this.newsService.getAdBannerCode(id);
  }

  // ─── Cards: list ─────────────────────────────────────────────────────────

  @Get(':articleId/cards')
  @CheckPolicies((ability) => ability.can('read', 'NewsArticle'))
  @ApiOperation({ summary: 'List all cards of an article ordered by position.' })
  @ApiParam({ name: 'articleId', description: 'Article UUID' })
  @ApiOkResponse({ type: ApiArrayResponseDto(CardResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  findCards(
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
  ): Promise<CardResponseDto[]> {
    return this.newsService.findCards(articleId);
  }

  // ─── Cards: create ────────────────────────────────────────────────────────

  @Post(':articleId/cards')
  @CheckPolicies((ability) => ability.can('update', 'NewsArticle'))
  @ApiOperation({ summary: 'Add a new content card to an article.' })
  @ApiParam({ name: 'articleId', description: 'Article UUID' })
  @ApiCreatedResponse({ type: ApiResponseDto(CardResponseDto) })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'Invalid card data payload' })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  createCard(
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
    @Body() dto: CreateCardDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CardResponseDto> {
    return this.newsService.createCard(articleId, dto, actor);
  }

  // ─── Cards: update ────────────────────────────────────────────────────────

  @Patch(':articleId/cards/:cardId')
  @CheckPolicies((ability) => ability.can('update', 'NewsArticle'))
  @ApiOperation({ summary: "Update a card's content or position." })
  @ApiParam({ name: 'articleId', description: 'Article UUID' })
  @ApiParam({ name: 'cardId', description: 'Card UUID' })
  @ApiOkResponse({ type: ApiResponseDto(CardResponseDto) })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  updateCard(
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
    @Param('cardId', new ParseUUIDPipe({ version: '4' })) cardId: string,
    @Body() dto: UpdateCardDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CardResponseDto> {
    return this.newsService.updateCard(articleId, cardId, dto, actor);
  }

  // ─── Cards: delete ────────────────────────────────────────────────────────

  @Delete(':articleId/cards/:cardId')
  @CheckPolicies((ability) => ability.can('update', 'NewsArticle'))
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a card from an article.' })
  @ApiParam({ name: 'articleId', description: 'Article UUID' })
  @ApiParam({ name: 'cardId', description: 'Card UUID' })
  @ApiNoContentResponse({ description: 'Card deleted' })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  deleteCard(
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
    @Param('cardId', new ParseUUIDPipe({ version: '4' })) cardId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.newsService.deleteCard(articleId, cardId, actor);
  }

  // ─── Cards: reorder ───────────────────────────────────────────────────────

  @Put(':articleId/cards/order')
  @CheckPolicies((ability) => ability.can('update', 'NewsArticle'))
  @ApiOperation({
    summary: 'Reorder all cards of an article. Provide the complete ordered list of card UUIDs.',
  })
  @ApiParam({ name: 'articleId', description: 'Article UUID' })
  @ApiOkResponse({ type: ApiArrayResponseDto(CardResponseDto) })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'Missing or foreign card IDs' })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  reorderCards(
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
    @Body() dto: ReorderCardsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CardResponseDto[]> {
    return this.newsService.reorderCards(articleId, dto, actor);
  }
}
