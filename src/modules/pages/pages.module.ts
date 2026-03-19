import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PublicModule } from '../public/public.module.js';
import { PagesController } from './pages.controller.js';
import { PagesService } from './pages.service.js';

/**
 * PagesModule manages dynamic pages and their sections.
 *
 * Auth:   JwtAuthGuard (global, from AuthModule)
 * RBAC:   PoliciesGuard (global, from CaslModule) + @CheckPolicies per route
 * Audit:  AuditModule (operational async log via BullMQ)
 * Prisma: PrismaModule (global — no explicit import needed)
 */
@Module({
  imports: [AuditModule, PublicModule],
  controllers: [PagesController],
  providers: [PagesService],
})
export class PagesModule {}
