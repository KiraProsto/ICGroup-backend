import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  paginatedResult,
  type PaginatedResult,
} from '../../common/interceptors/transform-response.interceptor.js';
import { AUDIT_QUEUE_NAME, AUDIT_JOB_NAME } from './audit.constants.js';
import type { AuditEventData, AuditJobData } from './interfaces/audit-event.interface.js';
import type { ListAuditQueryDto } from './dto/list-audit-query.dto.js';
import type { AuditLogResponseDto } from './dto/audit-log-response.dto.js';

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
   * must be recorded — the error **propagates** so the caller can decide
   * whether to abort the operation if the audit trail cannot be persisted.
   *
   * Note: When called from AuditInterceptor (post-commit context), failures
   * are caught and logged — the response is still returned. For transactional
   * guarantees, call logSync directly inside a Prisma transaction.
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

  // ─── Select fields exposed in list responses ───────────────────────────────
  private static readonly AUDIT_LOG_SELECT = {
    id: true,
    timestamp: true,
    actorId: true,
    actorIp: true,
    actorUserAgent: true,
    action: true,
    resourceType: true,
    resourceId: true,
    status: true,
  } as const;

  /**
   * Returns a paginated, filtered list of audit log entries.
   * Heavy JSONB columns (beforeSnapshot, afterSnapshot, metadata) are
   * intentionally excluded from list responses.
   */
  async findAll(query: ListAuditQueryDto): Promise<PaginatedResult<AuditLogResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const skip = (page - 1) * perPage;

    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            timestamp: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: AuditService.AUDIT_LOG_SELECT,
        orderBy: { timestamp: 'desc' },
        skip,
        take: perPage,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const items: AuditLogResponseDto[] = logs.map((log) => ({
      ...log,
      timestamp: log.timestamp.toISOString(),
    }));

    return paginatedResult(items, {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    });
  }
}
