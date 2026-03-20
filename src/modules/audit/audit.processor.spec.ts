import { Test, TestingModule } from '@nestjs/testing';
import { AuditProcessor } from './audit.processor.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditAction, AuditResourceType } from '../../generated/prisma/enums.js';
import type { AuditJobData } from './interfaces/audit-event.interface.js';

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

const sampleJobData: AuditJobData = {
  auditId: 'audit-uuid-1',
  actorId: 'actor-1',
  action: AuditAction.CREATE,
  resourceType: AuditResourceType.User,
  resourceId: 'res-1',
  beforeSnapshot: null,
  afterSnapshot: { id: 'res-1' },
  actorIp: '10.0.0.1',
  actorUserAgent: 'Jest/1.0',
};

const mockJob = { data: sampleJobData, id: 'job-1' } as unknown;

describe('AuditProcessor', () => {
  let processor: AuditProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditProcessor, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    processor = module.get<AuditProcessor>(AuditProcessor);
    jest.clearAllMocks();
  });

  it('creates an audit log entry from job data', async () => {
    mockPrisma.auditLog.create.mockResolvedValue({ id: sampleJobData.auditId });

    await processor.process(mockJob as never);

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'audit-uuid-1',
          actorId: 'actor-1',
          action: AuditAction.CREATE,
          resourceType: AuditResourceType.User,
          resourceId: 'res-1',
          actorIp: '10.0.0.1',
          actorUserAgent: 'Jest/1.0',
        }),
      }),
    );
  });

  it('silently ignores P2002 unique-constraint violations (idempotency)', async () => {
    const error = new Error('Unique constraint') as Error & { code: string };
    error.code = 'P2002';
    mockPrisma.auditLog.create.mockRejectedValue(error);

    await expect(processor.process(mockJob as never)).resolves.toBeUndefined();
  });

  it('re-throws non-P2002 errors for BullMQ retry', async () => {
    mockPrisma.auditLog.create.mockRejectedValue(new Error('Connection lost'));

    await expect(processor.process(mockJob as never)).rejects.toThrow('Connection lost');
  });
});
