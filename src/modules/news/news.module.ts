import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PublicModule } from '../public/public.module.js';
import { NewsController } from './news.controller.js';
import { NewsService } from './news.service.js';

/**
 * NewsModule manages news articles and their content cards.
 *
 * Auth:   JwtAuthGuard (global, from AuthModule)
 * RBAC:   PoliciesGuard (global, from CaslModule) + @CheckPolicies per route
 * Audit:  AuditModule (async BullMQ-backed operational audit log)
 * Prisma: PrismaModule (global — no explicit import needed)
 */
@Module({
  imports: [AuditModule, PublicModule],
  controllers: [NewsController],
  providers: [NewsService],
})
export class NewsModule {}
