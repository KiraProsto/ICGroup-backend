import type { Role } from '../../../generated/prisma/enums.js';

/**
 * Payload embedded in the short-lived access JWT (15 min).
 * sub  — userId (UUID)
 * role — user role, embedded to avoid an extra DB round-trip in the guard
 * jti  — unique token ID (for future access-token revocation, if needed)
 */
export interface JwtAccessPayload {
  sub: string;
  role: Role;
  jti: string;
  iat?: number;
  exp?: number;
}

/**
 * Payload embedded in the long-lived refresh JWT (7 days).
 * sub      — userId (UUID)
 * jti      — unique token ID; used as the Redis allowlist key
 * familyId — rotation family; all tokens sharing a familyId that are
 *            replayed after consumption trigger a full family revocation
 */
export interface JwtRefreshPayload {
  sub: string;
  jti: string;
  familyId: string;
  iat?: number;
  exp?: number;
}
