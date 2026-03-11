import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CaslAbilityFactory } from '../casl/casl-ability.factory.js';
import { AuditService } from '../audit/audit.service.js';
import { REDIS_CLIENT } from '../../redis/redis.module.js';
import { Role } from '../../generated/prisma/enums.js';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator.js';

// Prevent Jest from loading the real Prisma generated client.
jest.mock('../../generated/prisma/client.js', () => ({
  PrismaClient: jest.fn(),
  Prisma: {
    JsonNull: null,
  },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('pg', () => ({ Pool: jest.fn() }));

// argon2 is a native binding — mock the whole module.
jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
  argon2id: 2,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const argon2 = require('argon2') as { hash: jest.Mock; argon2id: number };

// ─── Fixtures ────────────────────────────────────────────────────────────────

const now = new Date('2026-01-01T00:00:00.000Z');

const mockUserRow = {
  id: 'uuid-1',
  email: 'alice@example.com',
  role: Role.CONTENT_MANAGER,
  isActive: true,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

const mockManagedUser = {
  id: mockUserRow.id,
  email: mockUserRow.email,
  role: mockUserRow.role,
  isActive: mockUserRow.isActive,
  deletedAt: mockUserRow.deletedAt,
};

const adminActor: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: Role.SUPER_ADMIN,
};

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPrisma = {
  $transaction: jest.fn(),
  user: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockCasl = {
  invalidateCache: jest.fn(),
};

const mockAuditService = {
  logSync: jest.fn().mockResolvedValue(undefined),
  logAsync: jest.fn().mockResolvedValue(undefined),
};

const mockRedis = {
  del: jest.fn().mockResolvedValue(1),
};

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CaslAbilityFactory, useValue: mockCasl },
        { provide: AuditService, useValue: mockAuditService },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma),
    );
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated users excluding soft-deleted by default', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUserRow]);
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, perPage: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalPages).toBe(1);

      // Soft-deleted filter applied by default
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
      );
    });

    it('includes soft-deleted users when includeDeleted is true', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUserRow]);
      mockPrisma.user.count.mockResolvedValue(1);

      await service.findAll({ includeDeleted: true });

      const callArgs = mockPrisma.user.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(callArgs.where).not.toHaveProperty('deletedAt');
    });

    it('filters by role when provided', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.findAll({ role: Role.SUPER_ADMIN });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: Role.SUPER_ADMIN }),
        }),
      );
    });

    it('applies correct pagination skip', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.findAll({ page: 3, perPage: 10 });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns a user when found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUserRow);

      const result = await service.findOne('uuid-1');

      expect(result.id).toBe('uuid-1');
      expect(result.email).toBe('alice@example.com');
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    const createDto = {
      email: 'bob@example.com',
      password: 'StrongPass1!',
      role: Role.SALES_MANAGER,
    };

    it('creates a user and returns DTO without passwordHash', async () => {
      mockPrisma.user.create.mockResolvedValue({
        ...mockUserRow,
        email: createDto.email,
        role: createDto.role,
      });

      const result = await service.create(createDto, adminActor);

      expect(result.email).toBe(createDto.email);
      expect(result).not.toHaveProperty('passwordHash');

      expect(argon2.hash).toHaveBeenCalledWith(createDto.password, { type: argon2.argon2id });

      // Verify create call includes hashed password
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordHash: 'hashed_password' }),
        }),
      );
      expect(mockAuditService.logAsync).toHaveBeenCalled();
    });

    it('throws ConflictException when email is already taken', async () => {
      const error = new Error('duplicate email') as Error & {
        code: string;
        meta: { target: string[] };
      };
      error.code = 'P2002';
      error.meta = { target: ['email'] };
      mockPrisma.user.create.mockRejectedValue(error);

      await expect(service.create(createDto, adminActor)).rejects.toThrow(ConflictException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates role and invalidates CASL cache', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockManagedUser);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUserRow,
        role: Role.SALES_MANAGER,
      });

      const result = await service.update('uuid-1', { role: Role.SALES_MANAGER }, adminActor);

      expect(result.role).toBe(Role.SALES_MANAGER);
      expect(mockCasl.invalidateCache).toHaveBeenCalledWith('uuid-1');
      expect(mockRedis.del).toHaveBeenCalled();
      expect(mockAuditService.logSync).toHaveBeenCalled();
    });

    it('updates isActive and invalidates CASL cache', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockManagedUser);
      mockPrisma.user.update.mockResolvedValue({ ...mockUserRow, isActive: false });

      await service.update('uuid-1', { isActive: false }, adminActor);

      expect(mockCasl.invalidateCache).toHaveBeenCalledWith('uuid-1');
      expect(mockRedis.del).toHaveBeenCalled();
      expect(mockAuditService.logAsync).toHaveBeenCalled();
    });

    it('hashes new password when provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockManagedUser);
      mockPrisma.user.update.mockResolvedValue(mockUserRow);

      await service.update('uuid-1', { password: 'NewPass1!' }, adminActor);

      expect(argon2.hash).toHaveBeenCalledWith('NewPass1!', { type: argon2.argon2id });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordHash: 'hashed_password' }),
        }),
      );
    });

    it('does NOT invalidate CASL cache when only password changes', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockManagedUser);
      mockPrisma.user.update.mockResolvedValue(mockUserRow);

      await service.update('uuid-1', { password: 'NewPass1!' }, adminActor);

      expect(mockCasl.invalidateCache).not.toHaveBeenCalled();
      expect(mockAuditService.logAsync).toHaveBeenCalled();
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing', { role: Role.SUPER_ADMIN }, adminActor),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks demoting the last active super admin', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUserRow,
        role: Role.SUPER_ADMIN,
      });
      mockPrisma.user.count.mockResolvedValue(1);

      await expect(
        service.update('uuid-1', { role: Role.CONTENT_MANAGER }, adminActor),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  // ─── remove (soft delete) ─────────────────────────────────────────────────

  describe('remove', () => {
    it('sets deletedAt and deactivates the user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockManagedUser);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUserRow,
        isActive: false,
        deletedAt: now,
      });

      const result = await service.remove('uuid-1', adminActor);

      expect(result.isActive).toBe(false);
      expect(result.deletedAt).not.toBeNull();

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date), isActive: false }),
        }),
      );
      expect(mockCasl.invalidateCache).toHaveBeenCalledWith('uuid-1');
      expect(mockRedis.del).toHaveBeenCalled();
      expect(mockAuditService.logAsync).toHaveBeenCalled();
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', adminActor)).rejects.toThrow(NotFoundException);
    });

    it('blocks deleting the last active super admin', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUserRow,
        role: Role.SUPER_ADMIN,
      });
      mockPrisma.user.count.mockResolvedValue(1);

      await expect(service.remove('uuid-1', adminActor)).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  // ─── restore ──────────────────────────────────────────────────────────────

  describe('restore', () => {
    it('restores a soft-deleted user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockManagedUser,
        deletedAt: now,
        isActive: false,
      });
      mockPrisma.user.update.mockResolvedValue({
        ...mockUserRow,
        isActive: true,
        deletedAt: null,
      });

      const result = await service.restore('uuid-1', adminActor);

      expect(result.deletedAt).toBeNull();
      expect(result.isActive).toBe(true);
      expect(mockCasl.invalidateCache).toHaveBeenCalledWith('uuid-1');
      expect(mockRedis.del).toHaveBeenCalled();
      expect(mockAuditService.logAsync).toHaveBeenCalled();
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.restore('missing', adminActor)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when user is not deleted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'uuid-1', deletedAt: null });

      await expect(service.restore('uuid-1', adminActor)).rejects.toThrow(ConflictException);
    });
  });

  // ─── toResponseDto (via findOne) ──────────────────────────────────────────

  describe('response DTO shape', () => {
    it('serialises dates as ISO strings and never exposes passwordHash', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUserRow);

      const result = await service.findOne('uuid-1');

      expect(typeof result.createdAt).toBe('string');
      expect(typeof result.updatedAt).toBe('string');
      expect(result).not.toHaveProperty('passwordHash');
    });
  });
});
