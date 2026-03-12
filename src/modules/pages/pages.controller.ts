import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorResponseDto, ApiResponseDto } from '../../common/dto/api-response.dto.js';
import { CheckPolicies } from '../casl/decorators/check-policies.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator.js';
import { PagesService } from './pages.service.js';
import { CreatePageDto } from './dto/create-page.dto.js';
import { UpsertPageDto } from './dto/upsert-page.dto.js';
import { PageResponseDto, PageSummaryResponseDto } from './dto/page-response.dto.js';

/**
 * Manages dynamic pages created through the admin panel.
 *
 * CASL policy matrix:
 *   GET  /              → read Page   → CONTENT_MANAGER, SALES_MANAGER, SUPER_ADMIN
 *   POST /              → create Page → CONTENT_MANAGER, SUPER_ADMIN
 *   GET  /:slug         → read Page   → CONTENT_MANAGER, SALES_MANAGER, SUPER_ADMIN
 *   PUT  /:slug         → update Page → CONTENT_MANAGER, SUPER_ADMIN
 *   POST /:slug/publish → publish Page→ CONTENT_MANAGER, SUPER_ADMIN
 *   POST /:slug/archive → archive Page→ CONTENT_MANAGER, SUPER_ADMIN
 *
 * Routes sit behind the global JwtAuthGuard + PoliciesGuard.
 * @CheckPolicies further restricts individual operations.
 */
@ApiTags('admin/content/pages')
@ApiBearerAuth('access-token')
@Controller('admin/content/pages')
export class PagesController {
  constructor(private readonly pagesService: PagesService) {}

  // ─── GET /admin/content/pages ─────────────────────────────────────────────

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'Page'))
  @ApiOperation({ summary: 'List all pages (summary, no sections).' })
  @ApiOkResponse({ type: PageSummaryResponseDto, isArray: true })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  findAll(): Promise<PageSummaryResponseDto[]> {
    return this.pagesService.findAll();
  }

  // ─── POST /admin/content/pages ────────────────────────────────────────────

  @Post()
  @CheckPolicies((ability) => ability.can('create', 'Page'))
  @ApiOperation({ summary: 'Create a new page (starts as DRAFT).' })
  @ApiCreatedResponse({ type: ApiResponseDto(PageSummaryResponseDto) })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Slug already in use' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  create(
    @Body() dto: CreatePageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PageSummaryResponseDto> {
    return this.pagesService.create(dto, actor);
  }

  // ─── GET /admin/content/pages/:slug ──────────────────────────────────────

  @Get(':slug')
  @CheckPolicies((ability) => ability.can('read', 'Page'))
  @ApiOperation({ summary: 'Get a page with all its sections.' })
  @ApiParam({ name: 'slug', type: String, description: 'URL-safe page slug' })
  @ApiOkResponse({ type: ApiResponseDto(PageResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'Page not found' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  findOne(@Param('slug') slug: string): Promise<PageResponseDto> {
    return this.pagesService.findOne(slug);
  }

  // ─── PUT /admin/content/pages/:slug ──────────────────────────────────────

  @Put(':slug')
  @CheckPolicies((ability) => ability.can('update', 'Page'))
  @ApiOperation({
    summary: 'Replace all sections of a page.',
    description:
      'Atomically replaces all page sections. Send an empty `sections` array to clear all sections. ' +
      "Each section's `data` is validated by Zod for its SectionType.",
  })
  @ApiParam({ name: 'slug', type: String, description: 'URL-safe page slug' })
  @ApiOkResponse({ type: ApiResponseDto(PageResponseDto) })
  @ApiBadRequestResponse({
    type: ApiErrorResponseDto,
    description: 'Section data or order validation failed',
  })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'Page not found' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  upsert(
    @Param('slug') slug: string,
    @Body() dto: UpsertPageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PageResponseDto> {
    return this.pagesService.upsert(slug, dto, actor);
  }

  // ─── POST /admin/content/pages/:slug/publish ─────────────────────────────

  @Post(':slug/publish')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('publish', 'Page'))
  @ApiOperation({ summary: 'Publish a page (DRAFT/ARCHIVED → PUBLISHED).' })
  @ApiParam({ name: 'slug', type: String, description: 'URL-safe page slug' })
  @ApiOkResponse({ type: ApiResponseDto(PageResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'Page not found' })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Page is already published' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  publish(
    @Param('slug') slug: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PageResponseDto> {
    return this.pagesService.publish(slug, actor);
  }

  // ─── POST /admin/content/pages/:slug/archive ─────────────────────────────

  @Post(':slug/archive')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('archive', 'Page'))
  @ApiOperation({ summary: 'Archive a page (PUBLISHED → ARCHIVED).' })
  @ApiParam({ name: 'slug', type: String, description: 'URL-safe page slug' })
  @ApiOkResponse({ type: ApiResponseDto(PageResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'Page not found' })
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description: 'Page is already archived or still in DRAFT',
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  archive(
    @Param('slug') slug: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PageResponseDto> {
    return this.pagesService.archive(slug, actor);
  }
}
