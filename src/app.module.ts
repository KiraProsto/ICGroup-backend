import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import Joi from 'joi';
import { Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
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
import { CaslModule } from './modules/casl/casl.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PagesModule } from './modules/pages/pages.module.js';
import { NewsModule } from './modules/news/news.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { PublicModule } from './modules/public/public.module.js';
import { AuditModule, AuditInterceptor } from './modules/audit/index.js';
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
        LOG_LEVEL: Joi.string()
          .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal')
          .optional(),
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
        // Optional: CDN / S3 base URL for serving uploaded objects.
        // Defaults to the MinIO endpoint URL when not set.
        MINIO_PUBLIC_URL: Joi.string().uri().optional(),
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

    // ── Structured logging (pino — JSON in prod, pretty in dev) ───
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('app.nodeEnv', 'development') === 'production';
        const level = config.get<string>('app.logLevel', isProd ? 'info' : 'debug');
        return {
          pinoHttp: {
            level,
            // Accept X-Request-Id from upstream gateways; generate a UUID otherwise.
            // Echo the resolved ID back as a response header so clients can correlate.
            genReqId: (req, res) => {
              const header = req.headers['x-request-id'];
              const reqId = typeof header === 'string' && header ? header : randomUUID();
              res.setHeader('X-Request-Id', reqId);
              return reqId;
            },
            // Strip auth tokens and cookies from request log entries.
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie'],
              censor: '[REDACTED]',
            },
            // Suppress auto-logging for health/liveness probes — they are
            // high-frequency and carry no diagnostic value in logs.
            autoLogging: {
              ignore: (req) => req.url === '/health',
            },
            // Human-readable output in development; raw JSON for Docker/prod.
            ...(isProd
              ? {}
              : {
                  transport: {
                    target: 'pino-pretty',
                    options: { singleLine: true, colorize: true },
                  },
                }),
          },
        };
      },
    }),

    // ── Redis (global — shared ioredis client) ─────────────
    RedisModule,

    // ── BullMQ (global — Redis-backed job queues) ──────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host', 'localhost'),
          port: config.get<number>('redis.port', 6379),
          password: config.get<string>('redis.password'),
          maxRetriesPerRequest: null,
        },
      }),
    }),

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

    // ── Auth (JWT + refresh token) ─────────────────────────
    AuthModule,

    // ── RBAC (CASL PoliciesGuard — runs after JwtAuthGuard) ─
    CaslModule,

    // ── User management (SUPER_ADMIN only) ────────────────
    UsersModule,

    // ── Content management ─────────────────────────────
    PagesModule,
    NewsModule,
    MediaModule,

    // Public portal API (unauthenticated, PUBLISHED content only)
    PublicModule,

    // ── Audit logging (BullMQ queue + processor) ───────────
    AuditModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // ThrottlerGuard and JwtAuthGuard are registered as APP_GUARD inside
    // AuthModule (in that order) so rate-limiting executes before auth.

    // AuditInterceptor runs on all HTTP mutation routes that carry @Audit().
    // Uses useExisting to reuse the singleton from AuditModule.providers
    // rather than creating a duplicate instance with useClass.
    {
      provide: APP_INTERCEPTOR,
      useExisting: AuditInterceptor,
    },
  ],
})
export class AppModule {}
