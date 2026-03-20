import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { AuditAction, AuditLogStatus, AuditResourceType } from '../../generated/prisma/enums.js';
import type { ListAuditQueryDto } from './dto/list-audit-query.dto.js';
import { paginatedResult } from '../../common/interceptors/transform-response.interceptor.js';

// Prevent Jest from loading the real Prisma generated client.
jest.mock('../../generated/prisma/client.js', () => ({
  PrismaClient: jest.fn(),
  Prisma: { JsonNull: null },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('pg', () => ({ Pool: jest.fn() }));

const mockLog = {
  id: 'log-1',
  timestamp: new Date('2026-03-20T12:00:00.000Z'),
  actorId: 'actor-1',
  actorIp: '127.0.0.1',
  actorUserAgent: 'TestBrowser/1.0',
  action: AuditAction.CREATE,
  resourceType: AuditResourceType.User,
  resourceId: 'res-1',
  status: AuditLogStatus.SUCCESS,
};

const mockPaginatedResult = paginatedResult([mockLog], {
  total: 1,
  page: 1,
  perPage: 20,
  totalPages: 1,
});

const mockAuditService = {
  findAll: jest.fn().mockResolvedValue(mockPaginatedResult),
};

describe('AuditController', () => {
  let controller: AuditController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: mockAuditService }],
    }).compile();

    controller = module.get<AuditController>(AuditController);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('delegates to AuditService.findAll and returns paginated result', async () => {
      mockAuditService.findAll.mockResolvedValueOnce(mockPaginatedResult);

      const query: ListAuditQueryDto = { page: 1, perPage: 20 };
      const result = await controller.findAll(query);

      expect(mockAuditService.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(mockPaginatedResult);
    });

    it('passes actorId filter to the service', async () => {
      mockAuditService.findAll.mockResolvedValueOnce(mockPaginatedResult);

      const query: ListAuditQueryDto = { actorId: 'actor-1' };
      await controller.findAll(query);

      expect(mockAuditService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'actor-1' }),
      );
    });

    it('passes action filter to the service', async () => {
      mockAuditService.findAll.mockResolvedValueOnce(mockPaginatedResult);

      const query: ListAuditQueryDto = { action: AuditAction.LOGIN };
      await controller.findAll(query);

      expect(mockAuditService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.LOGIN }),
      );
    });

    it('passes resourceType filter to the service', async () => {
      mockAuditService.findAll.mockResolvedValueOnce(mockPaginatedResult);

      const query: ListAuditQueryDto = { resourceType: AuditResourceType.NewsArticle };
      await controller.findAll(query);

      expect(mockAuditService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: AuditResourceType.NewsArticle }),
      );
    });

    it('passes date range filters to the service', async () => {
      mockAuditService.findAll.mockResolvedValueOnce(mockPaginatedResult);

      const query: ListAuditQueryDto = {
        dateFrom: '2026-01-01T00:00:00.000Z',
        dateTo: '2026-12-31T23:59:59.999Z',
      };
      await controller.findAll(query);

      expect(mockAuditService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: '2026-01-01T00:00:00.000Z',
          dateTo: '2026-12-31T23:59:59.999Z',
        }),
      );
    });

    it('returns empty data when there are no matching logs', async () => {
      const empty = paginatedResult([], { total: 0, page: 1, perPage: 20, totalPages: 0 });
      mockAuditService.findAll.mockResolvedValueOnce(empty);

      const result = await controller.findAll({});

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });
});
