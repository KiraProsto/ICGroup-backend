import { Inject, Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module.js';
import { withTimeout } from '../../common/utils/with-timeout.js';

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
      const pong = await withTimeout(this.redis.ping(), PING_TIMEOUT_MS, 'Redis ping timeout');
      if (pong !== 'PONG') {
        return indicator.down({ message: 'Unexpected PING response' });
      }
      return indicator.up();
    } catch (error) {
      this.logger.warn(`Redis health check failed: ${(error as Error).message}`);
      return indicator.down({ message: 'Redis unreachable' });
    }
  }
}
