import type { Type } from '@nestjs/common';
import type { AppAbility } from '../casl-ability.factory.js';

/**
 * Object-style policy handler — useful when you want to encapsulate complex
 * permission logic in an injectable class that can have its own dependencies.
 *
 * @example
 * @Injectable()
 * class ReadNewsArticleHandler implements IPolicyHandler {
 *   handle(ability: AppAbility): boolean {
 *     return ability.can('read', 'NewsArticle');
 *   }
 * }
 */
export interface IPolicyHandler {
  handle(ability: AppAbility): boolean | Promise<boolean>;
}

/**
 * Inline callback-style policy handler — suitable for simple, one-off checks
 * directly on route decorators.
 *
 * @example
 * @CheckPolicies((ability) => ability.can('read', 'NewsArticle'))
 */
export type PolicyHandlerCallback = (ability: AppAbility) => boolean | Promise<boolean>;

/**
 * Class-token policy handler — resolved through Nest's container so the
 * handler can depend on other providers.
 */
export type PolicyHandlerType = Type<IPolicyHandler>;

/**
 * A policy handler can be an existing object instance, a callback, or a Nest
 * provider class token resolved by PoliciesGuard through ModuleRef.
 */
export type PolicyHandler = IPolicyHandler | PolicyHandlerCallback | PolicyHandlerType;
