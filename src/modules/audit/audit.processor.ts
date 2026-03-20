import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_QUEUE_NAME } from './audit.constants.js';
import type { AuditJobData } from './interfaces/audit-event.interface.js';

/**
 * BullMQ processor for the audit queue.
 *
 * Idempotency: the job data includes a pre-generated `auditId` used as the
 * AuditLog PK. If the job is retried after a partial success (DB wrote but
 * worker crashed before acking), the P2002 unique-constraint violation is
 * caught and treated as a no-op.
 */
@Processor(AUDIT_QUEUE_NAME)
export class AuditProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<AuditJobData>): Promise<void> {
    const data = job.data;

    try {
      await this.prisma.auditLog.create({
        data: {
          id: data.auditId,
          actorId: data.actorId,
          action: data.action,
          resourceType: data.resourceType,
          resourceId: data.resourceId,
          actorIp: data.actorIp ?? null,
          actorUserAgent: data.actorUserAgent ?? null,
          beforeSnapshot: (data.beforeSnapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          afterSnapshot: (data.afterSnapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          metadata: data.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      if (this.isPrismaUniqueViolation(error)) {
        this.logger.debug(
          `Audit log ${data.auditId} already exists — skipping duplicate (job ${job.id})`,
        );
        return;
      }
      throw error; // Re-throw so BullMQ retries the job
    }
  }

  private isPrismaUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'P2002'
    );
  }
}
