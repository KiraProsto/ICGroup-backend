import { Module } from '@nestjs/common';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';

/**
 * PublicModule exposes unauthenticated read endpoints for the public portal.
 *
 *   GET /public/pages/:type    → published page by slug
 *   GET /public/news           → paginated list of published articles
 *   GET /public/news/:slug     → published article detail (with pre-rendered HTML)
 *
 * Caching: Redis TTL 5 min (via PublicService).
 * Invalidation: PagesService and NewsService call PublicService after successful publish.
 *
 * Auth:   none — all routes carry @Public()
 * Prisma: PrismaModule (global — no explicit import needed)
 * Redis:  RedisModule (global — REDIS_CLIENT token available everywhere)
 */
@Module({
  controllers: [PublicController],
  providers: [PublicService],
  exports: [PublicService],
})
export class PublicModule {}
