import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { AuditService } from './audit.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_QUEUE_NAME, AUDIT_JOB_NAME } from './audit.constants.js';
import { AuditAction, AuditResourceType } from '../../generated/prisma/enums.js';

// Prevent Jest from loading the real Prisma generated client.
jest.mock('../../generated/prisma/client.js', () => ({
  PrismaClient: jest.fn(),
  Prisma: { JsonNull: null },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('pg', () => ({ Pool: jest.fn() }));

const mockPrisma = {
  auditLog: { create: jest.fn() },
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

    it('does not throw when the database write fails', async () => {
      mockPrisma.auditLog.create.mockRejectedValue(new Error('DB down'));

      await expect(service.logSync(sampleEvent)).resolves.toBeUndefined();
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
});
