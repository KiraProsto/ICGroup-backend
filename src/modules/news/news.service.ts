import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ZodError } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import {
  AuditAction,
  AuditResourceType,
  ArticleCardType,
  ArticleType,
  ContentStatus,
  Role,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator.js';
import {
  paginatedResult,
  type PaginatedResult,
} from '../../common/interceptors/transform-response.interceptor.js';
import { renderToHtml, extractPlainText } from '../../common/tiptap/extensions.js';
import type { JSONContent } from '@tiptap/core';
import {
  validateCardData,
  type TextCardData,
  type QuoteCardData,
  type PublicationCardData,
  type ImageCardData,
  type VideoCardData,
} from './schemas/card-data.schema.js';
import type { CreateNewsDto } from './dto/create-news.dto.js';
import type { UpdateNewsDto } from './dto/update-news.dto.js';
import type { ListNewsQueryDto } from './dto/list-news-query.dto.js';
import type { CreateCardDto } from './dto/create-card.dto.js';
import type { UpdateCardDto } from './dto/update-card.dto.js';
import type { ReorderCardsDto } from './dto/reorder-cards.dto.js';
import type {
  AdBannerCodeResponseDto,
  CardResponseDto,
  NewsPreviewResponseDto,
  NewsResponseDto,
  NewsSummaryResponseDto,
} from './dto/news-response.dto.js';

const CARD_ORDER_TEMP_OFFSET = 1_000_000;
const SERIALIZABLE_RETRY_LIMIT = 5;

// ─── Cyrillic transliteration map ────────────────────────────────────────────

const CYRILLIC_MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'j',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .split('')
      .map((c) => CYRILLIC_MAP[c] ?? c)
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200) || 'article'
  );
}

// ─── Prisma select shapes ─────────────────────────────────────────────────────

