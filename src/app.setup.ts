import { INestApplication, RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';

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
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
