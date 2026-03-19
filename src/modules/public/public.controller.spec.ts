import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';

// Prevent Jest from loading the real Prisma generated client.
jest.mock('../../generated/prisma/client.js', () => ({
  PrismaClient: jest.fn(),
  Prisma: { JsonNull: Symbol('JsonNull') },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('pg', () => ({ Pool: jest.fn() }));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const pageDto = {
  id: 'page-uuid-1',
  slug: 'about',
  name: 'About Us',
  publishedAt: '2026-03-12T00:00:00.000Z',
  sections: [{ id: 'sec-1', type: 'HERO', order: 0, data: { title: 'Hi' } }],
};

const newsListResult = {
  data: [{ id: 'n1', slug: 'news-1', title: 'News One', publishedAt: '2026-03-12T00:00:00.000Z' }],
  meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
};

const newsDetailDto = {
  id: 'n1',
  slug: 'news-1',
  title: 'News One',
  publishedAt: '2026-03-12T00:00:00.000Z',
  bodyHtml: '<p>Content</p>',
  socialMeta: null,
  excerptImage: null,
};

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPublicService = {
  findPublishedPage: jest.fn(),
  findPublishedNewsList: jest.fn(),
  findPublishedNewsBySlug: jest.fn(),
};

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('PublicController', () => {
  let controller: PublicController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicController],
      providers: [{ provide: PublicService, useValue: mockPublicService }],
    }).compile();

    controller = module.get<PublicController>(PublicController);
  });

  // ─── findPage ────────────────────────────────────────────────────────────

  describe('findPage', () => {
    it('delegates to PublicService.findPublishedPage', async () => {
      mockPublicService.findPublishedPage.mockResolvedValue(pageDto);

      const result = await controller.findPage('about');

      expect(result).toEqual(pageDto);
      expect(mockPublicService.findPublishedPage).toHaveBeenCalledWith('about');
    });

    it('propagates NotFoundException from the service', async () => {
      mockPublicService.findPublishedPage.mockRejectedValue(
        new NotFoundException('Page "nonexistent" not found'),
      );

      await expect(controller.findPage('nonexistent')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── findNewsList ────────────────────────────────────────────────────────

  describe('findNewsList', () => {
    it('delegates to PublicService.findPublishedNewsList', async () => {
      mockPublicService.findPublishedNewsList.mockResolvedValue(newsListResult);

      const query = { page: 1, perPage: 20 };
      const result = await controller.findNewsList(query);

      expect(result).toEqual(newsListResult);
      expect(mockPublicService.findPublishedNewsList).toHaveBeenCalledWith(query);
    });
  });

  // ─── findNewsBySlug ──────────────────────────────────────────────────────

  describe('findNewsBySlug', () => {
    it('delegates to PublicService.findPublishedNewsBySlug', async () => {
      mockPublicService.findPublishedNewsBySlug.mockResolvedValue(newsDetailDto);

      const result = await controller.findNewsBySlug('news-1');

      expect(result).toEqual(newsDetailDto);
      expect(mockPublicService.findPublishedNewsBySlug).toHaveBeenCalledWith('news-1');
    });

    it('propagates NotFoundException from the service', async () => {
      mockPublicService.findPublishedNewsBySlug.mockRejectedValue(
        new NotFoundException('Article not found'),
      );

      await expect(controller.findNewsBySlug('nonexistent')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
