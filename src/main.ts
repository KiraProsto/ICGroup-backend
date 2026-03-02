import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);
  const corsOrigins = config.get<string>('app.corsOrigins', '').split(',');
  const nodeEnv = config.get<string>('app.nodeEnv', 'development');
  const isProd = nodeEnv === 'production';

  // ── Security ──────────────────────────────────────────────
  app.use(helmet());

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Global prefix & versioning ────────────────────────────
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // ── Validation ────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // throw on unknown properties
      transform: true, // auto-transform to DTO types
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ── Swagger (disabled in production) ──────────────────────
  if (!isProd) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ICGroup API')
      .setDescription('ICGroup Admin Panel & Public Portal API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addTag('auth', 'Authentication & token management')
      .addTag('users', 'User management (Super Admin)')
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

  console.log(`🚀 Application running on: http://localhost:${port}/api/v1`);
  if (!isProd) {
    console.log(`📖 Swagger docs: http://localhost:${port}/api/docs`);
  }
}

bootstrap();
