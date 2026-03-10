import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ContextIdFactory, ModuleRef, Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CaslAbilityFactory, type AppAbility } from '../casl-ability.factory.js';
import { CHECK_POLICIES_KEY } from '../decorators/check-policies.decorator.js';
import type {
  IPolicyHandler,
  PolicyHandler,
  PolicyHandlerCallback,
  PolicyHandlerType,
} from '../interfaces/policy-handler.interface.js';
import type { AuthenticatedUser } from '../../auth/decorators/current-user.decorator.js';

/**
 * Global RBAC guard — evaluates @CheckPolicies() handlers against the current
 * user's CASL AppAbility.
 *
 * Execution order:
 *   ThrottlerGuard → JwtAuthGuard → PoliciesGuard
 *
 * Behaviour:
 *   - Routes without @CheckPolicies() pass through (JWT guard already enforces auth).
 *   - Routes with @CheckPolicies() must have ALL handlers return true.
 *   - Throws 403 Forbidden (not 401) on policy failure to distinguish RBAC
 *     failures from authentication failures.
 *
 * Registered as APP_GUARD in CaslModule so it applies to every route.
 */
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly caslAbilityFactory: CaslAbilityFactory,
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handlers = this.reflector.getAllAndOverride<PolicyHandler[] | undefined>(
      CHECK_POLICIES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No policy constraints on this route — let it through. Authentication
    // has already been confirmed by JwtAuthGuard running earlier.
    if (!handlers || handlers.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();

    const user = request.user;

    // A route with @CheckPolicies() on a @Public() route is a misconfiguration.
    // Deny access — there is no authenticated user to evaluate policies against.
    if (!user) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const ability = await this.caslAbilityFactory.createForUser(user);

    const allPass = await this.evalHandlers(handlers, ability, request);

    if (!allPass) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }

  private async evalHandlers(
    handlers: PolicyHandler[],
    ability: AppAbility,
    request: Request,
  ): Promise<boolean> {
    for (const handler of handlers) {
      if (!(await this.execHandler(handler, ability, request))) {
        return false;
      }
    }

    return true;
  }

  private async execHandler(
    handler: PolicyHandler,
    ability: AppAbility,
    request: Request,
  ): Promise<boolean> {
    if (typeof handler === 'function') {
      if (this.isPolicyHandlerType(handler)) {
        const contextId = ContextIdFactory.getByRequest(request);
        try {
          const instance = this.moduleRef.get<IPolicyHandler>(handler as PolicyHandlerType, {
            strict: false,
          });
          return instance.handle(ability);
        } catch {
          const resolved = await this.moduleRef.resolve<IPolicyHandler>(
            handler as PolicyHandlerType,
            contextId,
          );
          return resolved.handle(ability);
        }
      }

      return (handler as PolicyHandlerCallback)(ability);
    }
    return (handler as IPolicyHandler).handle(ability);
  }

  private isPolicyHandlerType(handler: PolicyHandler): handler is PolicyHandlerType {
    return typeof handler === 'function' && 'prototype' in handler && 'handle' in handler.prototype;
  }
}
