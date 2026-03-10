import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/**
 * Injection token for the shared ioredis client.
 * Use `@Inject(REDIS_CLIENT)` to receive the Redis instance.
 */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Global Redis module — provides a single ioredis connection shared across
 * the entire application (throttler storage, health checks, BullMQ queues,
 * CASL ability cache, refresh-token allowlist).
 *
 * Marked @Global() so every feature module can inject REDIS_CLIENT without
 * explicitly importing RedisModule.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const client = new Redis({
          host: config.get<string>('redis.host', 'localhost'),
          port: config.get<number>('redis.port', 6379),
          password: config.get<string | undefined>('redis.password'),
          // Retry with exponential back-off; give up after 10 attempts so
          // the process doesn't hang indefinitely on a missing Redis.
          maxRetriesPerRequest: null, // required by BullMQ
          retryStrategy: (times: number) => (times > 10 ? null : Math.min(times * 200, 5_000)),
          lazyConnect: true,
        });

        client.on('error', (err: Error) => {
          // Errors are logged by the consumer (e.g. health indicator).
          // Attaching this listener prevents Node from treating them as
          // unhandled rejections that crash the process.
          void err; // intentionally swallowed here; health checks surface it
        });

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
