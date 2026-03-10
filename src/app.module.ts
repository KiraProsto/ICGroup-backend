import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import Joi from 'joi';
import { Redis } from 'ioredis';
import appConfig from './config/app.config.js';
import databaseConfig from './config/database.config.js';
import redisConfig from './config/redis.config.js';
import authConfig from './config/auth.config.js';
import storageConfig from './config/storage.config.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule, REDIS_CLIENT } from './redis/redis.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { RedisThrottlerStorage } from './common/throttler-storage.js';

@Module({
  imports: [
    // ── Config (validates env vars at startup) ─────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig, authConfig, storageConfig],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().default(3000),
        CORS_ORIGINS: Joi.string().default('http://localhost:5173'),
        DATABASE_URL: Joi.string().required(),
        REDIS_HOST: Joi.string().default('localhost'),
        REDIS_PORT: Joi.number().default(6379),
        // Required in production to prevent running with no auth on Redis.
        REDIS_PASSWORD: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string().min(16).required(),
          otherwise: Joi.string().optional(),
        }),
        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
        JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
        MINIO_ENDPOINT: Joi.string().default('localhost'),
        MINIO_PORT: Joi.number().default(9000),
        MINIO_USE_SSL: Joi.boolean().default(false),
        MINIO_ACCESS_KEY: Joi.string().min(8).required(),
        // Enforce a strong secret in production; allow shorter values in dev/test
        // so the docker-compose defaults still work during local development.
        MINIO_SECRET_KEY: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string().min(16).required(),
          otherwise: Joi.string().min(1).required(),
        }),
        MINIO_BUCKET_CONTENT: Joi.string().default('content-images'),
        DB_POOL_MAX: Joi.number().integer().min(1).max(100).default(10),
        DB_POOL_CONNECT_TIMEOUT_MS: Joi.number().integer().default(3000),
        DB_POOL_IDLE_TIMEOUT_MS: Joi.number().integer().default(10000),
        DB_STATEMENT_TIMEOUT_MS: Joi.number().integer().min(0).default(30000),
        THROTTLE_TTL: Joi.number().default(60),
        THROTTLE_LIMIT: Joi.number().default(120),
        THROTTLE_LOGIN_TTL: Joi.number().default(60),
        THROTTLE_LOGIN_LIMIT: Joi.number().default(5),
      }),
      validationOptions: {
        abortEarly: false, // report all validation errors at once
      },
    }),

    // ── Redis (global — shared ioredis client) ─────────────
    RedisModule,

    // ── Rate limiting (Redis-backed — shared across all instances) ──
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS_CLIENT, ConfigService],
      useFactory: (redis: Redis, config: ConfigService) => ({
        throttlers: [
          {
            name: 'global',
            ttl: config.get<number>('THROTTLE_TTL', 60) * 1000,
            limit: config.get<number>('THROTTLE_LIMIT', 120),
          },
          {
            name: 'login',
            ttl: config.get<number>('THROTTLE_LOGIN_TTL', 60) * 1000,
            limit: config.get<number>('THROTTLE_LOGIN_LIMIT', 5),
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),

    // ── Database (global — available to all feature modules) ───────
    PrismaModule,

    // ── Health checks ──────────────────────────────────────
    HealthModule,

    // ── Auth (JWT + refresh token + RBAC guard) ────────────
    AuthModule,

    // Feature modules will be added here in subsequent tasks:
    // AuthModule, UsersModule, ContentModule, SalesModule,
    // AuditModule, PublicApiModule
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply rate limiting globally to every route in the application.
    // Per-endpoint overrides use @Throttle({ login: { ... } }) on the handler.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
