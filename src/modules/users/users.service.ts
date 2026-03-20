import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Redis } from 'ioredis';
import { Prisma, type User as PrismaUser } from '../../generated/prisma/client.js';
import { AuditAction, AuditResourceType, Role } from '../../generated/prisma/enums.js';
import { paginatedResult } from '../../common/interceptors/transform-response.interceptor.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../redis/redis.module.js';
import { CaslAbilityFactory } from '../casl/casl-ability.factory.js';
import { AuditService } from '../audit/audit.service.js';
import { USER_SESSION_CACHE_PREFIX } from '../auth/strategies/jwt.strategy.js';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import type { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import type { UserResponseDto } from './dto/user-response.dto.js';

/** Fields selected on every user query — never exposes passwordHash. */
const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

export interface PaginatedUsers {
  data: UserResponseDto[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
  };
}

type ManagedUserSnapshot = Pick<PrismaUser, 'id' | 'email' | 'role' | 'isActive' | 'deletedAt'>;
type AuditSnapshot = {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  deletedAt: string | null;
};

const SERIALIZABLE_TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 10_000,
} as const;

const SERIALIZABLE_RETRY_LIMIT = 3;

/**
 * UsersService handles all CRUD operations for user management.
 *
 * Security contract:
 *  - Passwords are hashed with Argon2id before persistence; raw hashes are
 *    never exposed in responses (USER_SELECT excludes passwordHash).
 *  - After any role / isActive / deletedAt mutation both the CASL ability
 *    cache and the JwtStrategy user-session cache are invalidated so the
 *    next request picks up the new permissions.
 *  - Soft delete sets deletedAt; hard delete is not supported.
 *  - Audit writes are decoupled from the serializable transaction:
 *    role changes → synchronous audit (security event),
 *    all other mutations → BullMQ audit queue (operational event).
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly caslAbilityFactory: CaslAbilityFactory,
    private readonly auditService: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ─── List ─────────────────────────────────────────────────────────────────

  async findAll(query: ListUsersQueryDto): Promise<PaginatedUsers> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const skip = (page - 1) * perPage;

    const where = {
      ...(query.role ? { role: query.role } : {}),
      ...(!query.includeDeleted ? { deletedAt: null } : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginatedResult(
      users.map((u) => this.toResponseDto(u)),
      {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    );
  }

  // ─── Find one ─────────────────────────────────────────────────────────────

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return this.toResponseDto(user);
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(dto: CreateUserDto, actor: AuthenticatedUser): Promise<UserResponseDto> {
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const normalizedEmail = dto.email.trim().toLowerCase();

    const user = await this.withSerializableTransaction(async (tx) => {
      try {
        return await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            role: dto.role,
          },
          select: USER_SELECT,
        });
      } catch (error) {
        this.rethrowKnownWriteErrors(error);
        throw error;
      }
    });

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.CREATE,
      resourceType: AuditResourceType.User,
      resourceId: user.id,
      beforeSnapshot: null,
      afterSnapshot: this.toAuditSnapshot(user),
      metadata: { email: user.email, role: user.role },
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
    });

    this.logger.log(`User created: id=${user.id}, role=${user.role}`);

    return this.toResponseDto(user);
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser): Promise<UserResponseDto> {
    // Fast-path existence check: avoid spending Argon2id time on a missing user.
    // The transaction still re-checks existence via loadManagedUserOrThrow.
    if (dto.password !== undefined) {
      const exists = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundException(`User ${id} not found`);
    }

    const passwordHash =
      dto.password !== undefined
        ? await argon2.hash(dto.password, { type: argon2.argon2id })
        : null;

    const { user, beforeSnapshot, shouldInvalidateCache, isRoleChange } =
      await this.withSerializableTransaction(async (tx) => {
        const existingUser = await this.loadManagedUserOrThrow(tx, id);

        await this.ensureSuperAdminRetention(tx, existingUser, {
          role: dto.role,
          isActive: dto.isActive,
        });

        const data: { role?: Role; isActive?: boolean; passwordHash?: string } = {};

        if (dto.role !== undefined) {
          data.role = dto.role;
        }

        if (dto.isActive !== undefined) {
          data.isActive = dto.isActive;
        }

        if (passwordHash !== null) {
          data.passwordHash = passwordHash;
        }

        const updatedUser = await tx.user.update({
          where: { id },
          data,
          select: USER_SELECT,
        });

        return {
          user: updatedUser,
          beforeSnapshot: this.toAuditSnapshot(existingUser),
          shouldInvalidateCache: dto.role !== undefined || dto.isActive !== undefined,
          isRoleChange: dto.role !== undefined,
        };
      });

    if (shouldInvalidateCache) {
      await this.invalidateUserCaches(id);
    }

    // Build changed-fields list for audit metadata.
    const changedFields: string[] = [];
    if (dto.role !== undefined) changedFields.push('role');
    if (dto.isActive !== undefined) changedFields.push('isActive');
    if (dto.password !== undefined) changedFields.push('passwordHash');

    const auditPayload = {
      actorId: actor.id,
      action: AuditAction.UPDATE,
      resourceType: AuditResourceType.User,
      resourceId: user.id,
      beforeSnapshot,
      afterSnapshot: this.toAuditSnapshot(user),
      metadata: { changedFields: changedFields.sort() },
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
    };

    // Role change = security event → synchronous audit.
    // Other changes = operational → async audit via BullMQ.
    if (isRoleChange) {
      await this.auditService.logSync(auditPayload);
    } else {
      await this.auditService.logAsync(auditPayload);
    }

    this.logger.log(`User updated: id=${id}`);

    return this.toResponseDto(user);
  }

  // ─── Soft delete ──────────────────────────────────────────────────────────

  async remove(id: string, actor: AuthenticatedUser): Promise<UserResponseDto> {
    const { user, beforeSnapshot } = await this.withSerializableTransaction(async (tx) => {
      const existingUser = await this.loadManagedUserOrThrow(tx, id);
      const deletedAt = new Date();

      await this.ensureSuperAdminRetention(tx, existingUser, {
        isActive: false,
        deletedAt,
      });

      const deletedUser = await tx.user.update({
        where: { id },
        data: { deletedAt, isActive: false },
        select: USER_SELECT,
      });

      return { user: deletedUser, beforeSnapshot: this.toAuditSnapshot(existingUser) };
    });

    await this.invalidateUserCaches(id);

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.DELETE,
      resourceType: AuditResourceType.User,
      resourceId: user.id,
      beforeSnapshot,
      afterSnapshot: this.toAuditSnapshot(user),
      metadata: { softDelete: true },
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
    });

    this.logger.log(`User soft-deleted: id=${id}`);

    return this.toResponseDto(user);
  }

  // ─── Restore ──────────────────────────────────────────────────────────────

  /**
   * Restores a soft-deleted user.
   * Sets `deletedAt: null` and `isActive: true` — restoration always
   * re-activates the account regardless of the `isActive` value at deletion
   * time, because `remove` unconditionally deactivates the user. An admin
   * wishing to restore-but-keep-inactive must follow up with a PATCH.
   */
  async restore(id: string, actor: AuthenticatedUser): Promise<UserResponseDto> {
    const { restored, beforeSnapshot } = await this.withSerializableTransaction(async (tx) => {
      const existingUser = await this.loadManagedUserOrThrow(tx, id);

      if (existingUser.deletedAt === null) {
        throw new ConflictException(`User ${id} is not deleted`);
      }

      const restoredUser = await tx.user.update({
        where: { id },
        data: { deletedAt: null, isActive: true },
        select: USER_SELECT,
      });

      return { restored: restoredUser, beforeSnapshot: this.toAuditSnapshot(existingUser) };
    });

    await this.invalidateUserCaches(id);

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.UPDATE,
      resourceType: AuditResourceType.User,
      resourceId: restored.id,
      beforeSnapshot,
      afterSnapshot: this.toAuditSnapshot(restored),
      metadata: { restored: true },
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
    });

    this.logger.log(`User restored: id=${id}`);

    return this.toResponseDto(restored);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async withSerializableTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction((tx) => operation(tx), SERIALIZABLE_TX_OPTIONS);
      } catch (error) {
        if (this.isRetryableTransactionConflict(error) && attempt < SERIALIZABLE_RETRY_LIMIT) {
          // Exponential backoff with jitter to reduce thundering-herd on serialization conflicts.
          await this.sleep(Math.random() * Math.min(100, 10 * 2 ** (attempt - 1)));
          continue;
        }

        throw error;
      }
    }

    throw new Error('Exceeded serializable transaction retry limit');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async loadManagedUserOrThrow(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<ManagedUserSnapshot> {
    const user = await tx.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        deletedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return user;
  }

  private async ensureSuperAdminRetention(
    tx: Prisma.TransactionClient,
    existingUser: ManagedUserSnapshot,
    changes: { role?: Role; isActive?: boolean; deletedAt?: Date | null },
  ): Promise<void> {
    const nextRole = changes.role ?? existingUser.role;
    const nextIsActive = changes.isActive ?? existingUser.isActive;
    const nextDeletedAt = changes.deletedAt ?? existingUser.deletedAt;

    const currentlyActiveSuperAdmin =
      existingUser.role === Role.SUPER_ADMIN &&
      existingUser.isActive &&
      existingUser.deletedAt === null;
    const remainsActiveSuperAdmin =
      nextRole === Role.SUPER_ADMIN && nextIsActive && nextDeletedAt === null;

    if (!currentlyActiveSuperAdmin || remainsActiveSuperAdmin) {
      return;
    }

    const activeSuperAdminCount = await tx.user.count({
      where: {
        role: Role.SUPER_ADMIN,
        isActive: true,
        deletedAt: null,
      },
    });

    if (activeSuperAdminCount <= 1) {
      throw new ConflictException('At least one active SUPER_ADMIN must remain');
    }
  }

  private async invalidateUserCaches(userId: string): Promise<void> {
    // Both invalidations are best-effort: a Redis failure must never surface
    // as an error after a successfully-committed DB mutation.
    await this.caslAbilityFactory.invalidateCache(userId).catch((error: unknown) => {
      this.logger.warn(
        `Failed to invalidate CASL ability cache for userId=${userId}: ${(error as Error)?.message ?? error}`,
      );
    });
    await this.redis.del(`${USER_SESSION_CACHE_PREFIX}${userId}`).catch((error: unknown) => {
      this.logger.warn(
        `Failed to invalidate user session cache for userId=${userId}: ${(error as Error)?.message ?? error}`,
      );
    });
  }

  private rethrowKnownWriteErrors(error: unknown): void {
    if (this.getPrismaErrorCode(error) === 'P2002' && this.isEmailUniqueConstraint(error)) {
      throw new ConflictException('Email is already in use');
    }
  }

  private isEmailUniqueConstraint(error: unknown): boolean {
    const target =
      typeof error === 'object' && error !== null && 'meta' in error
        ? (error as { meta?: { target?: string | string[] } }).meta?.target
        : undefined;

    if (Array.isArray(target)) {
      return target.includes('email');
    }

    return target === 'email' || target === 'users_email_key';
  }

  private isRetryableTransactionConflict(error: unknown): boolean {
    return this.getPrismaErrorCode(error) === 'P2034';
  }

  private getPrismaErrorCode(error: unknown): string | null {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' ? code : null;
    }

    return null;
  }

  private toResponseDto(user: {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      role: user.role as UserResponseDto['role'],
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
    };
  }

  private toAuditSnapshot(user: {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
    deletedAt: Date | null;
  }): AuditSnapshot {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
    };
  }
}
