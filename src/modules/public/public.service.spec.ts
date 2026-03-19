import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicService, PUBLIC_CACHE_TTL_SECONDS } from './public.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../redis/redis.module.js';
import { ContentStatus, ArticleType, SectionType } from '../../generated/prisma/enums.js';

// Prevent Jest from loading the real Prisma generated client.
jest.mock('../../generated/prisma/client.js', () => ({
  PrismaClient: jest.fn(),
  Prisma: { JsonNull: Symbol('JsonNull') },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('pg', () => ({ Pool: jest.fn() }));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const now = new Date('2026-03-12T00:00:00.000Z');

const publishedPageRow = {
  id: 'page-uuid-1',
  slug: 'about',
  name: 'About Us',
  publishedAt: now,
  sections: [
    { id: 'sec-uuid-1', type: SectionType.HERO, order: 0, data: { title: 'Welcome' } },
    { id: 'sec-uuid-2', type: SectionType.TEXT, order: 1, data: { content: 'Body text' } },
  ],
};

const publishedNewsRow = {
  id: 'news-uuid-1',
  slug: 'company-news',
  title: 'Company News Title',
  articleType: ArticleType.NEWS,
  rubricId: null,
  publishedAt: now,
  coverImage: 'https://cdn.example.com/cover.jpg',
  excerptTitle: 'Brief',
  excerpt: 'Short excerpt',
};

const publishedNewsDetailRow = {
  ...publishedNewsRow,
  excerptImage: 'https://cdn.example.com/excerpt.jpg',
  bodyHtml: '<p>Full article body</p>',
  socialMeta: { ogTitle: 'Company News' },
};

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPrisma = {
  page: {
    findUnique: jest.fn(),
  },
  newsArticle: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
  unlink: jest.fn(),
};

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('PublicService', () => {
  let service: PublicService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default Redis mocks: cache miss, successful writes
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.scan.mockResolvedValue(['0', []]);
    mockRedis.unlink.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<PublicService>(PublicService);
  });

  // ─── findPublishedPage ───────────────────────────────────────────────────

  describe('findPublishedPage', () => {
    it('returns cached page without hitting DB', async () => {
      const cached = {
        id: 'page-uuid-1',
        slug: 'about',
        name: 'About Us',
        publishedAt: now.toISOString(),
        sections: [
          { id: 'sec-uuid-1', type: SectionType.HERO, order: 0, data: { title: 'Welcome' } },
        ],
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.findPublishedPage('about');

      expect(result).toEqual(cached);
      expect(mockPrisma.page.findUnique).not.toHaveBeenCalled();
    });

    it('queries DB on cache miss and caches the result', async () => {
      mockPrisma.page.findUnique.mockResolvedValue(publishedPageRow);

      const result = await service.findPublishedPage('about');

      expect(result.slug).toBe('about');
      expect(result.name).toBe('About Us');
      expect(result.publishedAt).toBe(now.toISOString());
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].type).toBe(SectionType.HERO);

      expect(mockPrisma.page.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: 'about', status: ContentStatus.PUBLISHED },
        }),
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        'public:page:about',
        expect.any(String),
        'EX',
        PUBLIC_CACHE_TTL_SECONDS,
      );
    });

    it('throws NotFoundException when the page is not PUBLISHED', async () => {
      mockPrisma.page.findUnique.mockResolvedValue(null);

      await expect(service.findPublishedPage('nonexistent')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('still returns the result when Redis set fails', async () => {
      mockPrisma.page.findUnique.mockResolvedValue(publishedPageRow);
      mockRedis.set.mockRejectedValue(new Error('Redis down'));

      const result = await service.findPublishedPage('about');

      expect(result.slug).toBe('about');
    });

    it('falls through to DB when cached value is corrupt JSON', async () => {
      mockRedis.get.mockResolvedValue('NOT-VALID-JSON');
      mockPrisma.page.findUnique.mockResolvedValue(publishedPageRow);

      const result = await service.findPublishedPage('about');

      expect(result.slug).toBe('about');
      expect(mockRedis.del).toHaveBeenCalledWith('public:page:about');
      expect(mockPrisma.page.findUnique).toHaveBeenCalled();
    });
  });

  // ─── findPublishedNewsList ───────────────────────────────────────────────

  describe('findPublishedNewsList', () => {
    it('returns cached list without hitting DB', async () => {
      const cached = {
        data: [{ id: 'n1' }],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.findPublishedNewsList({ page: 1, perPage: 20 });

      expect(result).toEqual(
        expect.objectContaining({ meta: expect.objectContaining({ total: 1 }) }),
      );
      expect(mockPrisma.newsArticle.findMany).not.toHaveBeenCalled();
    });

    it('queries DB on cache miss and returns paginated result', async () => {
      mockPrisma.newsArticle.findMany.mockResolvedValue([publishedNewsRow]);
      mockPrisma.newsArticle.count.mockResolvedValue(1);

      const result = await service.findPublishedNewsList({ page: 1, perPage: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].slug).toBe('company-news');
      expect(result.data[0].publishedAt).toBe(now.toISOString());
      expect(result.meta).toMatchObject({ total: 1, page: 1, perPage: 20, totalPages: 1 });
    });

    it('applies pagination skip/take correctly', async () => {
      mockPrisma.newsArticle.findMany.mockResolvedValue([]);
      mockPrisma.newsArticle.count.mockResolvedValue(0);

      await service.findPublishedNewsList({ page: 3, perPage: 10 });

      expect(mockPrisma.newsArticle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('applies articleType and rubricId filters', async () => {
      mockPrisma.newsArticle.findMany.mockResolvedValue([]);
      mockPrisma.newsArticle.count.mockResolvedValue(0);

      await service.findPublishedNewsList({
        page: 1,
        perPage: 20,
        articleType: ArticleType.PRESS_RELEASE,
        rubricId: 'rubric-uuid-1',
      });

      expect(mockPrisma.newsArticle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: ContentStatus.PUBLISHED,
            deletedAt: null,
            articleType: ArticleType.PRESS_RELEASE,
            rubricId: 'rubric-uuid-1',
          }),
        }),
      );
    });

    it('defaults page=1 and perPage=20 when absent', async () => {
      mockPrisma.newsArticle.findMany.mockResolvedValue([]);
      mockPrisma.newsArticle.count.mockResolvedValue(0);

      await service.findPublishedNewsList({});

      expect(mockPrisma.newsArticle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('caches the result on DB query', async () => {
      mockPrisma.newsArticle.findMany.mockResolvedValue([]);
      mockPrisma.newsArticle.count.mockResolvedValue(0);

      await service.findPublishedNewsList({ page: 1, perPage: 20 });

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('public:news:list:'),
        expect.any(String),
        'EX',
        PUBLIC_CACHE_TTL_SECONDS,
      );
    });

    it('still returns the result when Redis set fails', async () => {
      mockPrisma.newsArticle.findMany.mockResolvedValue([publishedNewsRow]);
      mockPrisma.newsArticle.count.mockResolvedValue(1);
      mockRedis.set.mockRejectedValue(new Error('Redis down'));

      const result = await service.findPublishedNewsList({ page: 1, perPage: 20 });

      expect(result.data).toHaveLength(1);
    });

    it('falls through to DB when cached value is corrupt JSON', async () => {
      mockRedis.get.mockResolvedValue('{BROKEN');
      mockPrisma.newsArticle.findMany.mockResolvedValue([publishedNewsRow]);
      mockPrisma.newsArticle.count.mockResolvedValue(1);

      const result = await service.findPublishedNewsList({ page: 1, perPage: 20 });

      expect(result.data).toHaveLength(1);
      expect(mockRedis.del).toHaveBeenCalled();
      expect(mockPrisma.newsArticle.findMany).toHaveBeenCalled();
    });
  });

  // ─── findPublishedNewsBySlug ─────────────────────────────────────────────

  describe('findPublishedNewsBySlug', () => {
    it('returns cached article without hitting DB', async () => {
      const cached = { id: 'news-uuid-1', slug: 'company-news', bodyHtml: '<p>…</p>' };
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.findPublishedNewsBySlug('company-news');

      expect(result.slug).toBe('company-news');
      expect(mockPrisma.newsArticle.findUnique).not.toHaveBeenCalled();
    });

    it('queries DB on cache miss and caches the result', async () => {
      mockPrisma.newsArticle.findUnique.mockResolvedValue(publishedNewsDetailRow);

      const result = await service.findPublishedNewsBySlug('company-news');

      expect(result.slug).toBe('company-news');
      expect(result.bodyHtml).toBe('<p>Full article body</p>');
      expect(result.socialMeta).toEqual({ ogTitle: 'Company News' });
      expect(result.publishedAt).toBe(now.toISOString());

      expect(mockPrisma.newsArticle.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: 'company-news', status: ContentStatus.PUBLISHED, deletedAt: null },
        }),
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        'public:news:company-news',
        expect.any(String),
        'EX',
        PUBLIC_CACHE_TTL_SECONDS,
      );
    });

    it('throws NotFoundException when article is not found', async () => {
      mockPrisma.newsArticle.findUnique.mockResolvedValue(null);

      await expect(service.findPublishedNewsBySlug('nonexistent')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('still returns the result when Redis set fails', async () => {
      mockPrisma.newsArticle.findUnique.mockResolvedValue(publishedNewsDetailRow);
      mockRedis.set.mockRejectedValue(new Error('Redis down'));

      const result = await service.findPublishedNewsBySlug('company-news');

      expect(result.slug).toBe('company-news');
    });

    it('falls through to DB when cached value is corrupt JSON', async () => {
      mockRedis.get.mockResolvedValue('<<<corrupt>>>');
      mockPrisma.newsArticle.findUnique.mockResolvedValue(publishedNewsDetailRow);

      const result = await service.findPublishedNewsBySlug('company-news');

      expect(result.slug).toBe('company-news');
      expect(mockRedis.del).toHaveBeenCalledWith('public:news:company-news');
      expect(mockPrisma.newsArticle.findUnique).toHaveBeenCalled();
    });
  });

  // ─── invalidatePage ──────────────────────────────────────────────────────

  describe('invalidatePage', () => {
    it('deletes the cache key for the given slug', async () => {
      await service.invalidatePage('about');

      expect(mockRedis.del).toHaveBeenCalledWith('public:page:about');
    });

    it('does not throw when Redis del fails', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis down'));

      await expect(service.invalidatePage('about')).resolves.toBeUndefined();
    });
  });

  // ─── invalidateNewsArticle ───────────────────────────────────────────────

  describe('invalidateNewsArticle', () => {
    it('deletes the article cache key and invalidates all list caches', async () => {
      await service.invalidateNewsArticle('company-news');

      expect(mockRedis.del).toHaveBeenCalledWith('public:news:company-news');
      // invalidateAllNewsLists is called internally → scan was invoked
      expect(mockRedis.scan).toHaveBeenCalled();
    });

    it('does not throw when Redis del fails', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis down'));

      await expect(service.invalidateNewsArticle('company-news')).resolves.toBeUndefined();
    });

    it('does not throw when invalidateAllNewsLists fails', async () => {
      mockRedis.scan.mockRejectedValue(new Error('Redis SCAN error'));

      await expect(service.invalidateNewsArticle('company-news')).resolves.toBeUndefined();
    });
  });

  // ─── invalidateAllNewsLists ──────────────────────────────────────────────

  describe('invalidateAllNewsLists', () => {
    it('does nothing when no list keys exist', async () => {
      mockRedis.scan.mockResolvedValue(['0', []]);

      await service.invalidateAllNewsLists();

      expect(mockRedis.scan).toHaveBeenCalledTimes(1);
      expect(mockRedis.unlink).not.toHaveBeenCalled();
    });

    it('unlinks found list keys across multiple SCAN iterations', async () => {
      mockRedis.scan
        .mockResolvedValueOnce(['42', ['public:news:list:p1:pp20:tall:rall']])
        .mockResolvedValueOnce(['0', ['public:news:list:p2:pp20:tall:rall']]);

      await service.invalidateAllNewsLists();

      expect(mockRedis.scan).toHaveBeenCalledTimes(2);
      expect(mockRedis.unlink).toHaveBeenCalledTimes(2);
      expect(mockRedis.unlink).toHaveBeenCalledWith('public:news:list:p1:pp20:tall:rall');
      expect(mockRedis.unlink).toHaveBeenCalledWith('public:news:list:p2:pp20:tall:rall');
    });

    it('does not throw when UNLINK fails for a batch', async () => {
      mockRedis.scan.mockResolvedValue(['0', ['public:news:list:p1:pp20:tall:rall']]);
      mockRedis.unlink.mockRejectedValue(new Error('UNLINK failed'));

      await expect(service.invalidateAllNewsLists()).resolves.toBeUndefined();
    });
  });
});
