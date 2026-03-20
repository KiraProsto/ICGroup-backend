import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ContentStatus } from '../../generated/prisma/enums.js';
import type { SectionType } from '../../generated/prisma/enums.js';
import {
  paginatedResult,
  type PaginatedResult,
} from '../../common/interceptors/transform-response.interceptor.js';
import type { PublicNewsQueryDto } from './dto/public-news-query.dto.js';
import type { PublicNewsSummaryDto, PublicNewsDetailDto } from './dto/public-news-response.dto.js';
import type { PublicPageDto, PublicPageSectionDto } from './dto/public-page-response.dto.js';
import type { ArticleType } from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';

// ─── Cache configuration ──────────────────────────────────────────────────────
export const PUBLIC_CACHE_TTL_SECONDS = 300; // 5 minutes
// Short TTL for not-found tombstones — protects the DB from repeated lookups
// of non-existent or unpublished slugs (e.g. broken links, bot scans).
export const PUBLIC_CACHE_NOT_FOUND_TTL_SECONDS = 30;
// Sentinel stored in Redis to represent a confirmed not-found result.
export const CACHE_NOT_FOUND_SENTINEL = '__not_found__';
// Redis key holding the current version counter for news list caches.
// INCR-ing this key effectively invalidates all existing list entries because
// subsequent reads produce cache keys with the new version — old keys expire
// naturally via TTL.
export const NEWS_LIST_VERSION_KEY = 'public:news:list:ver';

export const cacheKeyPage = (slug: string): string => `public:page:${slug}`;
export const cacheKeyNewsDetail = (slug: string): string => `public:news:${slug}`;

export function cacheKeyNewsList(query: PublicNewsQueryDto, version: number): string {
  const parts: string[] = [
    `v${version}`,
    `p${query.page ?? 1}`,
    `pp${query.perPage ?? 20}`,
    query.articleType ? `t${query.articleType}` : 'tall',
    query.rubricId ? `r${query.rubricId}` : 'rall',
  ];
  return `public:news:list:${parts.join(':')}`;
}

// ─── Prisma select shapes ─────────────────────────────────────────────────────

const PUBLIC_PAGE_SELECT = {
  id: true,
  slug: true,
  name: true,
  publishedAt: true,
  sections: {
    select: {
      id: true,
      type: true,
      order: true,
      data: true,
    },
    orderBy: { order: 'asc' as const },
  },
} as const;

const PUBLIC_NEWS_SUMMARY_SELECT = {
  id: true,
  slug: true,
  title: true,
  articleType: true,
  rubricId: true,
  publishedAt: true,
  coverImage: true,
  excerptTitle: true,
  excerpt: true,
} as const;

const PUBLIC_NEWS_DETAIL_SELECT = {
  ...PUBLIC_NEWS_SUMMARY_SELECT,
  excerptImage: true,
  bodyHtml: true,
  socialMeta: true,
} as const;

// ─── Row types ────────────────────────────────────────────────────────────────

type PublicPageRow = {
  id: string;
  slug: string;
  name: string;
  publishedAt: Date | null;
  sections: Array<{
    id: string;
    type: SectionType;
    order: number;
    data: Prisma.JsonValue;
  }>;
};

type PublicNewsSummaryRow = {
  id: string;
  slug: string;
  title: string;
  articleType: ArticleType;
  rubricId: string | null;
  publishedAt: Date | null;
  coverImage: string | null;
  excerptTitle: string | null;
  excerpt: string | null;
};

type PublicNewsDetailRow = PublicNewsSummaryRow & {
  excerptImage: string | null;
  bodyHtml: string | null;
  socialMeta: Prisma.JsonValue;
};

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapPublicSection(row: PublicPageRow['sections'][number]): PublicPageSectionDto {
  return {
    id: row.id,
    type: row.type,
    order: row.order,
    data: row.data as Record<string, unknown>,
  };
}

function mapPublicPage(row: PublicPageRow): PublicPageDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    // publishedAt is guaranteed non-null since we filter status = PUBLISHED
    publishedAt: row.publishedAt!.toISOString(),
    sections: row.sections.map(mapPublicSection),
  };
}

function mapPublicNewsSummary(row: PublicNewsSummaryRow): PublicNewsSummaryDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    articleType: row.articleType,
    rubricId: row.rubricId,
    // publishedAt is guaranteed non-null since we filter status = PUBLISHED
    publishedAt: row.publishedAt!.toISOString(),
    coverImage: row.coverImage,
    excerptTitle: row.excerptTitle,
    excerpt: row.excerpt,
  };
}

