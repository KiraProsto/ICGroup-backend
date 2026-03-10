import { INestApplication, RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor.js';

/**
 * Applies the shared middleware/pipe/routing configuration to a NestJS app
 * instance. Called by both main.ts (production bootstrap) and e2e test setup,
 * ensuring tests exercise the exact same routing and validation behaviour.
 */
export function configureApp(app: INestApplication): void {
  // /health is excluded so it resolves without the prefix — required by the
  // Docker HEALTHCHECK and any load-balancer liveness probe.
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // ── Validation ────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ── Unified response envelope { success, data, meta } ─────
  app.useGlobalInterceptors(new TransformResponseInterceptor());

  // ── Unified error envelope { success, error, meta } ───────
  // Registered after the interceptor so it runs first in the filter chain.
  app.useGlobalFilters(new AllExceptionsFilter());
}

// Provider tokens re-exported so feature modules can reference them if they
// ever need to override the global interceptor/filter for a specific route.
export { APP_FILTER, APP_INTERCEPTOR };
