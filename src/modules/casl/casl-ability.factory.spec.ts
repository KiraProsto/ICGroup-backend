import { Role } from '../../generated/prisma/enums.js';
import { CaslAbilityFactory, type AbilityUserContext } from './casl-ability.factory.js';

describe('CaslAbilityFactory', () => {
  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  let factory: CaslAbilityFactory;

  beforeEach(() => {
    factory = new CaslAbilityFactory(mockPrismaService as never, mockRedis as never);
    jest.clearAllMocks();
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
  });

  it('builds from the authenticated user snapshot without re-querying Prisma', async () => {
    mockRedis.get.mockResolvedValue(null);

    const user: AbilityUserContext = {
      id: 'user-1',
      role: Role.SUPER_ADMIN,
    };

    const ability = await factory.createForUser(user);

    expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
    expect(mockRedis.get).toHaveBeenCalledWith('casl:ability:user-1:SUPER_ADMIN');
    expect(ability.can('manage', 'AuditLog')).toBe(true);
  });

  it('does not reuse a stale cache entry across role changes for the same user', async () => {
    mockRedis.get.mockResolvedValue(null);

    const adminAbility = await factory.createForUser({
      id: 'user-1',
      role: Role.SUPER_ADMIN,
    });

    const contentAbility = await factory.createForUser({
      id: 'user-1',
      role: Role.CONTENT_MANAGER,
    });

    expect(mockRedis.get).toHaveBeenNthCalledWith(1, 'casl:ability:user-1:SUPER_ADMIN');
    expect(mockRedis.get).toHaveBeenNthCalledWith(2, 'casl:ability:user-1:CONTENT_MANAGER');
    expect(adminAbility.can('manage', 'Company')).toBe(true);
    expect(contentAbility.can('manage', 'Company')).toBe(false);
  });

  it('returns an empty ability for a soft-deleted user when loading from Prisma', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: Role.SUPER_ADMIN,
      isActive: true,
      deletedAt: new Date(),
    });

    const ability = await factory.createForUser('user-1');

    expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true, role: true, isActive: true, deletedAt: true },
    });
    expect(ability.can('manage', 'all')).toBe(false);
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('invalidates every role-specific cache key for a user', async () => {
    await factory.invalidateCache('user-1');

    expect(mockRedis.del).toHaveBeenCalledWith(
      'casl:ability:user-1:SUPER_ADMIN',
      'casl:ability:user-1:CONTENT_MANAGER',
      'casl:ability:user-1:SALES_MANAGER',
    );
  });
});
