import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);
  const corsOrigins = config
    .get<string>('app.corsOrigins', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const nodeEnv = config.get<string>('app.nodeEnv', 'development');
  const isProd = nodeEnv === 'production';

  // ── Security ──────────────────────────────────────────────
  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Global prefix, versioning, validation ────────────────
  configureApp(app);

  // ── Swagger (disabled in production) ──────────────────────
  if (!isProd) {
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
  app.enableShutdownHooks();

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Application running on: http://localhost:${port}/api/v1`);
  if (!isProd) {
    logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
  }
}

bootstrap();
