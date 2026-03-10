import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Verifies the PostgreSQL connection is alive by running SELECT 1.
 * Uses the globally-provided PrismaService so no extra connection is opened.
 */
@Injectable()
export class DbHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  async pingCheck(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      // $executeRaw with a safe parameterised literal — no user input involved.
      await this.prisma.$executeRaw`SELECT 1`;
      return indicator.up();
    } catch {
      return indicator.down({ message: 'Database unreachable' });
    }
  }
}
