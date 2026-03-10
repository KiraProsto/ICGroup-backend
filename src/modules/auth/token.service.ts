import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { REDIS_CLIENT } from '../../redis/redis.module.js';
import type { Role } from '../../generated/prisma/enums.js';
import type { JwtAccessPayload, JwtRefreshPayload } from './interfaces/jwt-payload.interface.js';

/**
 * Parses a JWT duration string (e.g. "7d", "24h", "60m", "3600s") to seconds.
 * Keeps Redis TTLs in sync with the configured JWT expiry.
 */
function parseDurationToSeconds(duration: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration);
  if (!match) throw new Error(`Unsupported duration format: "${duration}"`);
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86400;
    default:
      throw new Error(`Unsupported duration unit: "${match[2]}"`);
  }
}

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

  /** Redis TTL for refresh tokens, derived from the configured refreshExpiresIn value. */
  private get refreshTtlSeconds(): number {
    return parseDurationToSeconds(this.configService.get<string>('auth.refreshExpiresIn', '7d'));
  }

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
   * Rotates within an existing family: atomically consumes the old allowlist
   * entry via GETDEL, verifies ownership, then writes the new state.
   *
   * Using GETDEL ensures only ONE concurrent caller can proceed — any second
   * concurrent request with the same oldJti will receive null and be rejected,
   * eliminating the rotation race condition inherent in separate GET + DEL.
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
    // GETDEL atomically reads and deletes the allowlist entry.
    // Only ONE concurrent caller can receive a non-null result for the same jti.
    const allowlistEntry = await this.redis.getdel(rtKey(oldJti));

    if (!allowlistEntry) {
      // Token not (or no longer) in allowlist — race was lost, or a genuine replay.
      // Check the consumed marker to detect reuse attacks.
      const consumedMark = await this.redis.get(rtFamilyKey(familyId, oldJti));
      if (consumedMark) {
        this.logger.warn(
          `Refresh token reuse detected for user=${userId}, family=${familyId}, jti=${oldJti}. Revoking entire family.`,
        );
        await this.revokeFamily(familyId);
      }
      throw new UnauthorizedException('Refresh token is invalid or has been revoked');
    }

    // Verify the entry matches the claimed user/family (prevents cross-user forgery).
    const [storedUserId, storedFamilyId] = allowlistEntry.split(':');
    if (storedUserId !== userId || storedFamilyId !== familyId) {
      this.logger.warn(`Refresh token allowlist mismatch for jti=${oldJti}. Possible tampering.`);
      throw new UnauthorizedException('Refresh token is invalid or has been revoked');
    }

    const newJti = uuidv4();

    const pipeline = this.redis.pipeline();
    pipeline.set(rtFamilyKey(familyId, oldJti), '1', 'EX', this.refreshTtlSeconds);
    pipeline.set(rtKey(newJti), `${userId}:${familyId}`, 'EX', this.refreshTtlSeconds);
    pipeline.sadd(rtFamilyActiveKey(familyId), newJti);
    pipeline.srem(rtFamilyActiveKey(familyId), oldJti);
    pipeline.expire(rtFamilyActiveKey(familyId), this.refreshTtlSeconds);
    this.assertPipelineResults(await pipeline.exec(), 'rotateRefreshToken');

    const accessToken = this.signAccessToken(userId, role, uuidv4());
    const refreshToken = this.signRefreshToken(userId, newJti, familyId);

    return { accessToken, refreshToken, refreshJti: newJti, familyId };
  }

  // ─── Validate ────────────────────────────────────────────────────────────

  /**
   * Verifies the refresh token's JWT signature and expiry.
   * Returns the decoded payload for use in rotation/logout.
   *
   * The Redis allowlist check and reuse detection are performed atomically
   * inside rotateRefreshToken via GETDEL, eliminating the rotation race
   * that would exist with a separate GET here followed by writes there.
   *
   * Throws `UnauthorizedException` if the JWT is invalid or expired.
   */
  async validateRefreshToken(token: string): Promise<JwtRefreshPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtRefreshPayload>(token, {
        secret: this.configService.getOrThrow<string>('auth.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
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
    this.assertPipelineResults(await pipeline.exec(), 'revokeRefreshToken');
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
      this.assertPipelineResults(await pipeline.exec(), 'revokeFamily');
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
    pipeline.set(rtKey(jti), `${userId}:${familyId}`, 'EX', this.refreshTtlSeconds);
    pipeline.sadd(rtFamilyActiveKey(familyId), jti);
    pipeline.expire(rtFamilyActiveKey(familyId), this.refreshTtlSeconds);
    this.assertPipelineResults(await pipeline.exec(), 'rotateTokens');

    const accessToken = this.signAccessToken(userId, role, uuidv4());
    const refreshToken = this.signRefreshToken(userId, jti, familyId);

    return { accessToken, refreshToken, refreshJti: jti, familyId };
  }

  private assertPipelineResults(
    results: Array<[Error | null, unknown]> | null,
    context: string,
  ): void {
    if (!results) {
      throw new Error(`Redis pipeline returned null in ${context}`);
    }
    for (const [err] of results) {
      if (err) {
        this.logger.error(`Redis pipeline command failed in ${context}: ${err.message}`);
        throw new Error(`Redis pipeline failed in ${context}: ${err.message}`);
      }
    }
  }
}
