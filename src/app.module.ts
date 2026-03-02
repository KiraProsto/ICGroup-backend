import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import Joi from 'joi';
import appConfig from './config/app.config.js';
import databaseConfig from './config/database.config.js';
import redisConfig from './config/redis.config.js';
import authConfig from './config/auth.config.js';
import storageConfig from './config/storage.config.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    // ── Config (validates env vars at startup) ─────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig, authConfig, storageConfig],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().default(3000),
        DATABASE_URL: Joi.string().required(),
        REDIS_HOST: Joi.string().default('localhost'),
        REDIS_PORT: Joi.number().default(6379),
        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
        JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
        MINIO_ENDPOINT: Joi.string().default('localhost'),
        MINIO_PORT: Joi.number().default(9000),
        MINIO_ACCESS_KEY: Joi.string().required(),
        MINIO_SECRET_KEY: Joi.string().required(),
        MINIO_BUCKET_CONTENT: Joi.string().default('content-images'),
      }),
      validationOptions: {
        abortEarly: false, // report all validation errors at once
      },
    }),

    // ── Rate limiting (global) ─────────────────────────────
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          name: 'global',
          ttl: parseInt(process.env['THROTTLE_TTL'] ?? '60') * 1000,
          limit: parseInt(process.env['THROTTLE_LIMIT'] ?? '120'),
        },
      ],
    }),

    // Feature modules will be added here in subsequent tasks:
    // AuthModule, UsersModule, ContentModule, SalesModule,
    // AuditModule, PublicApiModule, PrismaModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
