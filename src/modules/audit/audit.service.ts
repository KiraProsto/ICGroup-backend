import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_QUEUE_NAME, AUDIT_JOB_NAME } from './audit.constants.js';
import type { AuditEventData, AuditJobData } from './interfaces/audit-event.interface.js';

/**
 * AuditService provides two writing modes:
 *
 *  - logSync  — direct DB write for security-critical events (login, logout,
 *               role changes) that must be recorded immediately.
 *  - logAsync — enqueues a BullMQ job for operational events (content/sales
 *               CRUD) to offload work from the request path and avoid holding
 *               serializable transaction locks on the audit_logs table.
 *
 * Idempotency (async path):
 *   A UUID is pre-generated and used both as the BullMQ jobId and the
 *   AuditLog PK. If a job is retried, the processor catches the P2002
 *   unique-constraint violation and treats it as success.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectQueue(AUDIT_QUEUE_NAME) private readonly auditQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Writes an audit log entry directly to the database.
   * Used for security-critical events (login, logout, role changes) that
   * must be recorded — the error propagates so the caller can decide
   * whether to abort the operation if the audit trail cannot be persisted.
   */
  async logSync(data: AuditEventData): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
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
  }

  /**
   * Enqueues an audit log write as a BullMQ job.
   * Used for operational events (CRUD on content, companies, purchases).
   *
   * The job is processed by AuditProcessor with 3 retries, exponential backoff,
   * and idempotent handling via the pre-generated auditId.
   */
  async logAsync(data: AuditEventData): Promise<void> {
    const auditId = uuidv4();
    const jobData: AuditJobData = { ...data, auditId };

    try {
      await this.auditQueue.add(AUDIT_JOB_NAME, jobData, {
        jobId: `audit-${auditId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      });
    } catch (error) {
      this.logger.error(
        `Failed to enqueue async audit log: auditId=${auditId}, action=${data.action}, resource=${data.resourceType}/${data.resourceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
