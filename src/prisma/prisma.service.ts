import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
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
 * - Connects on module init, disconnects on module destroy (graceful shutdown).
 * - All modules that need DB access inject PrismaService and call model
 *   accessors directly (e.g. `this.prisma.user.findUnique(...)`).
 * - PrismaClient is held via composition, not inheritance, to stay compatible
 *   with Prisma v7's factory-based class generation.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly prisma: PrismaClientInstance;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.getOrThrow<string>('DATABASE_URL');
    const adapter = new PrismaPg({ connectionString: url });
    this.prisma = new PrismaClient({ adapter }) as PrismaClientInstance;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
    this.logger.log('Database connection closed');
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

  get newsArticle(): PrismaClientInstance['newsArticle'] {
    return this.prisma.newsArticle;
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

  // ── Transaction & raw-query helpers ─────────────────────────────────────────

  get $transaction(): PrismaClientInstance['$transaction'] {
    return this.prisma.$transaction.bind(this.prisma);
  }

  get $queryRaw(): PrismaClientInstance['$queryRaw'] {
    return this.prisma.$queryRaw.bind(this.prisma);
  }

  get $executeRaw(): PrismaClientInstance['$executeRaw'] {
    return this.prisma.$executeRaw.bind(this.prisma);
  }
}
