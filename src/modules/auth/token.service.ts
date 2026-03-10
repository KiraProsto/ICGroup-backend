import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { REDIS_CLIENT } from '../../redis/redis.module.js';
import type { Role } from '../../generated/prisma/enums.js';
import type { JwtAccessPayload, JwtRefreshPayload } from './interfaces/jwt-payload.interface.js';

/** Access token TTL constant for informational use — JWT expiry is enforced by @nestjs/jwt. */
const REFRESH_TOKEN_TTL_S = 7 * 24 * 60 * 60; // 7 days in seconds

/** Redis key helpers — centralised to prevent typos across the module. */
function rtKey(jti: string): string {
  return `rt:${jti}`;
}
function rtFamilyKey(familyId: string, jti: string): string {
  return `rt-family:${familyId}:${jti}`;
}
function rtFamilyActiveKey(familyId: string): string {
  return `rt-family-active:${familyId}`;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** jti of the issued refresh token — stored in HttpOnly cookie. */
  refreshJti: string;
  familyId: string;
}

/**
 * TokenService is responsible for:
 * - Issuing signed access and refresh JWTs
 * - Managing the refresh-token allowlist in Redis (`rt:{jti}`)
 * - Enforcing family-based rotation and reuse detection
 *   (`rt-family:{familyId}:{jti}` and `rt-family-active:{familyId}`)
 *
 * Redis key schema:
 *   rt:{jti}                         → "{userId}:{familyId}"   TTL 7d (allowlist entry)
 *   rt-family:{familyId}:{jti}       → "1"                    TTL 7d (consumed marker)
 *   rt-family-active:{familyId}      → Redis SET of active jtis TTL 7d
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ─── Issue ──────────────────────────────────────────────────────────────

  /**
   * Issues a brand-new access+refresh token pair (e.g. on login).
   * A fresh `familyId` is generated — this is the root of a new family.
   */
  async issueTokens(userId: string, role: Role): Promise<IssuedTokens> {
    const familyId = uuidv4();
    return this.rotateTokens(userId, role, familyId);
  }

  /**
   * Rotates within an existing family: deletes the old allowlist entry,
   * marks the old jti as consumed, and issues a new pair under the same familyId.
   *
   * Called only after the incoming refresh token has been validated — do NOT
   * call this directly from the controller.
   */
  async rotateRefreshToken(
    oldJti: string,
    userId: string,
    role: Role,
    familyId: string,
  ): Promise<IssuedTokens> {
    const newJti = uuidv4();

    // Atomic pipeline: update Redis state and issue new entries together.
    const pipeline = this.redis.pipeline();
    pipeline.del(rtKey(oldJti));
    pipeline.set(rtFamilyKey(familyId, oldJti), '1', 'EX', REFRESH_TOKEN_TTL_S);
    pipeline.set(rtKey(newJti), `${userId}:${familyId}`, 'EX', REFRESH_TOKEN_TTL_S);
    pipeline.sadd(rtFamilyActiveKey(familyId), newJti);
    pipeline.srem(rtFamilyActiveKey(familyId), oldJti);
    pipeline.expire(rtFamilyActiveKey(familyId), REFRESH_TOKEN_TTL_S);
    await pipeline.exec();

    const accessToken = this.signAccessToken(userId, role, uuidv4());
    const refreshToken = this.signRefreshToken(userId, newJti, familyId);

    return { accessToken, refreshToken, refreshJti: newJti, familyId };
  }

  // ─── Validate ────────────────────────────────────────────────────────────

  /**
   * Validates a refresh token for the /auth/refresh endpoint.
   *
   * Steps:
   * 1. Verify JWT signature and expiry.
   * 2. Check Redis allowlist — if absent, perform reuse detection.
   * 3. Return the payload for rotation.
   *
   * Throws `UnauthorizedException` on any failure.
   */
  async validateRefreshToken(token: string): Promise<JwtRefreshPayload> {
    let payload: JwtRefreshPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(token, {
        secret: this.configService.getOrThrow<string>('auth.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const { jti, familyId, sub: userId } = payload;

    // Check if this jti is in the allowlist.
    const allowlistEntry = await this.redis.get(rtKey(jti));

    if (!allowlistEntry) {
      // Token not in allowlist — could be expired or already consumed.
      // Check whether it was legitimately consumed (marks a replay attack).
      const consumedMark = await this.redis.get(rtFamilyKey(familyId, jti));
      if (consumedMark) {
        // Token was consumed before — this is a REUSE attack.
        this.logger.warn(
          `Refresh token reuse detected for user=${userId}, family=${familyId}, jti=${jti}. Revoking entire family.`,
        );
        await this.revokeFamily(familyId);
      }
      throw new UnauthorizedException('Refresh token is invalid or has been revoked');
    }

    // Verify allowlist entry matches the claimed user/family (prevents cross-user forgery).
    const [storedUserId, storedFamilyId] = allowlistEntry.split(':');
    if (storedUserId !== userId || storedFamilyId !== familyId) {
      this.logger.warn(`Refresh token allowlist mismatch for jti=${jti}. Possible tampering.`);
      throw new UnauthorizedException('Refresh token is invalid or has been revoked');
    }

    return payload;
  }

  // ─── Revoke ─────────────────────────────────────────────────────────────

  /**
   * Revokes a single refresh token on logout.
   * Removes both the allowlist entry and the family-active set membership.
   */
  async revokeRefreshToken(jti: string, familyId: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.del(rtKey(jti));
    pipeline.srem(rtFamilyActiveKey(familyId), jti);
    await pipeline.exec();
  }

  /**
   * Revokes all active tokens in a family (used on reuse detection).
   * Reads the set of active jtis and deletes each allowlist entry atomically.
   */
  async revokeFamily(familyId: string): Promise<void> {
    const activeJtis = await this.redis.smembers(rtFamilyActiveKey(familyId));

    if (activeJtis.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const jti of activeJtis) {
        pipeline.del(rtKey(jti));
      }
      pipeline.del(rtFamilyActiveKey(familyId));
      await pipeline.exec();
    } else {
      // Nothing to revoke — clean up the set key regardless.
      await this.redis.del(rtFamilyActiveKey(familyId));
    }

    this.logger.log(`Revoked family ${familyId} (${activeJtis.length} active tokens deleted)`);
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private signAccessToken(userId: string, role: Role, jti: string): string {
    const payload: JwtAccessPayload = { sub: userId, role, jti };
    return this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('auth.accessSecret'),
      // Cast needed: ConfigService returns plain string but @nestjs/jwt v11
      // expects the branded ms `StringValue` type.
      expiresIn: this.configService.get<string>('auth.accessExpiresIn', '15m') as unknown as number,
    });
  }

  private signRefreshToken(userId: string, jti: string, familyId: string): string {
    const payload: JwtRefreshPayload = { sub: userId, jti, familyId };
    return this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('auth.refreshSecret'),
      expiresIn: this.configService.get<string>('auth.refreshExpiresIn', '7d') as unknown as number,
    });
  }

  private async rotateTokens(userId: string, role: Role, familyId: string): Promise<IssuedTokens> {
    const jti = uuidv4();

    const pipeline = this.redis.pipeline();
    pipeline.set(rtKey(jti), `${userId}:${familyId}`, 'EX', REFRESH_TOKEN_TTL_S);
    pipeline.sadd(rtFamilyActiveKey(familyId), jti);
    pipeline.expire(rtFamilyActiveKey(familyId), REFRESH_TOKEN_TTL_S);
    await pipeline.exec();

    const accessToken = this.signAccessToken(userId, role, uuidv4());
    const refreshToken = this.signRefreshToken(userId, jti, familyId);

    return { accessToken, refreshToken, refreshJti: jti, familyId };
  }
}
