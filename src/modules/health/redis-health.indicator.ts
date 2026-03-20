import { Inject, Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module.js';

/** Maximum milliseconds to wait for the Redis ping before reporting down. */
const PING_TIMEOUT_MS = 5_000;

/**
 * Verifies the Redis connection is alive by issuing a PING command.
 */
@Injectable()
export class RedisHealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async pingCheck(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const pong = await this.withTimeout(this.redis.ping());
      if (pong !== 'PONG') {
        return indicator.down({ message: 'Unexpected PING response' });
      }
      return indicator.up();
    } catch (error) {
      this.logger.warn(`Redis health check failed: ${(error as Error).message}`);
      return indicator.down({ message: 'Redis unreachable' });
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Redis ping timeout')), PING_TIMEOUT_MS);
      timeoutId.unref?.();
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
    }) as Promise<T>;
  }
}
