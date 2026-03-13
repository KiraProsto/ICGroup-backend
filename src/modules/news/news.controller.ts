import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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
  ApiErrorResponseDto,
  ApiPaginatedResponseDto,
  ApiResponseDto,
} from '../../common/dto/api-response.dto.js';
import { CheckPolicies } from '../casl/decorators/check-policies.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator.js';
import { NewsService } from './news.service.js';
import { CreateNewsDto } from './dto/create-news.dto.js';
import { UpdateNewsDto } from './dto/update-news.dto.js';
import { ListNewsQueryDto } from './dto/list-news-query.dto.js';
import { CreateCardDto } from './dto/create-card.dto.js';
import { UpdateCardDto } from './dto/update-card.dto.js';
import { ReorderCardsDto } from './dto/reorder-cards.dto.js';
import {
  CardResponseDto,
  NewsPreviewResponseDto,
  NewsResponseDto,
  NewsSummaryResponseDto,
} from './dto/news-response.dto.js';

/**
 * Manages news articles and their content cards in the admin panel.
 *
 * CASL policy matrix:
 *   GET         /                            → read  NewsArticle  (CM, SM, SA)
 *   POST        /                            → create NewsArticle (CM, SA)
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

  // ─── Find one ─────────────────────────────────────────────────────────────

  @Get(':id')
  @CheckPolicies((ability) => ability.can('read', 'NewsArticle'))
  @ApiOperation({ summary: 'Get a single article with all its cards.' })
  @ApiParam({ name: 'id', description: 'Article UUID' })
  @ApiOkResponse({ type: ApiResponseDto(NewsResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  findOne(@Param('id') id: string): Promise<NewsResponseDto> {
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
    @Param('id') id: string,
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
  softDelete(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
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
    @Param('id') id: string,
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
    @Param('id') id: string,
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
    @Param('id') id: string,
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
  preview(@Param('id') id: string): Promise<NewsPreviewResponseDto> {
    return this.newsService.getPreview(id);
  }

  // ─── Cards: list ─────────────────────────────────────────────────────────

  @Get(':articleId/cards')
  @CheckPolicies((ability) => ability.can('read', 'NewsArticle'))
  @ApiOperation({ summary: 'List all cards of an article ordered by position.' })
  @ApiParam({ name: 'articleId', description: 'Article UUID' })
  @ApiOkResponse({ type: CardResponseDto, isArray: true })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  findCards(@Param('articleId') articleId: string): Promise<CardResponseDto[]> {
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
    @Param('articleId') articleId: string,
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
    @Param('articleId') articleId: string,
    @Param('cardId') cardId: string,
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
    @Param('articleId') articleId: string,
    @Param('cardId') cardId: string,
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
  @ApiOkResponse({ type: CardResponseDto, isArray: true })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'Missing or foreign card IDs' })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  reorderCards(
    @Param('articleId') articleId: string,
    @Body() dto: ReorderCardsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CardResponseDto[]> {
    return this.newsService.reorderCards(articleId, dto, actor);
  }
}
