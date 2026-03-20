import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Replace NestJS default logger with pino — flushes buffered bootstrap logs
  // through pino so all output is JSON from the very first line in production.
  app.useLogger(app.get(PinoLogger));
  app.flushLogs();

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);
  const corsOrigins = config
    .get<string>('app.corsOrigins', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const nodeEnv = config.get<string>('app.nodeEnv', 'development');
  const isProdLike = nodeEnv === 'production' || nodeEnv === 'staging';

  // ── Security ──────────────────────────────────────────────
  // Trust exactly one proxy hop — required for req.ip to reflect the real
  // client IP when running behind nginx, an ALB, or any reverse proxy.
  // Disabled by default; enable via TRUST_PROXY=true when behind a reverse proxy.
  if (config.get<boolean>('app.trustProxy', false)) {
    app.set('trust proxy', 1);
  }
  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Global prefix, versioning, validation ────────────────
  configureApp(app);

  // ── Swagger (disabled in production) ──────────────────────
  if (!isProdLike) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ICGroup API')
      .setDescription('ICGroup Admin Panel & Public Portal API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addTag('meta', 'API info')
      .addTag('auth', 'Authentication & token management')
      .addTag('users', 'User management (Super Admin)')
      .addTag('admin/users', 'User CRUD — SUPER_ADMIN only')
      .addTag('content', 'Content management (Content Manager)')
      .addTag('sales', 'Sales data (Sales Manager)')
      .addTag('public', 'Public portal endpoints (no auth)')
      .addTag('audit', 'Audit log viewer (Super Admin)')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  // ── Graceful shutdown ─────────────────────────────────────
  // NestJS shutdown hooks handle SIGTERM/SIGINT → app.close() which triggers
  // OnModuleDestroy on every module (Prisma disconnect, Redis quit, BullMQ
  // worker close). A safety timeout forces process exit if hooks get stuck.
  app.enableShutdownHooks();

  const shutdownTimeoutMs = config.get<number>('app.shutdownTimeoutMs', 10_000);
  const logger = new Logger('Bootstrap');

  const registerShutdownTimeout = (signal: string) => {
    process.once(signal, () => {
      logger.warn(
        `${signal} received — waiting up to ${shutdownTimeoutMs}ms for graceful shutdown`,
      );
      setTimeout(() => {
        logger.error('Graceful shutdown timed out — forcing process exit');
        process.exit(1);
      }, shutdownTimeoutMs).unref();
    });
  };

  registerShutdownTimeout('SIGTERM');
  registerShutdownTimeout('SIGINT');

  await app.listen(port);

  logger.log(`[${nodeEnv}] Application running on: http://localhost:${port}/api/v1`);
  if (!isProdLike) {
    logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
  }
}

bootstrap().catch((err: unknown) => {
  // Use console.error intentionally — the pino logger may not be initialised
  // yet when bootstrap fails (e.g. DB connection refused, bad env vars).
  console.error('Fatal error during bootstrap', err);
  process.exit(1);
});
