import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Redis } from 'ioredis';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../../redis/redis.module.js';
import type { JwtAccessPayload } from '../interfaces/jwt-payload.interface.js';

/** Cache key prefix for user session data — exported for invalidation by other modules. */
export const USER_SESSION_CACHE_PREFIX = 'user-session:';

/** TTL in seconds — short to limit stale-role window while reducing DB load. */
const USER_SESSION_CACHE_TTL = 30;

interface CachedUserSession {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  deletedAt: string | null;
}

/**
 * Validates the Bearer access token on every protected route.
 *
 * Uses a short-lived Redis cache (30 s) to avoid a DB round-trip on every
 * request. The cache is invalidated immediately on any role, isActive, or
 * deletedAt mutation (via UsersService) so permission changes take effect
 * within one request cycle.
 *
 * The returned value is attached to `request.user`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('auth.accessSecret'),
    });
  }

  async validate(payload: JwtAccessPayload) {
    const cacheKey = `${USER_SESSION_CACHE_PREFIX}${payload.sub}`;

    // Fast path: return cached user session
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        const session: CachedUserSession = JSON.parse(cached);
        if (!session.isActive || session.deletedAt !== null) {
          throw new UnauthorizedException('User account is inactive or deleted');
        }
        return { id: session.id, email: session.email, role: session.role };
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err;
        // Corrupt cache entry — fall through to DB
        await this.redis.del(cacheKey).catch(() => {});
      }
    }

    // Cache miss — query DB
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true, deletedAt: true },
    });

    if (!user || !user.isActive || user.deletedAt !== null) {
      throw new UnauthorizedException('User account is inactive or deleted');
    }

    // Cache for subsequent requests — non-blocking, non-fatal
    const session: CachedUserSession = {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      deletedAt: null, // Only caching active, non-deleted users
    };
    await this.redis
      .set(cacheKey, JSON.stringify(session), 'EX', USER_SESSION_CACHE_TTL)
      .catch(() => {});

    // Returned object is set as request.user; include role for CASL policies.
    return { id: user.id, email: user.email, role: user.role };
  }
}
