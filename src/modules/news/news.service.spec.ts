import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { NewsService } from './news.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ArticleCardType, ArticleType, ContentStatus, Role } from '../../generated/prisma/enums.js';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../../generated/prisma/client.js', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, { code }: { code: string }) {
      super(message);
      this.code = code;
      this.name = 'PrismaClientKnownRequestError';
    }
  }
  return {
    PrismaClient: jest.fn(),
    Prisma: {
      PrismaClientKnownRequestError,
      QueryMode: { insensitive: 'insensitive' },
      TransactionIsolationLevel: { Serializable: 'Serializable' },
      sql: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
      join: jest.fn((values: unknown[], separator: unknown) => ({ values, separator })),
    },
  };
});
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('pg', () => ({ Pool: jest.fn() }));

// Mock Tiptap server rendering — isolates service from DOM/editor deps
jest.mock('../../common/tiptap/extensions.js', () => ({
  renderToHtml: jest.fn(() => '<p>Rendered HTML</p>'),
  extractPlainText: jest.fn(() => 'Plain text'),
}));

const { Prisma } = jest.requireMock('../../generated/prisma/client.js') as {
  Prisma: {
    PrismaClientKnownRequestError: new (
      msg: string,
      meta: { code: string },
    ) => Error & { code: string };
  };
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const now = new Date('2026-03-13T00:00:00.000Z');

const actor: AuthenticatedUser = {
  id: 'user-uuid-1',
  email: 'admin@example.com',
  role: Role.SUPER_ADMIN,
};

const articleSummaryRow = {
  id: 'article-uuid-1',
  slug: 'test-article',
  title: 'Test Article',
  articleType: ArticleType.NEWS,
  rubricId: null,
  status: ContentStatus.DRAFT,
  publishedAt: null,
  coverImage: null,
  excerptTitle: null,
  publicationIndex: 500,
  authorId: 'user-uuid-1',
  createdAt: now,
  updatedAt: now,
};

const articleFullRow = {
  ...articleSummaryRow,
  excerpt: null,
  excerptImage: null,
  socialMeta: null,
  rssGoogleNews: false,
  rssYandexDzen: false,
  rssYandexNews: false,
  rssDefault: false,
  adBannerCode: null,
  adBannerImage: null,
};

const textCardRow = {
  id: 'card-uuid-1',
  articleId: 'article-uuid-1',
  type: ArticleCardType.TEXT,
  order: 0,
  data: { body: { type: 'doc', content: [] } },
  createdAt: now,
  updatedAt: now,
};

// ─── Test setup ───────────────────────────────────────────────────────────────

describe('NewsService', () => {
  let service: NewsService;
  let prisma: jest.Mocked<PrismaService>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsService,
        {
          provide: PrismaService,
          useValue: {
            newsArticle: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
            },
            articleCard: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            $transaction: jest.fn(),
            $queryRaw: jest.fn(),
            $executeRaw: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuditService,
          useValue: { logAsync: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(NewsService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
    auditService = module.get(AuditService) as jest.Mocked<AuditService>;

    // Default: $transaction executes the callback with `prisma` acting as the
    // transaction client.  Tests that need to simulate P2034 can override this.
    (prisma.$transaction as jest.Mock).mockImplementation(
      (op: (tx: typeof prisma) => Promise<unknown>) => op(prisma),
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a DRAFT article and returns the summary', async () => {
      (prisma.newsArticle.findUnique as jest.Mock).mockResolvedValue(null); // slug available
      (prisma.newsArticle.create as jest.Mock).mockResolvedValue(articleSummaryRow);

      const result = await service.create({ title: 'Test Article' }, actor);

      expect(prisma.newsArticle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Test Article',
            status: ContentStatus.DRAFT,
          }),
        }),
      );
      expect(result.status).toBe(ContentStatus.DRAFT);
      expect(auditService.logAsync).toHaveBeenCalledTimes(1);
    });

    it('auto-generates a slug when none is provided', async () => {
      (prisma.newsArticle.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.newsArticle.create as jest.Mock).mockResolvedValue({
        ...articleSummaryRow,
        slug: 'test-article',
      });

      const result = await service.create({ title: 'Тест статья' }, actor);
      expect(result.slug).toBeDefined();
    });

    it('appends a numeric suffix when the slug is already taken', async () => {
      // First call (base slug) exists; second call (slug-2) is free
      (prisma.newsArticle.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'other-uuid' }) // base slug taken
        .mockResolvedValueOnce(null); // slug-2 free
      (prisma.newsArticle.create as jest.Mock).mockResolvedValue({
        ...articleSummaryRow,
        slug: 'test-article-2',
      });

      await service.create({ title: 'Test Article' }, actor);
      expect(prisma.newsArticle.create).toHaveBeenCalled();
    });

    it('throws ConflictException on P2002 unique violation', async () => {
      (prisma.newsArticle.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.newsArticle.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002' }),
      );

      await expect(service.create({ title: 'Test Article', slug: 'taken' }, actor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects unsafe ad banner code payloads', async () => {
      await expect(
        service.create(
          {
            title: 'Test Article',
            adBannerCode: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
          },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns a paginated result excluding soft-deleted articles', async () => {
      (prisma.newsArticle.findMany as jest.Mock).mockResolvedValue([articleSummaryRow]);
      (prisma.newsArticle.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, perPage: 20 });

      expect(prisma.newsArticle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('filters by status when provided', async () => {
      (prisma.newsArticle.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.newsArticle.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ status: ContentStatus.PUBLISHED });

      expect(prisma.newsArticle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: ContentStatus.PUBLISHED,
            deletedAt: null,
          }),
        }),
      );
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the article with cards', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue(articleFullRow);
      (prisma.articleCard.findMany as jest.Mock).mockResolvedValue([textCardRow]);

      const result = await service.findOne('article-uuid-1');

      expect(result.id).toBe('article-uuid-1');
      expect(result.cards).toHaveLength(1);
    });

    it('throws NotFoundException for unknown id', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('ghost-uuid')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for soft-deleted article', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue(null); // filtered by deletedAt

      await expect(service.findOne('deleted-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── softDelete ───────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('sets deletedAt on the article', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue(articleSummaryRow);
      (prisma.newsArticle.update as jest.Mock).mockResolvedValue({
        ...articleSummaryRow,
        deletedAt: new Date(),
      });

      await service.softDelete('article-uuid-1', actor);

      expect(prisma.newsArticle.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
      expect(auditService.logAsync).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when article does not exist', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.softDelete('ghost-uuid', actor)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── publish ─────────────────────────────────────────────────────────────

  describe('publish', () => {
    it('publishes a DRAFT article and dual-writes bodyHtml + bodyText', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue(articleSummaryRow);
      (prisma.articleCard.findMany as jest.Mock).mockResolvedValue([textCardRow]);
      const publishedRow = {
        ...articleFullRow,
        status: ContentStatus.PUBLISHED,
        publishedAt: now,
        bodyHtml: '<p>Rendered HTML</p>',
        bodyText: 'Plain text',
      };
      (prisma.newsArticle.update as jest.Mock).mockResolvedValue(publishedRow);

      const result = await service.publish('article-uuid-1', actor);

      expect(prisma.newsArticle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ContentStatus.PUBLISHED,
            bodyHtml: expect.any(String),
            bodyText: expect.any(String),
          }),
        }),
      );
      expect(result.status).toBe(ContentStatus.PUBLISHED);
      expect(auditService.logAsync).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when article is already published', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue({
        ...articleSummaryRow,
        status: ContentStatus.PUBLISHED,
      });
      (prisma.articleCard.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.newsArticle.update as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025' }),
      );
      (prisma.newsArticle.findUnique as jest.Mock).mockResolvedValue({
        status: ContentStatus.PUBLISHED,
      });

      await expect(service.publish('article-uuid-1', actor)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when article does not exist', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.publish('ghost-uuid', actor)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── archive ─────────────────────────────────────────────────────────────

  describe('archive', () => {
    it('archives a published article', async () => {
      const publishedRow = { ...articleSummaryRow, status: ContentStatus.PUBLISHED };
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue(publishedRow);
      (prisma.newsArticle.update as jest.Mock).mockResolvedValue({
        ...articleFullRow,
        status: ContentStatus.ARCHIVED,
      });
      (prisma.articleCard.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.archive('article-uuid-1', actor);
      expect(result.status).toBe(ContentStatus.ARCHIVED);
    });

    it('throws ConflictException when article is not published', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue(articleSummaryRow); // DRAFT
      (prisma.newsArticle.update as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025' }),
      );

      await expect(service.archive('article-uuid-1', actor)).rejects.toThrow(ConflictException);
    });
  });

  // ─── getPreview ───────────────────────────────────────────────────────────

  describe('getPreview', () => {
    it('returns article with on-the-fly bodyHtml for DRAFT', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue(articleFullRow);
      (prisma.articleCard.findMany as jest.Mock).mockResolvedValue([textCardRow]);

      const result = await service.getPreview('article-uuid-1');

      expect(result.status).toBe(ContentStatus.DRAFT);
      expect(result.bodyHtml).toBeDefined();
    });
  });

  // ─── createCard ───────────────────────────────────────────────────────────

  describe('createCard', () => {
    it('creates a TEXT card with valid Tiptap body', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue({
        id: 'article-uuid-1',
        status: ContentStatus.DRAFT,
      });
      (prisma.articleCard.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prisma.articleCard.create as jest.Mock).mockResolvedValue(textCardRow);
      (prisma.articleCard.findFirst as jest.Mock).mockResolvedValue(textCardRow);

      const result = await service.createCard(
        'article-uuid-1',
        {
          type: ArticleCardType.TEXT,
          data: { body: { type: 'doc', content: [] } },
        },
        actor,
      );

      expect(result.type).toBe(ArticleCardType.TEXT);
      expect(prisma.articleCard.create).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException for invalid TEXT card data', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue({
        id: 'article-uuid-1',
        status: ContentStatus.DRAFT,
      });

      await expect(
        service.createCard(
          'article-uuid-1',
          { type: ArticleCardType.TEXT, data: { body: { type: 'paragraph' } } }, // wrong root type
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid IMAGE url (non-http)', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue({
        id: 'article-uuid-1',
        status: ContentStatus.DRAFT,
      });

      await expect(
        service.createCard(
          'article-uuid-1',
          { type: ArticleCardType.IMAGE, data: { url: 'javascript:alert(1)' } },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when article does not exist', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createCard(
          'ghost-uuid',
          { type: ArticleCardType.QUOTE, data: { text: 'Hello' } },
          actor,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when trying to edit cards of a published article', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue({
        id: 'article-uuid-1',
        status: ContentStatus.PUBLISHED,
      });

      await expect(
        service.createCard(
          'article-uuid-1',
          { type: ArticleCardType.QUOTE, data: { text: 'Hello' } },
          actor,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── reorderCards ─────────────────────────────────────────────────────────

  describe('reorderCards', () => {
    const cards = [
      { id: 'card-uuid-1', order: 0 },
      { id: 'card-uuid-2', order: 1 },
      { id: 'card-uuid-3', order: 2 },
    ];

    it('reorders cards transactionally', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue({
        id: 'article-uuid-1',
        status: ContentStatus.DRAFT,
      });
      (prisma.articleCard.findMany as jest.Mock)
        .mockResolvedValueOnce(cards) // existing
        .mockResolvedValueOnce(
          [...cards].reverse().map((c, i) => ({
            ...textCardRow,
            id: c.id,
            order: i,
          })),
        ); // after reorder

      const result = await service.reorderCards(
        'article-uuid-1',
        { cardIds: ['card-uuid-3', 'card-uuid-2', 'card-uuid-1'] },
        actor,
      );

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(3);
    });

    it('throws BadRequestException for foreign card IDs', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue({
        id: 'article-uuid-1',
        status: ContentStatus.DRAFT,
      });
      (prisma.articleCard.findMany as jest.Mock).mockResolvedValue(cards);

      await expect(
        service.reorderCards(
          'article-uuid-1',
          { cardIds: ['card-uuid-1', 'card-uuid-2', 'foreign-uuid'] },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when card list is incomplete', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue({
        id: 'article-uuid-1',
        status: ContentStatus.DRAFT,
      });
      (prisma.articleCard.findMany as jest.Mock).mockResolvedValue(cards);

      await expect(
        service.reorderCards(
          'article-uuid-1',
          { cardIds: ['card-uuid-1', 'card-uuid-2'] }, // missing card-uuid-3
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when card list contains duplicates', async () => {
      (prisma.newsArticle.findFirst as jest.Mock).mockResolvedValue({
        id: 'article-uuid-1',
        status: ContentStatus.DRAFT,
      });
      (prisma.articleCard.findMany as jest.Mock).mockResolvedValue(cards);

      await expect(
        service.reorderCards(
          'article-uuid-1',
          { cardIds: ['card-uuid-1', 'card-uuid-1', 'card-uuid-2'] },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
