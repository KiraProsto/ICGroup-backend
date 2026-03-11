import type { AuditAction, AuditResourceType } from '../../../generated/prisma/enums.js';

/**
 * Payload passed to both synchronous (logSync) and asynchronous (logAsync)
 * audit writes. Mirrors the AuditLog model columns.
 */
export interface AuditEventData {
  actorId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

/**
 * BullMQ job payload — extends AuditEventData with a pre-generated UUID
 * that becomes the AuditLog.id, guaranteeing idempotent processing.
 */
export interface AuditJobData extends AuditEventData {
  /** Pre-generated UUID used as the PK — ensures retries are idempotent. */
  auditId: string;
}
