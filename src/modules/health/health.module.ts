import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { StorageModule } from '../storage/storage.module.js';
import { DbHealthIndicator } from './db-health.indicator.js';
import { RedisHealthIndicator } from './redis-health.indicator.js';
import { StorageHealthIndicator } from './storage-health.indicator.js';

/**
 * HealthModule — bundles Terminus and the three custom health indicators.
 *
 * Exports TerminusModule (and therefore HealthCheckService) plus all
 * indicators so the AppController can inject them without duplicating the
 * TerminusModule import.
 */
@Module({
  imports: [TerminusModule, StorageModule],
  providers: [DbHealthIndicator, RedisHealthIndicator, StorageHealthIndicator],
  exports: [TerminusModule, DbHealthIndicator, RedisHealthIndicator, StorageHealthIndicator],
})
export class HealthModule {}
