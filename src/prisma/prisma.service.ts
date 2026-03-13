import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Instance type of the generated PrismaClient.
 * Used for typing the private field and exposing helpers.
 */
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

/**
 * PrismaService — global singleton that owns the single PrismaClient
 * instance for the entire application.
 *
 * Architecture notes (Prisma v7):
 * - Uses PrismaPg driver adapter (@prisma/adapter-pg) — Rust query engine is
 *   replaced by a WASM compiler in v7; driver adapters are mandatory.
 * - A pg.Pool is constructed explicitly so connection-pool settings are
 *   tunable via env vars (DB_POOL_MAX, DB_POOL_CONNECT_TIMEOUT_MS,
 *   DB_POOL_IDLE_TIMEOUT_MS) without code changes.
 * - Pool errors are forwarded to the NestJS logger instead of crashing the
 *   process silently.
 * - Connects on module init, disconnects on module destroy (graceful shutdown).
 * - PrismaClient is held via composition, not inheritance, to stay compatible
 *   with Prisma v7's factory-based class generation.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;
  private readonly prisma: PrismaClientInstance;

  // Bound once in the constructor — no repeated allocation on every call,
  // and stable references make them easy to spy on in tests.
  readonly $transaction: PrismaClientInstance['$transaction'];
  readonly $queryRaw: PrismaClientInstance['$queryRaw'];
  readonly $executeRaw: PrismaClientInstance['$executeRaw'];

  constructor(private readonly configService: ConfigService) {
    // Use the registered namespace instead of the raw env key so this stays
    // consistent with every other service in the project.
    const url = this.configService.getOrThrow<string>('database.url');

    this.pool = new Pool({
      connectionString: url,
      max: this.configService.get<number>('database.poolMax', 10),
      connectionTimeoutMillis: this.configService.get<number>(
        'database.poolConnectTimeoutMs',
        3_000,
      ),
      idleTimeoutMillis: this.configService.get<number>('database.poolIdleTimeoutMs', 10_000),
      statement_timeout: this.configService.get<number>('database.statementTimeoutMs', 30_000),
    });

    // Forward unexpected pool-level errors to the structured logger.
    // Without this listener Node.js would emit an unhandled 'error' event
    // and crash the process.
    this.pool.on('error', (err: Error) => {
      this.logger.error('Unexpected pg pool error', err.stack);
    });

    const adapter = new PrismaPg(this.pool);
    this.prisma = new PrismaClient({ adapter }) as PrismaClientInstance;

    this.$transaction = this.prisma.$transaction.bind(this.prisma);
    this.$queryRaw = this.prisma.$queryRaw.bind(this.prisma);
    this.$executeRaw = this.prisma.$executeRaw.bind(this.prisma);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    // Prisma must be disconnected before the pool is closed so in-flight
    // queries are drained cleanly. Each step is guarded independently so a
    // failure in $disconnect never prevents the pool from being closed —
    // leaving unclosed connections would prevent the process from exiting.
    try {
      await this.prisma.$disconnect();
    } catch (err) {
      this.logger.error(
        'Error while disconnecting Prisma client during shutdown',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      try {
        await this.pool.end();
        this.logger.log('Database connection closed');
      } catch (err) {
        this.logger.error(
          'Error while closing pg pool during shutdown',
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  // ── Model accessors ─────────────────────────────────────────────────────────
  // Expose each Prisma model delegate so callers can write:
  //   this.prisma.user.findMany(...)
  // without touching the internal client directly.

  get user(): PrismaClientInstance['user'] {
    return this.prisma.user;
  }

  get page(): PrismaClientInstance['page'] {
    return this.prisma.page;
  }

  get pageSection(): PrismaClientInstance['pageSection'] {
    return this.prisma.pageSection;
  }

  get rubric(): PrismaClientInstance['rubric'] {
    return this.prisma.rubric;
  }

  get newsArticle(): PrismaClientInstance['newsArticle'] {
    return this.prisma.newsArticle;
  }

  get articleCard(): PrismaClientInstance['articleCard'] {
    return this.prisma.articleCard;
  }

  get company(): PrismaClientInstance['company'] {
    return this.prisma.company;
  }

  get purchase(): PrismaClientInstance['purchase'] {
    return this.prisma.purchase;
  }

  get auditLog(): PrismaClientInstance['auditLog'] {
    return this.prisma.auditLog;
  }
}
