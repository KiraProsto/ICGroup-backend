import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { CaslModule } from '../casl/casl.module.js';
import { AuditModule } from '../audit/audit.module.js';

/**
 * UsersModule exposes admin CRUD endpoints for user management.
 *
 * Imports CaslModule to receive CaslAbilityFactory, which is needed to
 * invalidate the cached CASL ability after role, isActive, or deletedAt changes.
 *
 * Imports AuditModule for async/sync audit logging via BullMQ.
 *
 * Route authorization is enforced at the guard level:
 *   - JwtAuthGuard  (global, via AuthModule)
 *   - PoliciesGuard (global, via CaslModule) + @CheckPolicies on the controller
 */
@Module({
  imports: [CaslModule, AuditModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
