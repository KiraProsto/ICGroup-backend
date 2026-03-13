import { Inject, Injectable } from '@nestjs/common';
import { AbilityBuilder, createMongoAbility, MongoAbility, RawRuleOf } from '@casl/ability';
import { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../redis/redis.module.js';
import { Role } from '../../generated/prisma/enums.js';

/**
 * The set of actions that can be performed in the system.
 * 'manage' is a CASL wildcard meaning "any action".
 */
export type AppAction = 'manage' | 'create' | 'read' | 'update' | 'delete' | 'publish' | 'archive';

/**
 * The set of subjects (resource types) in the system.
 * 'all' is a CASL wildcard meaning "any subject".
 */
export type AppSubjects =
  | 'User'
  | 'NewsArticle'
  | 'Page'
  | 'PageSection'
  | 'Rubric'
  | 'Company'
  | 'Purchase'
  | 'AuditLog'
  | 'MediaAsset'
  | 'all';

/** Application-wide CASL ability type. */
export type AppAbility = MongoAbility<[AppAction, AppSubjects]>;

export interface AbilityUserContext {
  id: string;
  role: Role;
  isActive?: boolean;
  deletedAt?: Date | null;
}

/** Redis key TTL in seconds (5 minutes). */
const ABILITY_CACHE_TTL_SECONDS = 300;

/**
 * Builds and caches CASL Abilities per user role.
 *
 * Cache strategy:
 *   - Key:   casl:ability:<userId>:<role>
 *   - Value: JSON-serialised RawRuleOf[] from ability.rules
 *   - TTL:   300 s (5 min)
 *   - HTTP request path: build from JwtStrategy's fresh DB-backed user snapshot,
 *     so role changes take effect on the very next request.
 *   - Non-HTTP path: string overload re-fetches the user from DB before building.
 *   - Invalidation: call invalidateCache(userId) after any role, isActive, or
 *     deletedAt mutation to evict older role-specific entries early.
 *
 * Role permission matrix:
 *   SUPER_ADMIN    — manage all
 *   CONTENT_MANAGER — manage NewsArticle | Page | PageSection | Rubric;
 *                     read  User | Company | AuditLog
 *   SALES_MANAGER  — manage Company | Purchase;
 *                     read  NewsArticle | Page | Rubric | User
 */
@Injectable()
export class CaslAbilityFactory {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async createForUser(userId: string): Promise<AppAbility>;
  async createForUser(user: AbilityUserContext): Promise<AppAbility>;

  /**
   * Returns a fully-built AppAbility for the given user context.
   *
   * Prefer passing the authenticated request user so the ability is derived
   * from JwtStrategy's fresh DB-backed role instead of a stale cache entry.
   * The string overload exists for non-request code paths that only have a userId.
   */
  async createForUser(userOrId: string | AbilityUserContext): Promise<AppAbility> {
    const user = typeof userOrId === 'string' ? await this.loadUserContext(userOrId) : userOrId;

    if (
      !user ||
      user.isActive === false ||
      (user.deletedAt !== undefined && user.deletedAt !== null)
    ) {
      return createMongoAbility<AppAbility>([]);
    }

    const cacheKey = this.getCacheKey(user.id, user.role);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        // Re-hydrate from serialised rules — safe because we control what we cached.
        const rules = JSON.parse(cached) as RawRuleOf<AppAbility>[];
        return createMongoAbility<AppAbility>(rules);
      } catch {
        await this.redis.del(cacheKey).catch(() => {
          // Corrupt cache entry is non-critical; rebuild below.
        });
      }
    }

    const ability = this.buildAbility(user.role);

    // Cache serialised rules; ignore Redis errors non-fatally —
    // a cache miss on the next request simply re-fetches from DB.
    await this.redis
      .set(cacheKey, JSON.stringify(ability.rules), 'EX', ABILITY_CACHE_TTL_SECONDS)
      .catch(() => {
        // Redis write failure is non-critical: ability was already built.
      });

    return ability;
  }

  /**
   * Removes the cached ability for the given user.
   * Must be called after changing a user's role, isActive, or deletedAt flag.
   */
  async invalidateCache(userId: string): Promise<void> {
    await this.redis.del(...Object.values(Role).map((role) => this.getCacheKey(userId, role)));
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private getCacheKey(userId: string, role: Role): string {
    return `casl:ability:${userId}:${role}`;
  }

  private async loadUserContext(userId: string): Promise<AbilityUserContext | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true, deletedAt: true },
    });
  }

  private buildAbility(role: Role): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    switch (role) {
      case Role.SUPER_ADMIN:
        // Full unrestricted access to every resource and action.
        can('manage', 'all');
        break;

      case Role.CONTENT_MANAGER:
        // Full lifecycle control over content resources.
        can('manage', 'NewsArticle');
        can('manage', 'Page');
        can('manage', 'PageSection');
        can('manage', 'Rubric');
        // Media uploads for content.
        can('create', 'MediaAsset');
        // Read-only access to supporting resources.
        can('read', 'User');
        can('read', 'Company');
        can('read', 'AuditLog');
        break;

      case Role.SALES_MANAGER:
        // Full control over sales-related resources.
        can('manage', 'Company');
        can('manage', 'Purchase');
        // Read content and user list (to associate with purchases).
        can('read', 'NewsArticle');
        can('read', 'Page');
        can('read', 'Rubric');
        can('read', 'User');
        break;

      default:
        // Unknown role → no permissions (fail-safe).
        break;
    }

    return build();
  }
}
