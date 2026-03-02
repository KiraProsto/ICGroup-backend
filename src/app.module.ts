import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import Joi from 'joi';
import appConfig from './config/app.config.js';
import databaseConfig from './config/database.config.js';
import redisConfig from './config/redis.config.js';
import authConfig from './config/auth.config.js';
import storageConfig from './config/storage.config.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';

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
        REDIS_PASSWORD: Joi.string().optional(),
        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
        JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
        MINIO_ENDPOINT: Joi.string().default('localhost'),
        MINIO_PORT: Joi.number().default(9000),
        MINIO_USE_SSL: Joi.boolean().default(false),
        MINIO_ACCESS_KEY: Joi.string().required(),
        MINIO_SECRET_KEY: Joi.string().required(),
        MINIO_BUCKET_CONTENT: Joi.string().default('content-images'),
        DB_POOL_MAX: Joi.number().min(1).max(100).default(10),
        DB_POOL_CONNECT_TIMEOUT_MS: Joi.number().default(3000),
        DB_POOL_IDLE_TIMEOUT_MS: Joi.number().default(10000),
        THROTTLE_TTL: Joi.number().default(60),
        THROTTLE_LIMIT: Joi.number().default(120),
        THROTTLE_LOGIN_TTL: Joi.number().default(60),
        THROTTLE_LOGIN_LIMIT: Joi.number().default(5),
      }),
      validationOptions: {
        abortEarly: false, // report all validation errors at once
      },
    }),

    // ── Rate limiting (global) ─────────────────────────────
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
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
    }),

    // ── Database (global — available to all feature modules) ───────
    PrismaModule,

    // Feature modules will be added here in subsequent tasks:
    // AuthModule, UsersModule, ContentModule, SalesModule,
    // AuditModule, PublicApiModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
