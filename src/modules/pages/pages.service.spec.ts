import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PagesService } from './pages.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PublicService } from '../public/public.service.js';
import { ContentStatus, Role, SectionType } from '../../generated/prisma/enums.js';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator.js';

// Prevent Jest from loading the real Prisma generated client.
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
      TransactionIsolationLevel: { Serializable: 'Serializable' },
    },
  };
});
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('pg', () => ({ Pool: jest.fn() }));

const { Prisma } = jest.requireMock('../../generated/prisma/client.js') as {
  Prisma: {
    PrismaClientKnownRequestError: new (
      msg: string,
      meta: { code: string },
    ) => Error & { code: string };
  };
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const now = new Date('2026-03-12T00:00:00.000Z');

const pageRow = {
  id: 'page-uuid-1',
  slug: 'about',
  name: 'About',
  status: ContentStatus.DRAFT,
  publishedAt: null,
  createdById: 'user-uuid-1',
  createdAt: now,
  updatedAt: now,
};

const heroSectionRow = {
  id: 'section-uuid-1',
  type: SectionType.HERO,
  order: 0,
  data: { title: 'Welcome' },
  createdAt: now,
  updatedAt: now,
};

const adminActor: AuthenticatedUser = {
  id: 'admin-uuid-1',
  email: 'admin@example.com',
  role: Role.SUPER_ADMIN,
};

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPrisma = {
  $transaction: jest.fn(),
  page: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  pageSection: {
    findMany: jest.fn(),
  },
};

const mockAuditService = {
  logAsync: jest.fn().mockResolvedValue(undefined),
};

const mockPublicService = {
  invalidatePage: jest.fn().mockResolvedValue(undefined),
  invalidateNewsArticle: jest.fn().mockResolvedValue(undefined),
  invalidateAllNewsLists: jest.fn().mockResolvedValue(undefined),
};

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('PagesService', () => {
  let service: PagesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuditService.logAsync.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PagesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        { provide: PublicService, useValue: mockPublicService },
      ],
    }).compile();

    service = module.get<PagesService>(PagesService);
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a DRAFT page and logs an audit event', async () => {
      mockPrisma.page.create.mockResolvedValue(pageRow);

      const result = await service.create({ slug: 'about', name: 'About' }, adminActor);

      expect(result.slug).toBe('about');
      expect(result.status).toBe(ContentStatus.DRAFT);
      expect(mockPrisma.page.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: 'about',
            name: 'About',
            status: ContentStatus.DRAFT,
            createdById: adminActor.id,
          }),
        }),
      );
      expect(mockAuditService.logAsync).toHaveBeenCalledTimes(1);
      expect(mockAuditService.logAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          beforeSnapshot: null,
          afterSnapshot: expect.objectContaining({ slug: 'about' }),
        }),
      );
    });

    it('throws ConflictException on duplicate slug (P2002)', async () => {
      mockPrisma.page.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique constraint', { code: 'P2002' }),
      );

      await expect(
        service.create({ slug: 'about', name: 'About' }, adminActor),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockAuditService.logAsync).not.toHaveBeenCalled();
    });

    it('re-throws unexpected errors from create', async () => {
      const boom = new Error('DB unavailable');
      mockPrisma.page.create.mockRejectedValue(boom);

      await expect(service.create({ slug: 'about', name: 'About' }, adminActor)).rejects.toThrow(
        'DB unavailable',
      );
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns a paginated result with mapped summaries', async () => {
      mockPrisma.page.findMany.mockResolvedValue([pageRow]);
      mockPrisma.page.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, perPage: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].slug).toBe('about');
      expect(result.data[0]).not.toHaveProperty('sections');
      expect(result.meta).toMatchObject({ total: 1, page: 1, perPage: 20, totalPages: 1 });
    });

    it('filters by status when provided', async () => {
      mockPrisma.page.findMany.mockResolvedValue([]);
      mockPrisma.page.count.mockResolvedValue(0);

      await service.findAll({ page: 1, perPage: 20, status: ContentStatus.PUBLISHED });

      expect(mockPrisma.page.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: ContentStatus.PUBLISHED } }),
      );
      expect(mockPrisma.page.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: ContentStatus.PUBLISHED } }),
      );
    });

    it('applies skip/take from page and perPage params', async () => {
      mockPrisma.page.findMany.mockResolvedValue([]);
      mockPrisma.page.count.mockResolvedValue(0);

      await service.findAll({ page: 3, perPage: 10 });

      expect(mockPrisma.page.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns page with ordered sections', async () => {
      mockPrisma.page.findUnique.mockResolvedValue({
        ...pageRow,
        sections: [heroSectionRow],
      });

      const result = await service.findOne('about');

      expect(result.slug).toBe('about');
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].type).toBe(SectionType.HERO);
    });

    it('throws NotFoundException when page does not exist', async () => {
      mockPrisma.page.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── upsert ──────────────────────────────────────────────────────────────

  describe('replaceSections', () => {
    const validUpsertDto = {
      sections: [
        {
          type: SectionType.HERO,
          order: 0,
          data: { title: 'Welcome', subtitle: 'Build something great' },
        },
      ],
    };

    function makeTxClient(overrides?: { beforeSections?: object[]; afterSections?: object[] }) {
      return {
        page: {
          findUnique: jest.fn().mockResolvedValue(pageRow),
          update: jest.fn().mockResolvedValue(pageRow),
        },
        pageSection: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce(overrides?.beforeSections ?? [])
            .mockResolvedValueOnce(overrides?.afterSections ?? [heroSectionRow]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
    }

    it('replaces sections and includes before/after section summaries in audit', async () => {
      const txClient = makeTxClient({
        beforeSections: [],
        afterSections: [heroSectionRow],
      });
      mockPrisma.$transaction.mockImplementation((op: (tx: typeof txClient) => Promise<unknown>) =>
        op(txClient),
      );

      const result = await service.replaceSections('about', validUpsertDto, adminActor);

      expect(result.sections).toHaveLength(1);
      expect(txClient.pageSection.deleteMany).toHaveBeenCalled();
      expect(txClient.pageSection.createMany).toHaveBeenCalled();
      expect(mockAuditService.logAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          beforeSnapshot: expect.objectContaining({ sections: [] }),
          afterSnapshot: expect.objectContaining({
            sections: [expect.objectContaining({ type: SectionType.HERO })],
          }),
        }),
      );
    });

    it('sends correct section payload to createMany', async () => {
      const txClient = makeTxClient();
      mockPrisma.$transaction.mockImplementation((op: (tx: typeof txClient) => Promise<unknown>) =>
        op(txClient),
      );

      await service.replaceSections('about', validUpsertDto, adminActor);

      expect(txClient.pageSection.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ type: SectionType.HERO, order: 0 }),
          ]),
        }),
      );
    });

    it('skips createMany when sections array is empty', async () => {
      const txClient = makeTxClient({ afterSections: [] });
      mockPrisma.$transaction.mockImplementation((op: (tx: typeof txClient) => Promise<unknown>) =>
        op(txClient),
      );

      await service.replaceSections('about', { sections: [] }, adminActor);

      expect(txClient.pageSection.createMany).not.toHaveBeenCalled();
      expect(txClient.pageSection.deleteMany).toHaveBeenCalled();
    });

    it('throws NotFoundException when page does not exist', async () => {
      const txClient = {
        page: { findUnique: jest.fn().mockResolvedValue(null) },
        pageSection: { findMany: jest.fn() },
      };
      mockPrisma.$transaction.mockImplementation((op: (tx: typeof txClient) => Promise<unknown>) =>
        op(txClient),
      );

      await expect(
        service.replaceSections('nonexistent', validUpsertDto, adminActor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException on duplicate section order values (no DB hit)', async () => {
      const dto = {
        sections: [
          { type: SectionType.HERO, order: 0, data: { title: 'A' } },
          { type: SectionType.TEXT, order: 0, data: { content: 'B' } },
        ],
      };

      await expect(service.replaceSections('about', dto, adminActor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException on invalid section data payload (no DB hit)', async () => {
      const dto = {
        sections: [
          // HERO requires title.min(1) — empty string fails Zod
          { type: SectionType.HERO, order: 0, data: { title: '' } },
        ],
      };

      await expect(service.replaceSections('about', dto, adminActor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('retries on P2034 serialization conflict and succeeds on second attempt', async () => {
      const p2034 = new Prisma.PrismaClientKnownRequestError('serialization failure', {
        code: 'P2034',
      });
      const txClient = makeTxClient({ afterSections: [] });

      mockPrisma.$transaction
        .mockRejectedValueOnce(p2034)
        .mockImplementationOnce((op: (tx: typeof txClient) => Promise<unknown>) => op(txClient));

      const result = await service.replaceSections('about', { sections: [] }, adminActor);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      expect(result.slug).toBe('about');
    });

    it('re-throws P2034 after exhausting retry limit', async () => {
      const p2034 = new Prisma.PrismaClientKnownRequestError('serialization failure', {
        code: 'P2034',
      });
      mockPrisma.$transaction.mockRejectedValue(p2034);

      // On the final attempt the raw Prisma error is re-thrown
      await expect(service.replaceSections('about', { sections: [] }, adminActor)).rejects.toThrow(
        'serialization failure',
      );
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(5);
    });
  });

  // ─── publish ─────────────────────────────────────────────────────────────

  describe('publish', () => {
    it('publishes a DRAFT page and logs an audit event', async () => {
      mockPrisma.page.findUnique.mockResolvedValue(pageRow);
      mockPrisma.page.update.mockResolvedValue({
        ...pageRow,
        status: ContentStatus.PUBLISHED,
        publishedAt: now,
        sections: [],
      });

      const result = await service.publish('about', adminActor);

      expect(result.status).toBe(ContentStatus.PUBLISHED);
      expect(mockPrisma.page.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { not: ContentStatus.PUBLISHED } }),
          data: expect.objectContaining({ status: ContentStatus.PUBLISHED }),
        }),
      );
      expect(mockAuditService.logAsync).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when page does not exist', async () => {
      mockPrisma.page.findUnique.mockResolvedValue(null);

      await expect(service.publish('nonexistent', adminActor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ConflictException when already published (P2025)', async () => {
      mockPrisma.page.findUnique.mockResolvedValue({
        ...pageRow,
        status: ContentStatus.PUBLISHED,
      });
      mockPrisma.page.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('record not found', { code: 'P2025' }),
      );

      await expect(service.publish('about', adminActor)).rejects.toBeInstanceOf(ConflictException);
      expect(mockAuditService.logAsync).not.toHaveBeenCalled();
    });
  });

  // ─── archive ─────────────────────────────────────────────────────────────

  describe('archive', () => {
    it('archives a PUBLISHED page and logs an audit event', async () => {
      mockPrisma.page.findUnique.mockResolvedValue({
        ...pageRow,
        status: ContentStatus.PUBLISHED,
      });
      mockPrisma.page.update.mockResolvedValue({
        ...pageRow,
        status: ContentStatus.ARCHIVED,
        sections: [],
      });

      const result = await service.archive('about', adminActor);

      expect(result.status).toBe(ContentStatus.ARCHIVED);
      expect(mockPrisma.page.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: ContentStatus.PUBLISHED }),
          data: expect.objectContaining({ status: ContentStatus.ARCHIVED }),
        }),
      );
      expect(mockAuditService.logAsync).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when page does not exist', async () => {
      mockPrisma.page.findUnique.mockResolvedValue(null);

      await expect(service.archive('nonexistent', adminActor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ConflictException for a DRAFT page (re-reads on P2025)', async () => {
      // findPageOrThrow call
      mockPrisma.page.findUnique
        .mockResolvedValueOnce({ ...pageRow, status: ContentStatus.DRAFT })
        // re-read inside P2025 catch handler
        .mockResolvedValueOnce({ status: ContentStatus.DRAFT });
      mockPrisma.page.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('record not found', { code: 'P2025' }),
      );

      await expect(service.archive('about', adminActor)).rejects.toThrow(/Cannot archive a DRAFT/);
      expect(mockAuditService.logAsync).not.toHaveBeenCalled();
    });

    it('throws ConflictException when already archived (re-reads on P2025)', async () => {
      mockPrisma.page.findUnique
        .mockResolvedValueOnce({ ...pageRow, status: ContentStatus.PUBLISHED })
        .mockResolvedValueOnce({ status: ContentStatus.ARCHIVED });
      mockPrisma.page.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('record not found', { code: 'P2025' }),
      );

      await expect(service.archive('about', adminActor)).rejects.toThrow(/already archived/);
      expect(mockAuditService.logAsync).not.toHaveBeenCalled();
    });

    it('re-throws unexpected errors from update', async () => {
      mockPrisma.page.findUnique.mockResolvedValue({
        ...pageRow,
        status: ContentStatus.PUBLISHED,
      });
      mockPrisma.page.update.mockRejectedValue(new Error('network timeout'));

      await expect(service.archive('about', adminActor)).rejects.toThrow('network timeout');
    });
  });

  // ─── updateName ──────────────────────────────────────────────────────────

  describe('updateName', () => {
    it('renames a page and returns the updated summary', async () => {
      const updatedRow = { ...pageRow, name: 'About Us' };
      mockPrisma.page.findUnique.mockResolvedValue(pageRow);
      mockPrisma.page.update.mockResolvedValue(updatedRow);

      const result = await service.updateName('about', { name: 'About Us' }, adminActor);

      expect(result.name).toBe('About Us');
      expect(result).not.toHaveProperty('sections');
      expect(mockPrisma.page.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: pageRow.id },
          data: { name: 'About Us' },
        }),
      );
    });

    it('logs an UPDATE audit event with before/after snapshots', async () => {
      const updatedRow = { ...pageRow, name: 'About Us' };
      mockPrisma.page.findUnique.mockResolvedValue(pageRow);
      mockPrisma.page.update.mockResolvedValue(updatedRow);

      await service.updateName('about', { name: 'About Us' }, adminActor);

      expect(mockAuditService.logAsync).toHaveBeenCalledTimes(1);
      expect(mockAuditService.logAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: adminActor.id,
          resourceId: pageRow.id,
          beforeSnapshot: expect.objectContaining({ name: 'About' }),
          afterSnapshot: expect.objectContaining({ name: 'About Us' }),
        }),
      );
    });

    it('throws NotFoundException when page does not exist', async () => {
      mockPrisma.page.findUnique.mockResolvedValue(null);

      await expect(
        service.updateName('nonexistent', { name: 'New Name' }, adminActor),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockPrisma.page.update).not.toHaveBeenCalled();
      expect(mockAuditService.logAsync).not.toHaveBeenCalled();
    });

    it('re-throws unexpected DB errors', async () => {
      mockPrisma.page.findUnique.mockResolvedValue(pageRow);
      mockPrisma.page.update.mockRejectedValue(new Error('DB timeout'));

      await expect(service.updateName('about', { name: 'New Name' }, adminActor)).rejects.toThrow(
        'DB timeout',
      );

      expect(mockAuditService.logAsync).not.toHaveBeenCalled();
    });
  });
});