const ARTICLE_SUMMARY_SELECT = {
  id: true,
  slug: true,
  title: true,
  articleType: true,
  rubricId: true,
  status: true,
  publishedAt: true,
  coverImage: true,
  excerptTitle: true,
  publicationIndex: true,
  authorId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ARTICLE_FULL_SELECT = {
  ...ARTICLE_SUMMARY_SELECT,
  excerpt: true,
  excerptImage: true,
  socialMeta: true,
  rssGoogleNews: true,
  rssYandexDzen: true,
  rssYandexNews: true,
  rssDefault: true,
  adBannerCode: true,
  adBannerImage: true,
} as const;

const CARD_SELECT = {
  id: true,
  articleId: true,
  type: true,
  order: true,
  data: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ─── Row types ────────────────────────────────────────────────────────────────

type ArticleSummaryRow = {
  id: string;
  slug: string;
  title: string;
  articleType: ArticleType;
  rubricId: string | null;
  status: ContentStatus;
  publishedAt: Date | null;
  coverImage: string | null;
  excerptTitle: string | null;
  publicationIndex: number;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
};

type ArticleFullRow = ArticleSummaryRow & {
  excerpt: string | null;
  excerptImage: string | null;
  socialMeta: Prisma.JsonValue;
  rssGoogleNews: boolean;
  rssYandexDzen: boolean;
  rssYandexNews: boolean;
  rssDefault: boolean;
  adBannerCode: string | null;
  adBannerImage: string | null;
};

type CardRow = {
  id: string;
  articleId: string;
  type: ArticleCardType;
  order: number;
  data: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapCard(row: CardRow): CardResponseDto {
  return {
    id: row.id,
    articleId: row.articleId,
    type: row.type,
    order: row.order,
    data: row.data as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapSummary(row: ArticleSummaryRow): NewsSummaryResponseDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    articleType: row.articleType,
    rubricId: row.rubricId,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    coverImage: row.coverImage,
    excerptTitle: row.excerptTitle,
    publicationIndex: row.publicationIndex,
    authorId: row.authorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapFull(row: ArticleFullRow, cards: CardRow[]): NewsResponseDto {
  return {
    ...mapSummary(row),
    excerpt: row.excerpt,
    excerptImage: row.excerptImage,
    coverImageFull: row.coverImage,
    socialMeta: row.socialMeta as Record<string, unknown> | null,
    rssGoogleNews: row.rssGoogleNews,
    rssYandexDzen: row.rssYandexDzen,
    rssYandexNews: row.rssYandexNews,
    rssDefault: row.rssDefault,
    hasAdBannerCode: row.adBannerCode !== null,
    adBannerImage: row.adBannerImage,
    cards: cards.map(mapCard),
  };
}

function toAuditSnapshot(row: ArticleSummaryRow): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    authorId: row.authorId,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

// ─── HTML/Text compilation from cards ────────────────────────────────────────

/**
 * Escapes a plain string for safe HTML insertion.
 * Used only for QUOTE card text — no external HTML is constructed from user input.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeAdBannerCode(code: string): string {
  const normalized = code.trim();

  const blockedPattern =
    /<\/?(?:iframe|object|embed|meta|base|form|input|button|textarea|select)\b|\s+on[a-z]+\s*=|javascript\s*:|\bsrcdoc\s*=/i;
  if (blockedPattern.test(normalized)) {
    throw new BadRequestException(
      'adBannerCode contains disallowed HTML or script constructs; only sandboxed ad tag snippets are accepted',
    );
  }

  return normalized;
}

interface CompiledBody {
  bodyHtml: string;
  bodyText: string;
  /** Combined Tiptap JSON from all TEXT cards (stored as NewsArticle.body). */
  tiptapBody: JSONContent;
}

/**
 * Compiles ordered ArticleCard rows into bodyHtml, bodyText, and tiptapBody.
 * For PUBLICATION cards, look-up data must be pre-fetched and passed in `pubMap`.
 */
function compileCards(
  cards: CardRow[],
  pubMap: Map<string, { title: string; coverImage: string | null; slug: string }>,
): CompiledBody {
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  const tiptapContent: JSONContent['content'] = [];

  for (const card of cards) {
    const data = card.data as Record<string, unknown>;

    switch (card.type) {
      case ArticleCardType.TEXT: {
        const tData = data as TextCardData;
        const html = renderToHtml(tData.body as JSONContent);
        const text = extractPlainText(tData.body as JSONContent);
        htmlParts.push(html);
        textParts.push(text);
        // Collect top-level nodes for the combined Tiptap document
        const bodyContent = (tData.body as JSONContent).content;
        if (Array.isArray(bodyContent)) {
          tiptapContent.push(...bodyContent);
        }
        break;
      }

      case ArticleCardType.QUOTE: {
        const qData = data as QuoteCardData;
        htmlParts.push(`<blockquote><p>${escapeHtml(qData.text)}</p></blockquote>`);
        textParts.push(qData.text);
        break;
      }

      case ArticleCardType.PUBLICATION: {
        const pData = data as PublicationCardData;
        const ref = pubMap.get(pData.articleId);
        if (ref) {
          const imgTag = ref.coverImage
            ? `<img src="${escapeHtml(ref.coverImage)}" alt="${escapeHtml(ref.title)}" loading="lazy">`
            : '';
          htmlParts.push(
            `<div class="embedded-publication"><a href="/press/${escapeHtml(ref.slug)}">${imgTag}<span>${escapeHtml(ref.title)}</span></a></div>`,
          );
          textParts.push(ref.title);
        }
        break;
      }

      case ArticleCardType.IMAGE: {
        const iData = data as ImageCardData;
        const caption = iData.caption ? escapeHtml(iData.caption) : '';
        htmlParts.push(
          `<figure><img src="${escapeHtml(iData.url)}" alt="${caption}" loading="lazy">${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`,
        );
        if (iData.caption) textParts.push(iData.caption);
        break;
      }

      case ArticleCardType.VIDEO: {
        const vData = data as VideoCardData;
        const caption = vData.caption ? escapeHtml(vData.caption) : '';
        htmlParts.push(
          `<div class="video-embed"><a href="${escapeHtml(vData.url)}" target="_blank" rel="noopener noreferrer">${caption || vData.url}</a></div>`,
        );
        if (vData.caption) textParts.push(vData.caption);
        break;
      }
    }
  }

  return {
    bodyHtml: htmlParts.join('\n'),
    bodyText: textParts.join('\n\n'),
    tiptapBody: { type: 'doc', content: tiptapContent },
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * NewsService manages the full lifecycle of news articles and their content cards.
 *
 * Key invariants:
 *  - NewsArticle.slug is UNIQUE; auto-generated from title if not provided.
 *  - Soft delete: deletedAt is set instead of hard deletion; all queries filter it.
 *  - Publish dual-write: on publish, cards are compiled into bodyHtml + bodyText + body.
 *  - Cards are ordered by the `order` field; reorder is a transactional bulk update.
 *  - Card data is Zod-validated per type before any DB write.
 */
@Injectable()
export class NewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Article CRUD ─────────────────────────────────────────────────────────

  async create(dto: CreateNewsDto, actor: AuthenticatedUser): Promise<NewsSummaryResponseDto> {
    const baseSlug = dto.slug ?? slugify(dto.title);
    const slug = await this.ensureUniqueSlug(baseSlug);

    const article = await this.prisma.newsArticle
      .create({
        data: {
          title: dto.title,
          slug,
          articleType: dto.articleType ?? ArticleType.NEWS,
          rubricId: dto.rubricId ?? null,
          excerptTitle: dto.excerptTitle ?? null,
          excerpt: dto.excerpt ?? null,
          excerptImage: dto.excerptImage ?? null,
          coverImage: dto.coverImage ?? null,
          status: ContentStatus.DRAFT,
          publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
          socialMeta:
            dto.socialMeta != null ? (dto.socialMeta as Prisma.InputJsonValue) : Prisma.JsonNull,
          rssGoogleNews: dto.rssGoogleNews ?? false,
          rssYandexDzen: dto.rssYandexDzen ?? false,
          rssYandexNews: dto.rssYandexNews ?? false,
          rssDefault: dto.rssDefault ?? false,
          publicationIndex: dto.publicationIndex ?? 500,
          adBannerCode:
            dto.adBannerCode !== undefined ? normalizeAdBannerCode(dto.adBannerCode) : null,
          adBannerImage: dto.adBannerImage ?? null,
          authorId: actor.role === Role.SUPER_ADMIN && dto.authorId ? dto.authorId : actor.id,
        },
        select: ARTICLE_SUMMARY_SELECT,
      })
      .catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException(`News article with slug "${slug}" already exists`);
        }
        throw e;
      });

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.CREATE,
      resourceType: AuditResourceType.NewsArticle,
      resourceId: article.id,
      beforeSnapshot: null,
      afterSnapshot: toAuditSnapshot(article),
    });

    return mapSummary(article);
  }

  async findAll(query: ListNewsQueryDto): Promise<PaginatedResult<NewsSummaryResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const trimmedQuery = query.q?.trim();

    const where: Prisma.NewsArticleWhereInput = {
      deletedAt: null,
      ...(query.status && { status: query.status }),
      ...(query.articleType && { articleType: query.articleType }),
      ...(query.rubricId && { rubricId: query.rubricId }),
    };

    if (trimmedQuery) {
      return this.findAllByFullTextSearch({
        where,
        query,
        trimmedQuery,
        page,
        perPage,
      });
    }

    const [articles, total] = await Promise.all([
      this.prisma.newsArticle.findMany({
        where,
        select: ARTICLE_SUMMARY_SELECT,
        orderBy: [{ publicationIndex: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.newsArticle.count({ where }),
    ]);

    return paginatedResult(articles.map(mapSummary), {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    });
  }

  async findOne(id: string): Promise<NewsResponseDto> {
    const article = await this.findArticleOrThrow(id, ARTICLE_FULL_SELECT);
    const cards = await this.prisma.articleCard.findMany({
      where: { articleId: id },
      select: CARD_SELECT,
      orderBy: { order: 'asc' },
    });
    return mapFull(article as ArticleFullRow, cards);
  }

  async update(
    id: string,
    dto: UpdateNewsDto,
    actor: AuthenticatedUser,
  ): Promise<NewsSummaryResponseDto> {
    const existing = await this.findArticleOrThrow(id, ARTICLE_SUMMARY_SELECT);
    const before = toAuditSnapshot(existing);

    // If caller provides a new slug, ensure it is not already taken
    let newSlug = existing.slug;
    if (dto.slug && dto.slug !== existing.slug) {
      await this.assertSlugAvailable(dto.slug);
      newSlug = dto.slug;
    }

    const data: Prisma.NewsArticleUncheckedUpdateInput = {
      ...(dto.title !== undefined && { title: dto.title }),
      slug: newSlug,
      ...(dto.articleType !== undefined && { articleType: dto.articleType }),
      ...(dto.rubricId !== undefined && { rubricId: dto.rubricId ?? null }),
      ...(dto.excerptTitle !== undefined && { excerptTitle: dto.excerptTitle }),
      ...(dto.excerpt !== undefined && { excerpt: dto.excerpt }),
      ...(dto.excerptImage !== undefined && { excerptImage: dto.excerptImage }),
      ...(dto.coverImage !== undefined && { coverImage: dto.coverImage }),
      ...(dto.publishedAt !== undefined && {
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
      }),
      ...(dto.socialMeta !== undefined && {
        socialMeta:
          dto.socialMeta != null ? (dto.socialMeta as Prisma.InputJsonValue) : Prisma.JsonNull,
      }),
      ...(dto.rssGoogleNews !== undefined && { rssGoogleNews: dto.rssGoogleNews }),
      ...(dto.rssYandexDzen !== undefined && { rssYandexDzen: dto.rssYandexDzen }),
      ...(dto.rssYandexNews !== undefined && { rssYandexNews: dto.rssYandexNews }),
      ...(dto.rssDefault !== undefined && { rssDefault: dto.rssDefault }),
      ...(dto.publicationIndex !== undefined && { publicationIndex: dto.publicationIndex }),
      ...(dto.adBannerCode !== undefined && {
        adBannerCode: normalizeAdBannerCode(dto.adBannerCode),
      }),
      ...(dto.adBannerImage !== undefined && { adBannerImage: dto.adBannerImage }),
      ...(dto.authorId !== undefined &&
        actor.role === Role.SUPER_ADMIN && { authorId: dto.authorId }),
    };

    const updated = await this.prisma.newsArticle.update({
      where: { id },
      data,
      select: ARTICLE_SUMMARY_SELECT,
    });

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.UPDATE,
      resourceType: AuditResourceType.NewsArticle,
      resourceId: id,
      beforeSnapshot: before,
      afterSnapshot: toAuditSnapshot(updated),
    });

    return mapSummary(updated);
  }

  /**
   * Soft-deletes an article by setting deletedAt.
   * Permanently retains cards in DB (cascade delete only on hard delete).
   */
  async softDelete(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.findArticleOrThrow(id, ARTICLE_SUMMARY_SELECT);

    await this.prisma.newsArticle.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.DELETE,
      resourceType: AuditResourceType.NewsArticle,
      resourceId: id,
      beforeSnapshot: toAuditSnapshot(existing),
      afterSnapshot: null,
    });
  }

  // ─── Lifecycle transitions ────────────────────────────────────────────────

  /**
   * DRAFT/ARCHIVED → PUBLISHED
   * Dual-write: compiles cards → bodyHtml + bodyText + body (tiptap JSON).
   */
  async publish(id: string, actor: AuthenticatedUser): Promise<NewsResponseDto> {
    const existing = await this.findArticleOrThrow(id, ARTICLE_SUMMARY_SELECT);
    const before = toAuditSnapshot(existing);

    const cards = await this.prisma.articleCard.findMany({
      where: { articleId: id },
      select: CARD_SELECT,
      orderBy: { order: 'asc' },
    });

    // Prefetch referenced publication articles for PUBLICATION cards
    const pubMap = await this.buildPublicationMap(cards);

    const { bodyHtml, bodyText, tiptapBody } = compileCards(cards, pubMap);

    const updated = await this.prisma.newsArticle
      .update({
        where: { id, status: { not: ContentStatus.PUBLISHED }, deletedAt: null },
        data: {
          status: ContentStatus.PUBLISHED,
          publishedAt: existing.publishedAt ?? new Date(),
          body: tiptapBody as Prisma.InputJsonValue,
          bodyHtml,
          bodyText,
        },
        select: ARTICLE_FULL_SELECT,
      })
      .catch(async (e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
          const current = await this.prisma.newsArticle.findFirst({
            where: { id, deletedAt: null },
            select: { id: true },
          });
          if (!current) throw new NotFoundException(`News article "${id}" not found`);
          throw new ConflictException(`News article "${id}" is already published`);
        }
        throw e;
      });

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.PUBLISH,
      resourceType: AuditResourceType.NewsArticle,
      resourceId: id,
      beforeSnapshot: before,
      afterSnapshot: toAuditSnapshot(updated as ArticleSummaryRow),
      metadata: { cardCount: cards.length },
    });

    return mapFull(updated as ArticleFullRow, cards);
  }

  /**
   * PUBLISHED → DRAFT  (revert to editable state)
   */
  async revertToDraft(id: string, actor: AuthenticatedUser): Promise<NewsResponseDto> {
    const existing = await this.findArticleOrThrow(id, ARTICLE_SUMMARY_SELECT);
    const before = toAuditSnapshot(existing);

    const updated = await this.prisma.newsArticle
      .update({
        where: { id, status: ContentStatus.PUBLISHED, deletedAt: null },
        data: { status: ContentStatus.DRAFT },
        select: ARTICLE_FULL_SELECT,
      })
      .catch(async (e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
          throw new ConflictException(
            `News article "${id}" is not published — cannot revert to draft`,
          );
        }
        throw e;
      });

    const cards = await this.prisma.articleCard.findMany({
      where: { articleId: id },
      select: CARD_SELECT,
      orderBy: { order: 'asc' },
    });

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.UPDATE,
      resourceType: AuditResourceType.NewsArticle,
      resourceId: id,
      beforeSnapshot: before,
      afterSnapshot: toAuditSnapshot(updated as ArticleSummaryRow),
      metadata: { transition: 'PUBLISHED→DRAFT' },
    });

    return mapFull(updated as ArticleFullRow, cards);
  }

  /**
   * PUBLISHED → ARCHIVED
   */
  async archive(id: string, actor: AuthenticatedUser): Promise<NewsResponseDto> {
    const existing = await this.findArticleOrThrow(id, ARTICLE_SUMMARY_SELECT);
    const before = toAuditSnapshot(existing);

    const updated = await this.prisma.newsArticle
      .update({
        where: { id, status: ContentStatus.PUBLISHED, deletedAt: null },
        data: { status: ContentStatus.ARCHIVED },
        select: ARTICLE_FULL_SELECT,
      })
      .catch(async (e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
          throw new ConflictException(`News article "${id}" is not published — cannot archive`);
        }
        throw e;
      });

    const cards = await this.prisma.articleCard.findMany({
      where: { articleId: id },
      select: CARD_SELECT,
      orderBy: { order: 'asc' },
    });

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.ARCHIVE,
      resourceType: AuditResourceType.NewsArticle,
      resourceId: id,
      beforeSnapshot: before,
      afterSnapshot: toAuditSnapshot(updated as ArticleSummaryRow),
    });

    return mapFull(updated as ArticleFullRow, cards);
  }

  /**
   * Returns a read-only preview of the article with on-the-fly compiled bodyHtml.
   * Accessible for DRAFT articles — does not require PUBLISHED status.
   */
  async getPreview(id: string): Promise<NewsPreviewResponseDto> {
    const article = await this.findArticleOrThrow(id, ARTICLE_FULL_SELECT);
    const cards = await this.prisma.articleCard.findMany({
      where: { articleId: id },
      select: CARD_SELECT,
      orderBy: { order: 'asc' },
    });

    const pubMap = await this.buildPublicationMap(cards);
    const { bodyHtml } = compileCards(cards, pubMap);

    return {
      ...mapFull(article as ArticleFullRow, cards),
      bodyHtml,
    };
  }

  // ─── Ad-banner code (restricted read) ────────────────────────────────────

  /**
   * Returns the raw adBannerCode for an article.
   * Intentionally separated from the standard GET to restrict access — only
   * callers with 'update NewsArticle' permission (CONTENT_MANAGER / SUPER_ADMIN)
   * should ever receive raw ad-tag HTML snippets.
   */
  async getAdBannerCode(id: string): Promise<AdBannerCodeResponseDto> {
    const article = await this.findArticleOrThrow(id, {
      id: true,
      adBannerCode: true,
    } as const);
    return {
      id: (article as { id: string; adBannerCode: string | null }).id,
      adBannerCode: (article as { id: string; adBannerCode: string | null }).adBannerCode,
    };
  }

  // ─── Cards CRUD ───────────────────────────────────────────────────────────

  async findCards(articleId: string): Promise<CardResponseDto[]> {
    await this.findArticleOrThrow(articleId, { id: true } as const);
    const cards = await this.prisma.articleCard.findMany({
      where: { articleId },
      select: CARD_SELECT,
      orderBy: { order: 'asc' },
    });
    return cards.map(mapCard);
  }

  async createCard(
    articleId: string,
    dto: CreateCardDto,
    actor: AuthenticatedUser,
  ): Promise<CardResponseDto> {
    // Zod validation — pure, no DB needed
    const validatedData = this.parseCardData(dto.type, dto.data);

    const created = await this.withSerializableTx(async (tx) => {
      // Verify publication reference inside the tx so the read participates in
      // Serializable isolation — prevents a referenced article from being
      // unpublished between this check and the commit.
      await this.assertPublicationCardReference(articleId, dto.type, validatedData, tx);

      // Verify article mutability inside the tx so concurrent publishes are caught.
      const article = await tx.newsArticle.findFirst({
        where: { id: articleId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!article) {
        throw new NotFoundException(`News article "${articleId}" not found`);
      }
      if (article.status === ContentStatus.PUBLISHED) {
        throw new ConflictException(
          `News article "${articleId}" is published — revert it to draft before editing cards`,
        );
      }

      // Serializable read prevents concurrent inserts from picking the same position.
      const existingCards = await tx.articleCard.findMany({
        where: { articleId },
        select: { id: true },
        orderBy: { order: 'asc' },
      });

      const insertIndex = dto.order ?? existingCards.length;
      if (insertIndex > existingCards.length) {
        throw new BadRequestException(
          `Card order ${insertIndex} is out of bounds for article with ${existingCards.length} cards`,
        );
      }

      // Insert with a temporary high order value to avoid unique-index conflicts
      // during the creation step before the bulk-order update.
      const card = await tx.articleCard.create({
        data: {
          articleId,
          type: dto.type,
          order: CARD_ORDER_TEMP_OFFSET + existingCards.length,
          data: validatedData as Prisma.InputJsonValue,
        },
        select: CARD_SELECT,
      });

      const orderedCardIds = existingCards.map((c) => c.id);
      orderedCardIds.splice(insertIndex, 0, card.id);
      await this.persistCardOrder(orderedCardIds, tx);

      // Re-read to get settled order value
      const finalCard = await tx.articleCard.findFirst({
        where: { id: card.id, articleId },
        select: CARD_SELECT,
      });
      if (!finalCard) {
        throw new NotFoundException(`Card "${card.id}" unexpectedly missing after creation`);
      }
      return finalCard;
    });

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.CREATE,
      resourceType: AuditResourceType.NewsArticle,
      resourceId: articleId,
      beforeSnapshot: null,
      afterSnapshot: { cardId: created.id, type: created.type, order: created.order },
      metadata: { cardId: created.id },
    });

    return mapCard(created);
  }

  async updateCard(
    articleId: string,
    cardId: string,
    dto: UpdateCardDto,
    actor: AuthenticatedUser,
  ): Promise<CardResponseDto> {
    const { before, updated } = await this.withSerializableTx(async (tx) => {
      // 1. Verify article mutability inside tx
      const article = await tx.newsArticle.findFirst({
        where: { id: articleId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!article) {
        throw new NotFoundException(`News article "${articleId}" not found`);
      }
      if (article.status === ContentStatus.PUBLISHED) {
        throw new ConflictException(
          `News article "${articleId}" is published — revert it to draft before editing cards`,
        );
      }

      // 2. Read card inside tx
      const card = await tx.articleCard.findFirst({
        where: { id: cardId, articleId },
        select: CARD_SELECT,
      });
      if (!card) {
        throw new NotFoundException(`Card "${cardId}" not found in article "${articleId}"`);
      }

      // 3. Validate and apply data update (type is immutable after creation)
      if (dto.data !== undefined) {
        const validatedData = this.parseCardData(card.type, dto.data);
        await this.assertPublicationCardReference(articleId, card.type, validatedData, tx);
        await tx.articleCard.update({
          where: { id: cardId },
          data: { data: validatedData as Prisma.InputJsonValue },
        });
      }

      // 4. Apply order change atomically within the same tx
      if (dto.order !== undefined && dto.order !== card.order) {
        const existingCards = await tx.articleCard.findMany({
          where: { articleId },
          select: { id: true },
          orderBy: { order: 'asc' },
        });

        if (dto.order >= existingCards.length) {
          throw new BadRequestException(
            `Card order ${dto.order} is out of bounds for article with ${existingCards.length} cards`,
          );
        }

        const orderedCardIds = existingCards.map((c) => c.id);
        const currentIndex = orderedCardIds.indexOf(cardId);
        orderedCardIds.splice(currentIndex, 1);
        orderedCardIds.splice(dto.order, 0, cardId);
        await this.persistCardOrder(orderedCardIds, tx);
      }

      // 5. Re-read settled state
      const updatedCard = await tx.articleCard.findFirst({
        where: { id: cardId, articleId },
        select: CARD_SELECT,
      });
      if (!updatedCard) {
        throw new NotFoundException(`Card "${cardId}" unexpectedly missing after update`);
      }

      return { before: card, updated: updatedCard };
    });

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.UPDATE,
      resourceType: AuditResourceType.NewsArticle,
      resourceId: articleId,
      beforeSnapshot: { cardId, order: before.order },
      afterSnapshot: { cardId, order: updated.order },
      metadata: { cardId },
    });

    return mapCard(updated);
  }

  async deleteCard(articleId: string, cardId: string, actor: AuthenticatedUser): Promise<void> {
    const deletedCard = await this.withSerializableTx(async (tx) => {
      // 1. Verify article mutability
      const article = await tx.newsArticle.findFirst({
        where: { id: articleId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!article) {
        throw new NotFoundException(`News article "${articleId}" not found`);
      }
      if (article.status === ContentStatus.PUBLISHED) {
        throw new ConflictException(
          `News article "${articleId}" is published — revert it to draft before editing cards`,
        );
      }

      // 2. Find the card
      const card = await tx.articleCard.findFirst({
        where: { id: cardId, articleId },
        select: CARD_SELECT,
      });
      if (!card) {
        throw new NotFoundException(`Card "${cardId}" not found in article "${articleId}"`);
      }

      // 3. Delete the card
      await tx.articleCard.delete({ where: { id: cardId } });

      // 4. Compact order values for the remaining cards
      const remainingCards = await tx.articleCard.findMany({
        where: { articleId },
        select: { id: true },
        orderBy: { order: 'asc' },
      });
      await this.persistCardOrder(
        remainingCards.map((c) => c.id),
        tx,
      );

      return card;
    });

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.DELETE,
      resourceType: AuditResourceType.NewsArticle,
      resourceId: articleId,
      beforeSnapshot: { cardId, type: deletedCard.type, order: deletedCard.order },
      afterSnapshot: null,
      metadata: { cardId },
    });
  }

  /**
   * Atomically replaces card order values based on the submitted cardIds array.
   * Position in the array = new order value (0-based).
   * All provided cardIds must belong to the given article.
   */
  async reorderCards(
    articleId: string,
    dto: ReorderCardsDto,
    actor: AuthenticatedUser,
  ): Promise<CardResponseDto[]> {
    const { beforeOrder, cards } = await this.withSerializableTx(async (tx) => {
      // 1. Verify mutability inside tx so concurrent publishes are caught
      const article = await tx.newsArticle.findFirst({
        where: { id: articleId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!article) {
        throw new NotFoundException(`News article "${articleId}" not found`);
      }
      if (article.status === ContentStatus.PUBLISHED) {
        throw new ConflictException(
          `News article "${articleId}" is published — revert it to draft before editing cards`,
        );
      }

      // 2. Read existing cards with a serializable lock to prevent concurrent structural changes
      const existing = await tx.articleCard.findMany({
        where: { articleId },
        select: { id: true, order: true },
        orderBy: { order: 'asc' },
      });

      // 3. Validate the submitted order list
      const uniqueRequestedIds = new Set(dto.cardIds);
      if (uniqueRequestedIds.size !== dto.cardIds.length) {
        throw new BadRequestException('Reorder list contains duplicate card IDs');
      }

      const existingIds = new Set(existing.map((c) => c.id));
      const invalidIds = dto.cardIds.filter((cid) => !existingIds.has(cid));
      if (invalidIds.length > 0) {
        throw new BadRequestException(`Card IDs not found in article: ${invalidIds.join(', ')}`);
      }
      if (dto.cardIds.length !== existingIds.size) {
        throw new BadRequestException(
          `Reorder list must include all ${existingIds.size} cards of the article`,
        );
      }

      // 4. Apply new order within the tx
      await this.persistCardOrder(dto.cardIds, tx);

      // 5. Return updated cards
      const updatedCards = await tx.articleCard.findMany({
        where: { articleId },
        select: CARD_SELECT,
        orderBy: { order: 'asc' },
      });

      return { beforeOrder: existing.map((c) => c.id), cards: updatedCards };
    });

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.UPDATE,
      resourceType: AuditResourceType.NewsArticle,
      resourceId: articleId,
      beforeSnapshot: { cardOrder: beforeOrder },
      afterSnapshot: { cardOrder: dto.cardIds },
      metadata: { operation: 'reorder' },
    });

    return cards.map(mapCard);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async findArticleOrThrow<S extends Prisma.NewsArticleSelect>(
    id: string,
    select: S,
  ): Promise<Prisma.NewsArticleGetPayload<{ select: S }>> {
    const article = await this.prisma.newsArticle.findFirst({
      where: { id, deletedAt: null },
      select,
    });
    if (!article) {
      throw new NotFoundException(`News article "${id}" not found`);
    }
    return article;
  }

  private async findCardOrThrow(articleId: string, cardId: string): Promise<CardRow> {
    const card = await this.prisma.articleCard.findFirst({
      where: { id: cardId, articleId },
      select: CARD_SELECT,
    });
    if (!card) {
      throw new NotFoundException(`Card "${cardId}" not found in article "${articleId}"`);
    }
    return card;
  }

  /**
   * Generates a unique slug by appending a short numeric suffix on conflict.
   * Tries the base slug first, then base-2, base-3, … up to 20 attempts.
   */
  private async ensureUniqueSlug(base: string): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const exists = await this.prisma.newsArticle.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    // Extremely unlikely: fall back to UUID suffix
    return `${base}-${uuidv4().slice(0, 8)}`;
  }

  private async assertSlugAvailable(slug: string): Promise<void> {
    const exists = await this.prisma.newsArticle.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (exists) {
      throw new ConflictException(`Slug "${slug}" is already in use`);
    }
  }

  private parseCardData(type: ArticleCardType, data: unknown): Record<string, unknown> {
    try {
      return validateCardData(type, data) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException(
          `Invalid data for card type ${type}: ${e.errors.map((err) => err.message).join('; ')}`,
        );
      }
      throw e;
    }
  }

  private async assertPublicationCardReference(
    articleId: string,
    type: ArticleCardType,
    data: Record<string, unknown>,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (type !== ArticleCardType.PUBLICATION) return;

    const publicationArticleId = (data as PublicationCardData).articleId;
    if (publicationArticleId === articleId) {
      throw new BadRequestException('Publication cards cannot reference the same article');
    }

    const db = tx ?? this.prisma;
    const referencedArticle = await db.newsArticle.findFirst({
      where: {
        id: publicationArticleId,
        deletedAt: null,
        status: ContentStatus.PUBLISHED,
      },
      select: { id: true },
    });

    if (!referencedArticle) {
      throw new BadRequestException(
        `Publication card must reference an existing published article: ${publicationArticleId}`,
      );
    }
  }

  private async persistCardOrder(
    orderedCardIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (orderedCardIds.length === 0) return;

    const cases = orderedCardIds.map(
      (cardId, index) => Prisma.sql`WHEN ${cardId}::uuid THEN ${index}`,
    );
    const idList = Prisma.join(orderedCardIds.map((id) => Prisma.sql`${id}::uuid`));

    const sql = Prisma.sql`
      UPDATE "article_cards"
      SET "order" = CASE "id"
        ${Prisma.join(cases, ' ')}
      END
      WHERE "id" IN (${idList})
    `;

    if (tx) {
      await tx.$executeRaw(sql);
    } else {
      await this.prisma.$executeRaw(sql);
    }
  }

  private async findAllByFullTextSearch({
    where,
    query,
    trimmedQuery,
    page,
    perPage,
  }: {
    where: Prisma.NewsArticleWhereInput;
    query: ListNewsQueryDto;
    trimmedQuery: string;
    page: number;
    perPage: number;
  }): Promise<PaginatedResult<NewsSummaryResponseDto>> {
    const filters: Prisma.Sql[] = [Prisma.sql`"deleted_at" IS NULL`];

    if (query.status) {
      filters.push(Prisma.sql`"status" = ${query.status}::"ContentStatus"`);
    }
    if (query.articleType) {
      filters.push(Prisma.sql`"article_type" = ${query.articleType}::"ArticleType"`);
    }
    if (query.rubricId) {
      filters.push(Prisma.sql`"rubric_id" = ${query.rubricId}`);
    }
    filters.push(Prisma.sql`"body_tsv" @@ websearch_to_tsquery('russian', ${trimmedQuery})`);

    const whereSql = Prisma.join(filters, ' AND ');
    const rankSql = Prisma.sql`ts_rank_cd("body_tsv", websearch_to_tsquery('russian', ${trimmedQuery}))`;

    const [matchingIds, totalRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "news_articles"
        WHERE ${whereSql}
        ORDER BY ${rankSql} DESC, "publication_index" ASC, "created_at" DESC
        OFFSET ${(page - 1) * perPage}
        LIMIT ${perPage}
      `),
      this.prisma.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "count"
        FROM "news_articles"
        WHERE ${whereSql}
      `),
    ]);

    const orderedIds = matchingIds.map((row) => row.id);
    const total = Number(totalRows[0]?.count ?? 0);

    if (orderedIds.length === 0) {
      return paginatedResult([], {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      });
    }

    const articles = await this.prisma.newsArticle.findMany({
      where: {
        ...where,
        id: { in: orderedIds },
      },
      select: ARTICLE_SUMMARY_SELECT,
    });

    const articlesById = new Map(articles.map((article) => [article.id, article]));
    const orderedArticles = orderedIds
      .map((id) => articlesById.get(id))
      .filter((article): article is ArticleSummaryRow => article != null);

    return paginatedResult(orderedArticles.map(mapSummary), {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    });
  }

  /**
   * Builds a publication-article lookup map used by compileCards.
   * Called during publish and preview to embed referenced article metadata.
   */
  private async buildPublicationMap(
    cards: CardRow[],
  ): Promise<Map<string, { title: string; coverImage: string | null; slug: string }>> {
    const pubCardIds = [
      ...new Set(
        cards
          .filter((c) => c.type === ArticleCardType.PUBLICATION)
          .map((c) => (c.data as PublicationCardData).articleId),
      ),
    ];

    if (pubCardIds.length === 0) return new Map();

    const articles = await this.prisma.newsArticle.findMany({
      where: {
        id: { in: pubCardIds },
        deletedAt: null,
        status: ContentStatus.PUBLISHED,
      },
      select: { id: true, title: true, coverImage: true, slug: true },
    });

    if (articles.length !== pubCardIds.length) {
      const foundArticleIds = new Set(articles.map((article) => article.id));
      const missingArticleIds = pubCardIds.filter((articleId) => !foundArticleIds.has(articleId));
      throw new ConflictException(
        `Publication cards reference unavailable articles (they may have been archived since the card was created): ${missingArticleIds.join(', ')}`,
      );
    }

    return new Map(
      articles.map(
        (a) => [a.id, a] as [string, { title: string; coverImage: string | null; slug: string }],
      ),
    );
  }

  /**
   * Executes `operation` in a Serializable transaction, retrying up to
   * SERIALIZABLE_RETRY_LIMIT times on P2034 (serialization conflict) with
   * exponential backoff + jitter to reduce thundering-herd.
   */
  private async withSerializableTx<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30_000,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < SERIALIZABLE_RETRY_LIMIT
        ) {
          await this.sleep(50 * Math.min(2 ** (attempt - 1), 10) + Math.random() * 50);
          continue;
        }
        throw error;
      }
    }
    throw new Error('Exceeded serializable transaction retry limit');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
