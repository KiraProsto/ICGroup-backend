import type { AuditAction, AuditResourceType } from '../../../generated/prisma/enums.js';

/** Max length for actorIp (covers IPv6 mapped IPv4, e.g. ::ffff:192.168.1.1). */
export const ACTOR_IP_MAX_LENGTH = 45;
/** Max length for actorUserAgent (reasonable cap for User-Agent strings). */
export const ACTOR_USER_AGENT_MAX_LENGTH = 512;

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
  /** Source IP address of the request — extracted from the controller layer. */
  actorIp?: string;
  /** User-Agent header — extracted from the controller layer. */
  actorUserAgent?: string;
}

/**
 * BullMQ job payload — extends AuditEventData with a pre-generated UUID
 * that becomes the AuditLog.id, guaranteeing idempotent processing.
 */
export interface AuditJobData extends AuditEventData {
  /** Pre-generated UUID used as the PK — ensures retries are idempotent. */
  auditId: string;
}
