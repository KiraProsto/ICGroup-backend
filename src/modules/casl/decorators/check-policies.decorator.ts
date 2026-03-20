import { SetMetadata } from '@nestjs/common';
import type { PolicyHandler } from '../interfaces/policy-handler.interface.js';

/**
 * Metadata key used to store policy handlers on route handlers/controllers.
 * Used by PoliciesGuard to retrieve and evaluate the handlers.
 */
export const CHECK_POLICIES_KEY = 'check_policies';

/**
 * Attaches one or more policy handlers to a route or controller.
 * The PoliciesGuard evaluates each handler against the current user's AppAbility.
 * All handlers must return true for the request to be allowed.
 *
 * @example — callback form
 * @CheckPolicies((ability) => ability.can('read', 'NewsArticle'))
 * @Get()
 * findAll() {}
 *
 * @example — class form
 * @CheckPolicies(ReadNewsArticleHandler)
 * @Get(':id')
 * findOne() {}
 *
 * @example — multiple policies (all must pass)
 * @CheckPolicies(
 *   (a) => a.can('read', 'NewsArticle'),
 *   (a) => a.can('read', 'AuditLog'),
 * )
 * @Get('with-audit')
 * findWithAudit() {}
 */
export const CheckPolicies = (...handlers: PolicyHandler[]) =>
  SetMetadata(CHECK_POLICIES_KEY, handlers);
