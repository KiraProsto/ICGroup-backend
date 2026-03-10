import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DbHealthIndicator } from './db-health.indicator.js';
import { RedisHealthIndicator } from './redis-health.indicator.js';

/**
 * HealthModule — bundles Terminus and the two custom health indicators.
 *
 * Exports TerminusModule (and therefore HealthCheckService) plus both
 * indicators so the AppController can inject them without duplicating the
 * TerminusModule import.
 */
@Module({
  imports: [TerminusModule],
  providers: [DbHealthIndicator, RedisHealthIndicator],
  exports: [TerminusModule, DbHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
