import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service.js';
import { withTimeout } from '../../common/utils/with-timeout.js';

/** Maximum milliseconds to wait for the database ping before reporting down. */
const PING_TIMEOUT_MS = 5_000;

/**
 * Verifies the PostgreSQL connection is alive by running SELECT 1.
 * Uses the globally-provided PrismaService so no extra connection is opened.
 */
@Injectable()
export class DbHealthIndicator {
  private readonly logger = new Logger(DbHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  async pingCheck(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      // $executeRaw with a safe parameterised literal — no user input involved.
      await withTimeout(
        this.prisma.$executeRaw`SELECT 1`,
        PING_TIMEOUT_MS,
        'Database ping timeout',
      );
      return indicator.up();
    } catch (error) {
      this.logger.warn(`Database health check failed: ${(error as Error).message}`);
      return indicator.down({ message: 'Database unreachable' });
    }
  }
}
