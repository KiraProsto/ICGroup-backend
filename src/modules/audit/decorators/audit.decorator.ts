import { SetMetadata } from '@nestjs/common';
import type { AuditAction, AuditResourceType } from '../../../generated/prisma/enums.js';

export const AUDIT_METADATA_KEY = 'audit:meta';

export interface AuditMeta {
  action: AuditAction;
  resourceType: AuditResourceType;
  /**
   * If true, the audit event is written synchronously via AuditService.logSync()
   * before the HTTP response is returned. Use for security-critical mutations
   * (e.g. role changes) that must be reliably persisted.
   *
   * Defaults to false — operational events (CRUD on content, companies,
   * purchases) are enqueued via BullMQ (AuditService.logAsync()).
   */
  security?: boolean;
}

/**
 * Marks a mutation route for automatic audit logging via AuditInterceptor.
 *
 * Security events (`security: true`) are written synchronously before the
 * response is sent. Operational events are enqueued onto the BullMQ audit
 * queue (fire-and-forget, 3 retries with exponential back-off).
 *
 * **WARNING:** Do NOT apply this decorator to routes whose service methods
 * already call `AuditService.logAsync()` / `logSync()` directly — doing so
 * will produce duplicate audit log entries for a single mutation.
 *
 * @example Security event — role change
 * ```ts
 * @Audit({ action: AuditAction.UPDATE, resourceType: AuditResourceType.User, security: true })
 * @Patch(':id/role')
 * changeRole(@Param('id') id: string, @Body() dto: ChangeRoleDto) {}
 * ```
 *
 * @example Operational event — create article
 * ```ts
 * @Audit({ action: AuditAction.CREATE, resourceType: AuditResourceType.NewsArticle })
 * @Post()
 * createArticle(@Body() dto: CreateArticleDto) {}
 * ```
 */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_METADATA_KEY, meta);
