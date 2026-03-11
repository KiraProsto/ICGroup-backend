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
 * Lua script that atomically:
 *  1. Returns early if the tracker is already blocked.
 *  2. Increments the hit counter, setting TTL on the first hit.
 *  3. Blocks the tracker when the limit is exceeded.
 *
 * KEYS[1] = hit counter key
 * KEYS[2] = block flag key
 * ARGV[1] = TTL in seconds
 * ARGV[2] = rate limit
 * ARGV[3] = block duration in seconds (falls back to TTL when 0)
 *
 * Returns: [totalHits, timeToExpire, isBlocked (0|1), timeToBlockExpire]
 */
const THROTTLE_INCREMENT_SCRIPT = `
local fullKey  = KEYS[1]
local blockKey = KEYS[2]
local ttlS     = tonumber(ARGV[1])
local limit    = tonumber(ARGV[2])
local blockS   = tonumber(ARGV[3])

if redis.call('EXISTS', blockKey) == 1 then
  local bttl = math.max(0, redis.call('TTL', blockKey))
  local hits = tonumber(redis.call('GET', fullKey) or '0')
  return {hits, ttlS, 1, bttl}
end

local hits = redis.call('INCR', fullKey)
if hits == 1 then
  redis.call('EXPIRE', fullKey, ttlS)
end
local remaining = math.max(0, redis.call('TTL', fullKey))

if hits > limit then
  if blockS <= 0 then blockS = ttlS end
  redis.call('SETEX', blockKey, blockS, '1')
  return {hits, remaining, 1, blockS}
end

return {hits, remaining, 0, 0}
`;

/**
 * Distributed throttler storage backed by Redis.
 *
 * Replaces the default in-memory store so rate-limit counters are shared
 * across every application instance (horizontal scaling).
 *
 * All Redis operations for a single check are executed inside a Lua script,
 * guaranteeing atomicity (no INCR/EXPIRE race) and reducing the operation
 * to a single network round-trip.
 *
 * Key layout:
 *   throttler:<throttlerName>:<tracker>          → hit counter
 *   throttler:<throttlerName>:<tracker>:blocked  → block flag
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
    const blockSeconds = Math.ceil(blockDuration / 1000);

    const [totalHits, timeToExpire, blocked, timeToBlockExpire] = (await this.redis.eval(
      THROTTLE_INCREMENT_SCRIPT,
      2,
      fullKey,
      blockKey,
      ttlSeconds,
      limit,
      blockSeconds,
    )) as [number, number, number, number];

    return {
      totalHits,
      timeToExpire,
      isBlocked: blocked === 1,
      timeToBlockExpire,
    };
  }
}
