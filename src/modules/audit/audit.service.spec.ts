import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { AuditService } from './audit.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_QUEUE_NAME, AUDIT_JOB_NAME } from './audit.constants.js';
import { AuditAction, AuditLogStatus, AuditResourceType } from '../../generated/prisma/enums.js';

// Prevent Jest from loading the real Prisma generated client.
jest.mock('../../generated/prisma/client.js', () => ({
  PrismaClient: jest.fn(),
  Prisma: { JsonNull: null },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('pg', () => ({ Pool: jest.fn() }));

const mockPrisma = {
  auditLog: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
};

const mockQueue = {
  add: jest.fn().mockResolvedValue(undefined),
};

const sampleEvent = {
  actorId: 'actor-1',
  action: AuditAction.CREATE,
  resourceType: AuditResourceType.User,
  resourceId: 'res-1',
  beforeSnapshot: null,
  afterSnapshot: { id: 'res-1', email: 'a@b.com' },
};

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(AUDIT_QUEUE_NAME), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    jest.clearAllMocks();
  });

  describe('logSync', () => {
    it('writes directly to the database', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

      await service.logSync(sampleEvent);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: 'actor-1',
            action: AuditAction.CREATE,
            resourceType: AuditResourceType.User,
            resourceId: 'res-1',
          }),
        }),
      );
    });

    it('propagates the error when the database write fails', async () => {
      mockPrisma.auditLog.create.mockRejectedValue(new Error('DB down'));

      await expect(service.logSync(sampleEvent)).rejects.toThrow('DB down');
    });

    it('passes actorIp and actorUserAgent to the database', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-2' });

      await service.logSync({
        ...sampleEvent,
        actorIp: '192.168.1.1',
        actorUserAgent: 'TestBrowser/1.0',
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorIp: '192.168.1.1',
            actorUserAgent: 'TestBrowser/1.0',
          }),
        }),
      );
    });
  });

  describe('logAsync', () => {
    it('enqueues a job on the audit queue', async () => {
      await service.logAsync(sampleEvent);

      expect(mockQueue.add).toHaveBeenCalledWith(
        AUDIT_JOB_NAME,
        expect.objectContaining({ actorId: 'actor-1', auditId: expect.any(String) }),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        }),
      );
    });

    it('generates a unique jobId for deduplication', async () => {
      await service.logAsync(sampleEvent);

      const jobOptions = mockQueue.add.mock.calls[0][2] as { jobId: string };
      expect(jobOptions.jobId).toMatch(/^audit-/);
    });
  });

  describe('findAll', () => {
    const sampleLog = {
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

    beforeEach(() => {
      mockPrisma.auditLog.findMany.mockResolvedValue([sampleLog]);
      mockPrisma.auditLog.count.mockResolvedValue(1);
    });

    it('returns a paginated list of audit logs', async () => {
      const result = await service.findAll({ page: 1, perPage: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ id: 'log-1', action: AuditAction.CREATE });
      expect(result.meta).toMatchObject({ total: 1, page: 1, perPage: 20, totalPages: 1 });
    });

    it('applies actorId filter', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([sampleLog]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      await service.findAll({ actorId: 'actor-1' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ actorId: 'actor-1' }) }),
      );
    });

    it('applies action filter', async () => {
      await service.findAll({ action: AuditAction.LOGIN });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ action: AuditAction.LOGIN }) }),
      );
    });

    it('applies resourceType filter', async () => {
      await service.findAll({ resourceType: AuditResourceType.NewsArticle });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resourceType: AuditResourceType.NewsArticle }),
        }),
      );
    });

    it('applies dateFrom filter as gte', async () => {
      await service.findAll({ dateFrom: '2026-01-01T00:00:00.000Z' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            timestamp: expect.objectContaining({ gte: new Date('2026-01-01T00:00:00.000Z') }),
          }),
        }),
      );
    });

    it('applies dateTo filter as lte', async () => {
      await service.findAll({ dateTo: '2026-12-31T23:59:59.999Z' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            timestamp: expect.objectContaining({ lte: new Date('2026-12-31T23:59:59.999Z') }),
          }),
        }),
      );
    });

    it('orders results by timestamp descending', async () => {
      await service.findAll({});

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { timestamp: 'desc' } }),
      );
    });

    it('uses skip/take for pagination', async () => {
      await service.findAll({ page: 3, perPage: 10 });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('returns empty list when no logs match', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      const result = await service.findAll({});

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });
});
