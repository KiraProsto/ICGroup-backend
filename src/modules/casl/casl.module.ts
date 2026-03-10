import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CaslAbilityFactory } from './casl-ability.factory.js';
import { PoliciesGuard } from './guards/policies.guard.js';

/**
 * CaslModule wires RBAC infrastructure:
 *   - CaslAbilityFactory — builds and caches per-user AppAbility instances.
 *   - PoliciesGuard      — registered as a global APP_GUARD so it runs on
 *                          every route after JwtAuthGuard.
 *
 * Import CaslModule in AppModule AFTER AuthModule so the guard execution
 * order is: ThrottlerGuard → JwtAuthGuard → PoliciesGuard.
 *
 * CaslAbilityFactory is exported so other modules can call
 * invalidateCache(userId) whenever a user's role or active state changes.
 */
@Module({
  providers: [
    CaslAbilityFactory,
    {
      provide: APP_GUARD,
      useClass: PoliciesGuard,
    },
  ],
  exports: [CaslAbilityFactory],
})
export class CaslModule {}