function mapPublicNewsDetail(row: PublicNewsDetailRow): PublicNewsDetailDto {
  return {
    ...mapPublicNewsSummary(row),
    excerptImage: row.excerptImage,
    bodyHtml: row.bodyHtml,
    socialMeta: row.socialMeta as Record<string, unknown> | null,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * PublicService provides read-only access to PUBLISHED content for the public portal.
 * All results are cached in Redis with a 5-minute TTL.
 *
 * Cache invalidation is triggered externally by PagesService and NewsService
 * by calling the `invalidatePage` and `invalidateNewsArticle` / `invalidateNewsList`
 * methods (via the exported cache-key helpers and REDIS_CLIENT injection).
 */
@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ─── GET /public/pages/:slug ──────────────────────────────────────────────

  async findPublishedPage(slug: string): Promise<PublicPageDto> {
    const cacheKey = cacheKeyPage(slug);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      if (cached === CACHE_NOT_FOUND_SENTINEL) {
        throw new NotFoundException(`Page "${slug}" not found`);
      }
      try {
        return JSON.parse(cached) as PublicPageDto;
      } catch {
        this.logger.warn(`Corrupt cache for page "${slug}", deleting key`);
        await this.redis.del(cacheKey).catch(() => {});
      }
    }

    const row = await this.prisma.page.findFirst({
      where: { slug, status: ContentStatus.PUBLISHED },
      select: PUBLIC_PAGE_SELECT,
    });

    if (!row) {
      await this.redis
        .set(cacheKey, CACHE_NOT_FOUND_SENTINEL, 'EX', PUBLIC_CACHE_NOT_FOUND_TTL_SECONDS)
        .catch((err: unknown) => {
          this.logger.warn(`Failed to set not-found cache for page "${slug}": ${String(err)}`);
        });
      throw new NotFoundException(`Page "${slug}" not found`);
    }

    const result = mapPublicPage(row as PublicPageRow);

    await this.redis
      .set(cacheKey, JSON.stringify(result), 'EX', PUBLIC_CACHE_TTL_SECONDS)
      .catch((err: unknown) => {
        this.logger.warn(`Failed to set cache for page "${slug}": ${String(err)}`);
      });

    return result;
  }

  // ─── GET /public/news ─────────────────────────────────────────────────────

  async findPublishedNewsList(
    query: PublicNewsQueryDto,
  ): Promise<PaginatedResult<PublicNewsSummaryDto>> {
    // Read the current version counter — cache keys include the version so that
    // an INCR on the counter effectively invalidates all previous list entries.
    const version = Number(await this.redis.get(NEWS_LIST_VERSION_KEY).catch(() => null)) || 0;
    const cacheKey = cacheKeyNewsList(query, version);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as PaginatedResult<PublicNewsSummaryDto>;
      } catch {
        this.logger.warn(`Corrupt news list cache for key "${cacheKey}", deleting key`);
        await this.redis.del(cacheKey).catch(() => {});
      }
    }

    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const where: Prisma.NewsArticleWhereInput = {
      status: ContentStatus.PUBLISHED,
      deletedAt: null,
      ...(query.articleType && { articleType: query.articleType }),
      ...(query.rubricId && { rubricId: query.rubricId }),
    };

    const [articles, total] = await Promise.all([
      this.prisma.newsArticle.findMany({
        where,
        select: PUBLIC_NEWS_SUMMARY_SELECT,
        orderBy: [{ publicationIndex: 'asc' }, { publishedAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.newsArticle.count({ where }),
    ]);

    const result = paginatedResult((articles as PublicNewsSummaryRow[]).map(mapPublicNewsSummary), {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    });

    await this.redis
      .set(cacheKey, JSON.stringify(result), 'EX', PUBLIC_CACHE_TTL_SECONDS)
      .catch((err: unknown) => {
        this.logger.warn(`Failed to set news list cache: ${String(err)}`);
      });

    return result;
  }

  // ─── GET /public/news/:slug ───────────────────────────────────────────────

  async findPublishedNewsBySlug(slug: string): Promise<PublicNewsDetailDto> {
    const cacheKey = cacheKeyNewsDetail(slug);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      if (cached === CACHE_NOT_FOUND_SENTINEL) {
        throw new NotFoundException(`News article "${slug}" not found`);
      }
      try {
        return JSON.parse(cached) as PublicNewsDetailDto;
      } catch {
        this.logger.warn(`Corrupt cache for news "${slug}", deleting key`);
        await this.redis.del(cacheKey).catch(() => {});
      }
    }

    const row = await this.prisma.newsArticle.findFirst({
      where: { slug, status: ContentStatus.PUBLISHED, deletedAt: null },
      select: PUBLIC_NEWS_DETAIL_SELECT,
    });

    if (!row) {
      await this.redis
        .set(cacheKey, CACHE_NOT_FOUND_SENTINEL, 'EX', PUBLIC_CACHE_NOT_FOUND_TTL_SECONDS)
        .catch((err: unknown) => {
          this.logger.warn(`Failed to set not-found cache for news "${slug}": ${String(err)}`);
        });
      throw new NotFoundException(`News article "${slug}" not found`);
    }

    const result = mapPublicNewsDetail(row as PublicNewsDetailRow);

    await this.redis
      .set(cacheKey, JSON.stringify(result), 'EX', PUBLIC_CACHE_TTL_SECONDS)
      .catch((err: unknown) => {
        this.logger.warn(`Failed to set cache for news "${slug}": ${String(err)}`);
      });

    return result;
  }

  // ─── Cache invalidation ───────────────────────────────────────────────────

  /**
   * Deletes the cached page entry.
   * Called by PagesService after mutations to published content.
   */
  async invalidatePage(slug: string): Promise<void> {
    await this.redis.del(cacheKeyPage(slug)).catch((err: unknown) => {
      this.logger.warn(`Failed to invalidate cache for page "${slug}": ${String(err)}`);
    });
  }

  /**
   * Deletes the cached article entry and all matching news list keys.
   * Called by NewsService after mutations to published content.
   */
  async invalidateNewsArticle(slug: string): Promise<void> {
    await this.redis.del(cacheKeyNewsDetail(slug)).catch((err: unknown) => {
      this.logger.warn(`Failed to invalidate cache for news "${slug}": ${String(err)}`);
    });

    await this.invalidateAllNewsLists().catch((err: unknown) => {
      this.logger.error(`Failed to invalidate news list cache: ${String(err)}`);
    });
  }

  /**
   * Increments the news list version counter, logically invalidating all
   * existing list cache entries. Old keys expire naturally via TTL.
   *
   * O(1) — replaces the previous SCAN-based approach that was O(N) in the
   * number of cached list permutations.
   */
  async invalidateAllNewsLists(): Promise<void> {
    await this.redis.incr(NEWS_LIST_VERSION_KEY);
  }
}
