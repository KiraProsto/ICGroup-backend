import { ForbiddenException } from '@nestjs/common';
import { Reflector, ModuleRef } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { Role } from '../../../generated/prisma/enums.js';
import type { AuthenticatedUser } from '../../auth/decorators/current-user.decorator.js';
import type { AppAbility, IPolicyHandler } from '../index.js';
import { CaslAbilityFactory } from '../casl-ability.factory.js';
import { PoliciesGuard } from './policies.guard.js';

class ReadCompanyHandler implements IPolicyHandler {
  handle(ability: AppAbility): boolean {
    return ability.can('read', 'Company');
  }
}

class ThrowingHandler implements IPolicyHandler {
  handle(): boolean {
    throw new Error('policy handler bug');
  }
}

describe('PoliciesGuard', () => {
  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockCaslAbilityFactory = {
    createForUser: jest.fn(),
  };

  const mockModuleRef = {
    get: jest.fn(),
    resolve: jest.fn(),
  };

  let guard: PoliciesGuard;

  beforeEach(() => {
    guard = new PoliciesGuard(
      mockReflector as never as Reflector,
      mockCaslAbilityFactory as never as CaslAbilityFactory,
      mockModuleRef as never as ModuleRef,
    );
    jest.clearAllMocks();
  });

  function createExecutionContext(user?: AuthenticatedUser): ExecutionContext {
    return {
      getHandler: () => createExecutionContext,
      getClass: () => PoliciesGuard,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as never as ExecutionContext;
  }

  it('passes through when no policies are attached', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(createExecutionContext())).resolves.toBe(true);
    expect(mockCaslAbilityFactory.createForUser).not.toHaveBeenCalled();
  });

  it('throws when policy-protected routes have no authenticated user', async () => {
    mockReflector.getAllAndOverride.mockReturnValue([
      (ability: AppAbility) => ability.can('read', 'Company'),
    ]);

    await expect(guard.canActivate(createExecutionContext())).rejects.toThrow(ForbiddenException);
  });

  it('evaluates callback policies against the authenticated request user', async () => {
    const user: AuthenticatedUser = {
      id: 'user-1',
      email: 'user@example.com',
      role: Role.SALES_MANAGER,
    };

    mockReflector.getAllAndOverride.mockReturnValue([
      (ability: AppAbility) => ability.can('manage', 'Company'),
    ]);
    mockCaslAbilityFactory.createForUser.mockResolvedValue({
      can: jest.fn().mockReturnValue(true),
    });

    await expect(guard.canActivate(createExecutionContext(user))).resolves.toBe(true);
    expect(mockCaslAbilityFactory.createForUser).toHaveBeenCalledWith(user);
  });

  it('resolves class-token handlers through ModuleRef', async () => {
    const user: AuthenticatedUser = {
      id: 'user-1',
      email: 'user@example.com',
      role: Role.CONTENT_MANAGER,
    };

    mockReflector.getAllAndOverride.mockReturnValue([ReadCompanyHandler]);
    mockCaslAbilityFactory.createForUser.mockResolvedValue({
      can: jest.fn().mockImplementation((action: string, subject: string) => {
        return action === 'read' && subject === 'Company';
      }),
    });
    mockModuleRef.get.mockReturnValue(new ReadCompanyHandler());

    await expect(guard.canActivate(createExecutionContext(user))).resolves.toBe(true);
    expect(mockModuleRef.get).toHaveBeenCalledWith(ReadCompanyHandler, { strict: false });
  });

  it('supports async callback policies', async () => {
    const user: AuthenticatedUser = {
      id: 'user-1',
      email: 'user@example.com',
      role: Role.CONTENT_MANAGER,
    };

    mockReflector.getAllAndOverride.mockReturnValue([
      async (ability: AppAbility) => ability.can('read', 'AuditLog'),
    ]);
    mockCaslAbilityFactory.createForUser.mockResolvedValue({
      can: jest.fn().mockReturnValue(false),
    });

    await expect(guard.canActivate(createExecutionContext(user))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('falls back to ModuleRef.resolve when ModuleRef.get cannot resolve the handler', async () => {
    const user: AuthenticatedUser = {
      id: 'user-1',
      email: 'user@example.com',
      role: Role.CONTENT_MANAGER,
    };

    mockReflector.getAllAndOverride.mockReturnValue([ReadCompanyHandler]);
    mockCaslAbilityFactory.createForUser.mockResolvedValue({
      can: jest.fn().mockReturnValue(true),
    });
    mockModuleRef.get.mockImplementation(() => {
      throw new Error('not found');
    });
    mockModuleRef.resolve.mockResolvedValue(new ReadCompanyHandler());

    await expect(guard.canActivate(createExecutionContext(user))).resolves.toBe(true);
    expect(mockModuleRef.resolve).toHaveBeenCalled();
  });

  it('propagates handler execution errors instead of masking them with a fallback resolve', async () => {
    const user: AuthenticatedUser = {
      id: 'user-1',
      email: 'user@example.com',
      role: Role.CONTENT_MANAGER,
    };

    mockReflector.getAllAndOverride.mockReturnValue([ThrowingHandler]);
    mockCaslAbilityFactory.createForUser.mockResolvedValue({
      can: jest.fn().mockReturnValue(true),
    });
    mockModuleRef.get.mockReturnValue(new ThrowingHandler());

    await expect(guard.canActivate(createExecutionContext(user))).rejects.toThrow(
      'policy handler bug',
    );
    expect(mockModuleRef.resolve).not.toHaveBeenCalled();
  });
});
