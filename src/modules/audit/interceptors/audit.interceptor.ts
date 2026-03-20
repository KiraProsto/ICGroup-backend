import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, from, of } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { AuditService } from '../audit.service.js';
import { AUDIT_METADATA_KEY, type AuditMeta } from '../decorators/audit.decorator.js';
import type { AuditEventData } from '../interfaces/audit-event.interface.js';
import type { AuthenticatedUser } from '../../auth/decorators/current-user.decorator.js';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Intercepts HTTP mutation requests (POST, PUT, PATCH, DELETE) on routes
 * decorated with `@Audit()` and writes an audit log entry.
 *
 * Routing:
 *  - Non-HTTP contexts (WebSocket, RPC) → passthrough, no logging.
 *  - Non-mutation methods (GET, HEAD, …) → passthrough, no logging.
 *  - Routes without `@Audit()` metadata → passthrough, no logging.
 *  - Unauthenticated requests (no `request.user`) → passthrough. Auth events
 *    on public routes (login, logout) are recorded by AuthService directly.
 *
 * Write modes:
 *  - `security: true`  → AuditService.logSync() — synchronous DB write before
 *    the response is returned. The operation has already committed by the time
 *    the interceptor runs, so audit failures are **logged at error level but
 *    never propagated** to the client (rolling back is impossible after commit).
 *    Services that need transactional audit guarantees (e.g. role changes)
 *    should call AuditService.logSync directly within a Prisma transaction
 *    instead of relying on the interceptor.
 *  - `security: false` (default) → AuditService.logAsync() — fire-and-forget
 *    BullMQ job (3 retries, exponential back-off).
 *
 * Before-snapshot: always null at interceptor level. Services that need
 * transactional before/after snapshots should call AuditService directly
 * inside a Prisma transaction.
 *
 * ResourceId extraction order:
 *  1. Route params `id` (PUT, PATCH, DELETE — resource already exists).
 *  2. Response body `.id` field (POST — resource was just created).
 *  3. `"unknown"` — fallback when neither is available.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();

    if (!MUTATION_METHODS.has(request.method)) {
      return next.handle();
    }

    const meta = this.reflector.getAllAndOverride<AuditMeta | undefined>(AUDIT_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!meta) {
      return next.handle();
    }

    // Public routes (login / logout) have no authenticated user — AuthService
    // records those audit events synchronously within the auth flow.
    const user = request.user;
    if (!user) {
      return next.handle();
    }

    const actorId = user.id;
    const actorIp = user.ip;
    const actorUserAgent = user.userAgent;

    return next.handle().pipe(
      mergeMap((responseBody: unknown) => {
        const resourceId = extractResourceId(
          request.method,
          request.params as Record<string, string>,
          responseBody,
        );

        const eventData: AuditEventData = {
          actorId,
          action: meta.action,
          resourceType: meta.resourceType,
          resourceId,
          beforeSnapshot: null,
          afterSnapshot: toSnapshot(responseBody),
          actorIp,
          actorUserAgent,
        };

        return from(this.recordAudit(meta, eventData)).pipe(
          map(() => responseBody),
          catchError((err: unknown) => {
            // The handler already committed — never fail the response on audit errors.
            // Security events get a louder log level so alerting can pick them up.
            const message = `Audit log failed: action=${meta.action}, resource=${meta.resourceType}/${resourceId}, actorId=${actorId}`;
            if (meta.security) {
              this.logger.error(
                `[SECURITY] ${message} — audit trail for security-critical event is missing`,
                err instanceof Error ? err.stack : String(err),
              );
            } else {
              this.logger.error(message, err instanceof Error ? err.stack : String(err));
            }
            return of(responseBody);
          }),
        );
      }),
    );
  }

  private async recordAudit(meta: AuditMeta, eventData: AuditEventData): Promise<void> {
    if (meta.security) {
      await this.auditService.logSync(eventData);
    } else {
      await this.auditService.logAsync(eventData);
    }
  }
}

/**
 * Determines the resourceId from the HTTP context.
 *
 * - For non-POST mutations the resource exists prior to the call → use `:id`
 *   route param.
 * - For POST (create) the resource is new → use the `id` field from the
 *   response body.
 * - Falls back to `"unknown"` when neither is available.
 */
function extractResourceId(method: string, params: Record<string, string>, body: unknown): string {
  if (method !== 'POST' && params['id']) {
    return params['id'];
  }

  if (typeof body === 'object' && body !== null && 'id' in body) {
    const id = (body as Record<string, unknown>)['id'];
    if (typeof id === 'string' || typeof id === 'number') {
      return String(id);
    }
  }

  return params['id'] ?? 'unknown';
}

/**
 * Returns the value as a plain-object snapshot for JSON storage, or null
 * when the value is not an object (e.g. undefined for 204 responses).
 */
function toSnapshot(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
