import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../../../generated/prisma/enums.js';
import {
  ACTOR_IP_MAX_LENGTH,
  ACTOR_USER_AGENT_MAX_LENGTH,
} from '../../../common/constants/audit.constants.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  /** Source IP — populated by @CurrentUser(), undefined in non-HTTP contexts. */
  ip?: string;
  /** User-Agent header — populated by @CurrentUser(), undefined in non-HTTP contexts. */
  userAgent?: string;
}

/**
 * Extracts the authenticated user from the request object.
 * Must be used on routes protected by JwtAuthGuard (or via @Public() excluded).
 *
 * Attaches the client IP and User-Agent so services can forward them
 * to audit logging without taking a direct dependency on the Request object.
 *
 * @example
 * @Get('profile')
 * getProfile(@CurrentUser() user: AuthenticatedUser) {}
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const user = request.user;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      ip: request.ip?.slice(0, ACTOR_IP_MAX_LENGTH) ?? undefined,
      userAgent: request.get('user-agent')?.slice(0, ACTOR_USER_AGENT_MAX_LENGTH) ?? undefined,
    };
  },
);
