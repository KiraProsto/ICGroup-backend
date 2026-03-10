import { Inject, Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

/** Shape returned by ThrottlerStorage.increment (matches ThrottlerStorageRecord). */
type ThrottlerStorageRecord = {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
};

/**
 * Distributed throttler storage backed by Redis.
 *
 * Replaces the default in-memory store so rate-limit counters are shared
 * across every application instance (horizontal scaling).
 *
 * Key layout:
 *   throttler:<throttlerName>:<tracker>          → hit counter (INCR)
 *   throttler:<throttlerName>:<tracker>:blocked  → block flag  (SETEX)
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const fullKey = `throttler:${throttlerName}:${key}`;
    const blockKey = `${fullKey}:blocked`;
    const ttlSeconds = Math.ceil(ttl / 1000);

    // If the key is already blocked return immediately without an extra INCR.
    const isBlocked = await this.redis.exists(blockKey);
    if (isBlocked) {
      const timeToBlockExpire = Math.max(0, await this.redis.ttl(blockKey));
      const totalHits = parseInt((await this.redis.get(fullKey)) ?? '0', 10);
      return { totalHits, timeToExpire: ttlSeconds, isBlocked: true, timeToBlockExpire };
    }

    // Increment the hit counter, setting TTL on first hit.
    const totalHits = await this.redis.incr(fullKey);
    if (totalHits === 1) {
      await this.redis.expire(fullKey, ttlSeconds);
    }
    const timeToExpire = Math.max(0, await this.redis.ttl(fullKey));

    // Block the key if the limit is exceeded.
    if (totalHits > limit) {
      const blockSeconds = Math.ceil(blockDuration / 1000) || ttlSeconds;
      await this.redis.setex(blockKey, blockSeconds, '1');
      return { totalHits, timeToExpire, isBlocked: true, timeToBlockExpire: blockSeconds };
    }

    return { totalHits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
  }
}
